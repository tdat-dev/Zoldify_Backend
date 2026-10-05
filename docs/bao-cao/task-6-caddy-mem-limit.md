# Task #6 — Caddy, ba bản api, và `mem_limit` cho cả cụm

**Vai:** B — Platform · DevOps · Backend nghiệp vụ
**Hạn theo bảng phân công:** 14/08 → 16/08 · **Làm ngày:** 28/09 (trễ 43 ngày)
**Nhánh:** `feat/task-6-caddy-mem-limit` (tách từ `staging`)
**Bài kiểm:** `npm run check:compose`

---

## 1. Ô task nói gì, và vì sao nó đáng làm trước

Bảng phân công, dòng 184:

> | 6 | Docker Compose | mysql · redis · api · worker · **caddy**, có `mem_limit` | 14/08 | 16/08 | B |

Trước hôm nay `docker-compose.yml` có `mysql · redis · migrate · api · worker`
— **thiếu đúng hai thứ ô đó ghi**: không có `caddy`, và không có `mem_limit`
nào trên bất kỳ dịch vụ nào.

Chọn việc này vì nó **quá hạn lâu nhất trong phần việc của vai B** (43 ngày,
so với #34 quá hạn 26 ngày nhưng thuộc vai A — bảo mật là của Đạt). Và vì
`docs/BAN-GIAO.md` đã ghi sẵn: *"CPU bão hoà từ 10 người bấm cùng lúc — đây là
thứ duy nhất đẩy trần lên."*

### Số đo có sẵn, không phải suy đoán

`docs/system-design/load-test.md` đo trên chính hệ này. Cột RPS đứng yên trong
khi p95 gấp đôi mỗi lần số song song gấp đôi:

| Route | song song | RPS | p95 | CPU |
|---|---:|---:|---:|---:|
| danh mục (không cache) | 10 | 964 | 13.8 | 108% |
| danh mục (không cache) | 50 | 947 | 59.06 | 107% |
| danh mục (không cache) | 100 | 949 | 118.73 | 126% |

Đó là hình dạng của một **hàng đợi trước một luồng duy nhất**, không phải của
một hệ hết tài nguyên. Node có đúng một luồng JS: thêm nhân CPU cho một tiến
trình không đổi được gì, phải thêm **tiến trình**. Kết luận của chính file đó:

> *"Muốn hơn thì phải thêm tiến trình, không phải thêm nhân cho một tiến trình."*

---

## 2. Pre-mortem (viết trước khi gõ dòng mã đầu tiên)

| # | Rủi ro | Vì sao có thật | Đã chặn bằng |
|---|---|---|---|
| 1 | caddy bind 80/443 đụng thứ đang giữ hai cổng đó trên VPS | `deploy.yml` dựng **hai** project compose trên **cùng một** VPS; và `api.zoldify.com` đang chạy HTTPS thật trong khi compose cũ không có dịch vụ nào nghe 443 → có proxy nằm ngoài compose | cổng lấy từ `CADDY_HTTP_PORT`/`CADDY_HTTPS_PORT`; ghi cảnh báo ngay trong compose; **chưa gộp** |
| 2 | Bỏ `ports` của api → mất đường vào cổng 3000 | ba bản không cùng publish một cổng host được | caddy thành đường vào duy nhất; `DEPLOY.md` đổi lệnh kiểm sang cổng 80 |
| 3 | Tổng trần RAM vượt RAM thật của VPS → OOM-kill | không tài liệu nào ghi VPS bao nhiêu RAM | mọi trần + số bản lấy từ env; bài kiểm **cộng tổng** và so với `VPS_MEM_BUDGET` |
| 4 | Nhiều bản api mà trạng thái còn trong RAM tiến trình | throttler/socket/cache fail-open về in-process khi thiếu Redis | mục kiểm: `replicas > 1` bắt buộc có `REDIS_URL` |
| 5 | Ai đó nâng `worker` lên >1 → hoàn tiền hai lần | `cancelExpired` đọc đơn ngoài transaction, không khoá dòng | mục kiểm chốt cứng `worker = 1` |
| 6 | Caddy xin lại chứng chỉ mỗi lần tạo container → chạm hạn mức ACME | không có volume `/data` là mất kho chứng chỉ | `caddy-data` + `caddy-config` |
| 7 | Ba bản api ghi cùng volume ảnh | `epic-5-infra-erd.md` từng ghi đây là **thứ chặn** nhân bản | cùng một VPS thì named volume dùng chung được — ghi lại vì sao hết chặn |

---

## 3. Đã làm gì

| Thay đổi | Vì sao |
|---|---|
| `api` → 3 bản (`API_REPLICAS`) | thứ duy nhất đẩy trần lên, theo số đo mục 1 |
| `api` bỏ `ports` | ba bản không cùng ánh xạ một cổng host được |
| `Caddyfile` mới, dùng `dynamic a` | xem mục 4 — đây là chỗ dễ sai nhất của task |
| `mem_limit` cho cả sáu dịch vụ | không trần thì một rò rỉ kéo sập cả VPS |
| redis `--maxmemory` + `allkeys-lru` | xem mục 5 |
| api `NODE_OPTIONS=--max-old-space-size` | xem mục 6 |
| `caddy-data` / `caddy-config` volume | giữ chứng chỉ qua các lần deploy |
| `npm run check:compose` | bài kiểm gác hình dạng cụm, chạy không cần Docker |

---

## 4. Cái bẫy chính: `reverse_proxy api:3000` **nhân bản xong vẫn dồn một bản**

Viết `reverse_proxy api:3000` thì caddy giải tên **một lần** lúc khởi động và
giữ đúng một địa chỉ IP. Compose dựng ba bản, DNS nội bộ của Docker trả về ba
bản ghi A — nhưng caddy đã chốt bản đầu tiên. Hai bản còn lại ngồi không, bản
thứ nhất nghẽn y như khi chưa nhân bản.

Không có lỗi nào hiện ra: `docker compose ps` vẫn ba dòng healthy, log vẫn
sạch, `/health` vẫn 200. Chỉ có số đo không nhúc nhích — và người đọc số sẽ kết
luận nhầm rằng "nhân bản không ăn thua", rồi đi tối ưu chỗ khác.

Nên upstream khai bằng `dynamic a`, hỏi lại DNS mỗi 10 giây:

```
reverse_proxy {
	dynamic a {
		name api
		port 3000
		refresh 10s
	}
	lb_policy least_conn
	health_uri /
	health_interval 10s
}
```

`lb_policy least_conn` chứ không xoay vòng đều tay: các route của hệ này lệch
nhau tới 10 lần về thời gian (sitemap con 1173 rps so với "đơn của tôi" 308
rps). Xoay vòng sẽ dồn hai request nặng vào cùng một bản trong khi bản bên cạnh
rảnh — mà một bản Node bận thì **tất cả** request trên bản đó xếp hàng.

Cú pháp đã xác nhận bằng chính image caddy, không phải theo trí nhớ:

```
$ docker run --rm -v ./Caddyfile:/etc/caddy/Caddyfile:ro caddy:2 \
    caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
Valid configuration
```

Và `check:compose` có một mục riêng đòi dạng `dynamic a` khi `replicas ≥ 2`.

---

## 5. `mem_limit` một mình là chưa đủ cho Redis

Redis không biết trần của container. Chỉ đặt `mem_limit: 256m` thì nó cứ nhận
thêm khoá tới khi chạm trần rồi bị OOM-killer giết — **mất sạch cache trong một
nhịp**. Ngay sau đó mọi request rơi thẳng xuống database, và load-test.md đã đo
sẵn cú rơi đó: đường sản phẩm tụt từ **2268 xuống 497 rps**, gần 4.6 lần.

Có `maxmemory` thì nó tự đẩy khoá cũ ra và sống tiếp: cache **vơi dần** chứ
không **biến mất cùng lúc**. Đặt 192mb trên trần 256M, chừa ~25% cho phân mảnh
và bộ đệm client — phần đó nằm ngoài con số Redis tự đếm.

`allkeys-lru` chứ không để mặc định `noeviction`: mặc định sẽ trả lỗi ghi, tức
biến một cache-miss thành lỗi 500.

---

## 6. Node không đọc `mem_limit`

V8 chọn kích thước heap theo RAM của **cả máy**, không theo trần cgroup. Trên
VPS 4GB nó nhắm heap ~2GB, tức để rác dồn tới mốc đó mới chịu dọn — nhưng Docker
đã giết tiến trình ở 512M từ lâu trước.

Triệu chứng đúng kiểu khó tìm: container chết mã **137** lúc tải cao, log không
có lỗi nào, và tại chỗ trông y hệt "app bị crash". Nên `NODE_OPTIONS=--max-old-space-size=384`
đặt thấp hơn trần 512M để V8 dọn sớm. Đã ghi vào mục "khi hỏng" của `DEPLOY.md`.

---

## 7. Ngân sách RAM

Mặc định tính cho VPS 4GB:

| Dịch vụ | Trần | Số bản | Cộng vào đỉnh |
|---|---:|---:|---:|
| mysql | 1024M | 1 | 1024M |
| redis | 256M | 1 | 256M |
| api | 512M | 3 | 1536M |
| worker | 256M | 1 | 256M |
| caddy | 128M | 1 | 128M |
| migrate | 256M | 1 | — (chạy một lần rồi thoát) |
| | | **tổng** | **3200M** |

`migrate` không cộng vào đỉnh vì `api` và `worker` khai
`service_completed_successfully` trên nó — theo đúng định nghĩa chúng không bao
giờ chạy cùng lúc với nó.

**Chưa ai xác nhận VPS thật bao nhiêu RAM.** Không tài liệu nào trong repo ghi
con số đó. Người có quyền SSH phải chạy `free -m` và chỉnh `.env` trước lần
deploy đầu sau khi gộp. Máy 2GB thì đặt `API_REPLICAS=2  API_MEM=384m
MYSQL_MEM=512m  VPS_MEM_BUDGET=1500m`.

---

## 8. Nghiệm thu

### 8.1 Bài kiểm chuyển được đỏ → xanh

Đây là điều kiện `docs/BAN-GIAO.md` đòi, và là thứ bài kiểm R1/R4 ngày trước
không làm được.

| Lúc | `npm run check:compose` |
|---|---|
| trước khi sửa compose | **12 MỤC FAIL** — không có caddy, không có Caddyfile, api 1 bản và đang publish cổng host, cả 5 dịch vụ không có `mem_limit` |
| sau khi sửa | **TẤT CẢ PASS ✓** (6 mục, gồm cả đối chiếu bằng `docker compose config` thật) |

Bốn ca đối chứng xanh ngay từ lần chạy đầu tiên, nên "cụm sai hết" không bị lẫn
với "bộ kiểm hỏng".

### 8.2 Dựng cụm thật — và nó hỏng hai lần trước khi chạy

Đây là phần không đọc cấu hình mà biết được.

| Lần | Kết quả | Nguyên nhân |
|---|---|---|
| 1 | api-1/2/3 **Restarting (1)**, caddy **Restarting (1)** | hai lỗi thật, xem mục 8.3 |
| 2 (sau hai bản vá) | api ×3 **Up (healthy)**, caddy Up, migrate Exited(0), mysql/redis healthy | |

`deploy.replicas: 3` được compose tôn trọng thật — nó dựng đúng ba container
`zoldify-local-api-1/2/3`, không cần swarm, không cần `--scale`.

### 8.3 Hai lỗi chỉ lộ ra khi dựng cụm

**a. `API_DOMAIN` rỗng làm caddy từ chối cả file.** Cú pháp `{$BIEN:mặc định}`
của Caddy chỉ chạy khi biến **không được đặt**; `.env` có `API_DOMAIN=` (rỗng)
nên Caddy thay bằng chuỗi rỗng và khối site mất tên. Lời báo lỗi —
*"server block without any key is global configuration, and if used, it must be
first"* — không hề nhắc tới biến nào. Vá ở `bdff7a5`.

**b. Thiếu khoá Firebase giết cả ba bản api, không phải tắt riêng đăng nhập
Google.** Khoá bị gitignore nên máy mới clone không có file; Docker gặp bind
mount trỏ vào đường dẫn không tồn tại thì **tự tạo một thư mục rỗng**;
`fs.existsSync` trả true cho thư mục nên nhánh "không tìm thấy khoá" không chạy;
`require(<thư mục>)` ném `MODULE_NOT_FOUND` ngay trong `onModuleInit`. Cả ba bản
vào vòng khởi động lại vô tận. Comment trong compose ghi *"thiếu file thì
POST /api/auth/firebase trả 401"* — thực tế không phải vậy. Vá ở `47f41f8`.

Lỗi (b) **có từ trước task này** và sẽ nổ với bất kỳ ai deploy lần đầu; nó chỉ
lộ ra vì task này buộc phải dựng cụm từ số không.

### 8.4 Tải có thật sự chia cho ba bản không

Câu hỏi đắt nhất của task, vì dạng khai upstream sai thì mọi thứ vẫn "chạy".

90 request, 10 luồng song song, đi qua caddy. Đếm dòng `"msg":"request"` trong
log từng container:

| Bản | Số request đã phục vụ |
|---|---:|
| api-1 | 31 |
| api-2 | 35 |
| api-3 | 32 |

Chia đều thật. (Lần đếm đầu tôi đếm nhầm **toàn bộ** dòng log — ra 267/271/268,
trông cân đối y hệt nhưng phần lớn là log khởi động. Phải lọc theo
`"msg":"request"` mới là số request.)

### 8.5 Rate limit qua caddy: đọc IP người dùng, không phải IP của caddy

Rủi ro do chính việc đặt proxy phía trước sinh ra: nếu throttler nhìn thấy IP
của caddy thì **cả internet dùng chung một cửa 10 req/giây**, và trang coi như
chết.

Thí nghiệm hai nguồn IP khác nhau (hai container trên cùng mạng):

```
A (api-1) bắn 15 request  ->  {"200":10,"429":5}
B (api-2) bắn 1 request ngay sau đó  ->  status 200
```

B không dính cửa của A, nên `trust proxy = 1` trong `main.ts` cộng với
`X-Forwarded-For` do caddy đặt đang hoạt động đúng. Và việc A bị chặn ở đúng
10 request cho thấy throttler đếm **chung qua Redis** cho cả ba bản — nếu mỗi
bản đếm riêng thì A đã qua được ~30 request.

### 8.6 Trần RAM và cổng: đọc lại từ container đang chạy

Khai trong file là một chuyện, Docker có áp hay không là chuyện khác.

```
$ docker inspect ... --format '{{.HostConfig.Memory}}'
api-1        512 MB      worker-1     256 MB
api-2        512 MB      mysql-1     1024 MB
api-3        512 MB      redis-1      256 MB
                         caddy-1      128 MB
```

Cổng publish ra máy chủ — **chỉ caddy**:

```
api    | 3000/tcp                      <- mở trong mạng nội bộ, KHÔNG ánh xạ ra host
caddy  | 0.0.0.0:8080->80/tcp, 0.0.0.0:8443->443/tcp
mysql  | 3306/tcp                      <- không ánh xạ
redis  | 6379/tcp                      <- không ánh xạ
```

Hai thứ đi kèm `mem_limit` cũng đã có hiệu lực thật:

```
$ redis-cli config get maxmemory          -> 201326592   (= 192 MB)
$ redis-cli config get maxmemory-policy   -> allkeys-lru
$ trong container api: NODE_OPTIONS       -> --max-old-space-size=384
  v8.getHeapStatistics().heap_size_limit  -> 387 MB       (dưới trần 512 MB)
```

Heap 387MB nằm dưới trần container 512MB, nên V8 dọn rác trước khi Docker kịp
giết tiến trình — đúng điều mục 6 nhắm tới.

### 8.7 Các cổng khác

| Cổng | Kết quả |
|---|---|
| `npm run check:compose` | TẤT CẢ PASS ✓ |
| `npm run build` | xanh |
| `npm run lint:check` | **964** / mốc 964 — giảm 2 so với 966, đã hạ bánh cóc |
| `curl http://localhost:8080/` qua caddy | `HTTP 200` · `{"statusCode":200,...,"data":"Hello World!"}` |

### 8.8 Chưa đo được, và vì sao

**Chưa có số RPS trước/sau qua cụm thật.** `scripts/loadtest.ts` tự dựng lấy một
tiến trình server trong tiến trình con (`LOADTEST_ROLE=server`) và không có chế
độ trỏ vào một URL sẵn có, nên nó không đo được cụm qua caddy. Thêm vào đó rate
limit 10 req/giây mỗi IP sẽ nuốt mọi cú bắn tải trước khi chạm trần CPU.

Nên phần "ba bản đẩy trần lên bao nhiêu lần" hiện vẫn dựa trên số đo cũ trong
`load-test.md` (một tiến trình đụng trần một luồng JS từ mức 10 người bấm cùng
lúc) cộng với bằng chứng phân phối ở 8.4 — **không** phải một phép đo trực tiếp.
Muốn có con số đó thì phải cho `loadtest.ts` một chế độ `--url`; đó là việc
riêng, không gộp vào PR hạ tầng này.

---

## 9. Còn lại / cần người khác

1. **Chưa ai biết thứ gì đang giữ 80/443 trên VPS.** Phải chạy
   `ss -ltnp | grep -E ':(80|443)'` trên máy thật và quyết định gỡ proxy cũ hay
   đổi cổng cái mới, **trước** khi gộp nhánh này vào `staging` — gộp vào
   `staging` là deploy ngay.
2. **Staging và production dùng chung một VPS.** Hai project compose không dùng
   chung cổng host được; staging phải đặt `CADDY_HTTP_PORT`/`CADDY_HTTPS_PORT`
   khác trong `.env` của nó.
3. **RAM thật của VPS** — xem mục 7.
4. **`loadtest.ts` cần chế độ `--url`** để đo được cụm thật qua caddy thay vì
   chỉ đo một tiến trình server nó tự dựng. Chừng nào chưa có thì con số "ba
   bản đẩy trần lên bao nhiêu lần" vẫn là suy ra, không phải đo — xem 8.8.
5. **Lỗi khoá Firebase (8.3b) có từ trước và đang nằm trên production.** Nhánh
   production đi sau `staging` 142 commit, nên bản vá `47f41f8` chưa ra tới đó.
   Máy production hiện có khoá thật nên chưa nổ; nhưng bất kỳ lần dựng lại nào
   thiếu khoá sẽ làm cả ba bản api chết vòng lặp.

---

## 10. Ghi chú cho người làm tiếp

- Nghiệm thu dựng cụm bằng `docker compose -p zoldify-local up -d --build`, đặt
  `CADDY_HTTP_PORT=8080` / `CADDY_HTTPS_PORT=8443` trong `.env` để không đụng
  cổng 80/443 của máy cá nhân. Dọn bằng
  `docker compose -p zoldify-local down -v`.
- File `.env` dùng để nghiệm thu là file **cục bộ, đã gitignore**, không đẩy lên.
- Bảng "Chưa có, và biết là chưa có" trong `DEPLOY.md` còn hai dòng cũ (CI/CD và
  Redis) không còn đúng, nhưng thuộc task khác nên không sửa trong PR này.
