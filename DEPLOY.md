# Cài đặt và triển khai — Zoldify Backend

Tài liệu cho **chương VI của báo cáo (Installation Instructions)**.

Mọi lệnh dưới đây đã được chạy thật trên máy Windows + Docker Desktop ngày
14/08/2026, không phải viết theo trí nhớ.

---

## Cần sẵn

| | |
|---|---|
| Docker Engine | 24 trở lên (`docker compose` là lệnh con, không phải `docker-compose`) |
| Cổng trống | **80 và 443** cho `caddy` — từ task #6, đó là đường vào duy nhất; `api` không còn publish cổng nào. Máy đã dùng 80/443 thì đặt `CADDY_HTTP_PORT` / `CADDY_HTTPS_PORT` |
| RAM | **≥4GB**. Trần RAM của cụm cộng lại 3200M (xem `.env.sample`); máy 2GB phải hạ `API_REPLICAS` và `API_MEM` xuống |
| Dung lượng | ~1.5GB cho ảnh và dữ liệu MySQL |

Không cần cài Node, không cần cài MySQL. Cả hai nằm trong container.

---

## Chạy lần đầu

```bash
git clone <repo> && cd Zoldify_Backend
cp .env.sample .env
```

Mở `.env` và điền **ít nhất ba thứ**, phần còn lại để trống vẫn chạy được:

| Biến | Vì sao bắt buộc |
|---|---|
| `DB_PASSWORD` | trở thành mật khẩu root của MySQL trong cụm. Để trống thì compose **dừng** kèm thông báo, thay vì dựng một database mật khẩu rỗng |
| `JWT_ACCESS_SECRET` | thiếu thì mọi token ký bằng chuỗi rỗng |
| `JWT_REFRESH_TOKEN_SECRET` | như trên |

Sinh khoá:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Rồi:

```bash
npm run docker:up      # docker compose up -d --build
npm run docker:logs    # xem log của api
```

Kiểm tra:

```bash
curl http://localhost/
# {"statusCode":200,"message":"","data":"Hello World!"}
```

Tài liệu API: <http://localhost/api/docs>

**Cổng 80 chứ không phải 3000 nữa.** Từ task #6 cụm chạy ba bản `api`, và ba
bản không thể cùng ánh xạ một cổng host — `caddy` là đường vào duy nhất. Máy đã
có thứ khác giữ cổng 80 thì đặt `CADDY_HTTP_PORT=8080` trong `.env`.

Xem cụm đang chạy mấy bản:

```bash
docker compose ps api        # phải ra 3 dòng
```

---

## Sáu dịch vụ, chạy đúng thứ tự này

```
mysql + redis  →  migrate (chạy một lần rồi thoát)  →  api ×3 + worker ×1  →  caddy
```

`api` chỉ khởi động khi `migrate` đã thoát bằng mã 0
(`condition: service_completed_successfully`), và `migrate` chỉ chạy khi MySQL
đã trả lời `mysqladmin ping`.

**Vì sao migration là bước riêng, không nhét vào lúc api khởi động.** Nhét vào
thì hai chuyện xấu xảy ra cùng lúc: dựng hai bản api là hai tiến trình cùng đổi
lược đồ, và migration hỏng khiến api rơi vào vòng khởi động lại vô tận, mỗi vòng
lại thử migrate một lần. Tách ra thì hỏng là dừng hẳn, và log nằm nguyên một chỗ:

```bash
docker compose logs migrate
```

---

## Dữ liệu nằm ở đâu

Hai volume có tên. **Có tên** chứ không phải bind mount là chủ ý: lần tạo đầu
Docker chép nội dung sẵn có trong ảnh vào volume, nên 26 ảnh danh mục đang được
git theo dõi vẫn còn nguyên.

| Volume | Chứa gì | Mất thì sao |
|---|---|---|
| `zoldify_mysql-data` | toàn bộ database | mất sạch dữ liệu |
| `zoldify_product-images` | ảnh người bán tải lên | mất sạch ảnh hàng |

Ảnh nằm trên **đĩa**, không phải trên object storage — `multer.config.ts` dùng
`diskStorage` ghi vào `public/images/{folder_type}`, và không có client R2 hay S3
nào trong `src/`. Đó là lý do dòng volume kia không được bỏ: thiếu nó, ảnh nằm
trong lớp ghi của container, và `docker compose up` với ảnh mới tạo container
mới — toàn bộ ảnh hàng của mọi người bán biến mất.

Đã đo, không phải suy luận: ghi một file vào `/app/public/images`, chạy
`docker compose down` rồi `up`, file vẫn còn.

```bash
docker compose down        # dừng, GIỮ dữ liệu
docker compose down -v     # dừng và XOÁ cả hai volume
```

### Prod: MySQL ở máy riêng (từ 06/11/2026)

Dữ liệu 1 triệu dòng chiếm 7,3 GB trên VPS 40 GB, mỗi lần deploy lại cần thêm
1,8 GB, nên MySQL prod đã chuyển sang `tdatdev` (Oracle ARM Singapore, 24 GB RAM,
`/opt/zoldify-db`). Web, API, Redis, ảnh vẫn ở VPS. Staging giữ MySQL riêng trên
VPS, không đổi.

`docker-compose.override.yml` trên VPS (không commit) thay service `mysql` bằng
một đường hầm SSH mang đúng tên đó, nên `DB_HOST: mysql` của api, worker, migrate
và backup giữ nguyên. Khóa nằm ở `/opt/zoldify-db-tunnel`, trên `tdatdev` chỉ được
chuyển tiếp tới `127.0.0.1:3306`, không có shell. Dùng cổng 22 vì Oracle chỉ mở
cổng đó; MySQL không mở ra Internet.

Ba điều không được quên:

- **Không bật lại host cache** trên `tdatdev`. Mọi kết nối qua đường hầm chung một
  IP, health check bỏ dở bắt tay nên tính vào `max_connect_errors`; đủ 100 lần là
  MySQL khóa IP đó, tức là khóa cả prod. Vì vậy có `--host-cache-size=0`.
- **Đừng thử đường hầm bằng `docker kill`.** Docker coi đó là dừng tay nên
  `unless-stopped` không dựng lại, prod sẽ nằm đến khi có người `docker start`.
  Đã dính thật khi thử; muốn giả lập đứt thì giết tiến trình `ssh` từ host.
- **Mỗi câu SQL tốn thêm khoảng 32 ms** (TP.HCM đến Singapore). Đo 06/11: đọc ở 50
  kết nối không lỗi và nhanh hơn trước nhờ RAM, nhưng đặt đơn còn 1,2 đến 1,6 giây
  và 12,5 đơn/giây (trước khoảng 30). Thêm câu SQL tuần tự vào một request là cộng
  thẳng độ trễ này.

Volume `zoldify_mysql-data` trên VPS đã xoá ngày 06/11 để lấy lại đĩa, nên bảng ở
mục trên chỉ còn đúng với staging. Muốn đưa MySQL về VPS phải dùng lại
`docker-compose.override.yml.bak-20261106` rồi khôi phục từ bản backup, theo mục
"Sao lưu và khôi phục"; 7 GB dữ liệu không còn vừa VPS 40 GB nếu không dọn trước.

---

## Cập nhật phiên bản mới

```bash
git pull
npm run docker:up          # dựng lại ảnh, chạy migration, khởi động lại api
```

Chưa có CI nên chưa có ảnh dựng sẵn trên registry — máy chủ tự dựng lấy. Xem
`r8-cicd-pipeline` để biết phần nào của quy trình đã có, phần nào chưa.

**Deploy thay lần lượt từng bản api, không tắt cả cụm.** CI chạy
`bash scripts/deploy/lan-luot-api.sh <zoldify|zoldify-staging>`. Deploy tay trên VPS
cũng dùng lệnh này, đừng dùng `docker compose up -d --build`: lệnh đó tạo lại cả
ba bản api cùng lúc và API trả 502 khoảng 5 giây. Script làm theo thứ tự:

1. build ảnh;
2. bật lại mọi dịch vụ trừ api và caddy (migration chạy xong ở bước này);
3. caddy: Caddyfile có đổi thì tạo lại container (mất kết nối khoảng 1 giây),
   làm trước bước 4 để cấu hình thử lại khi nối hỏng có mặt lúc tắt bản cũ;
4. với từng bản api cũ: bật một bản mới, chờ `/health`, chờ caddy thấy nó, rồi
   `docker stop` bản cũ. Bản cũ trả mọi response kèm `Connection: close` 10 giây
   cho caddy bỏ kết nối cũ, rồi đóng cổng và phục vụ nốt request đang chạy
   (`src/common/tat-em.ts`). Caddy nối vào bản đã đóng thì thử bản khác.

Bản mới không khoẻ sau 120 giây thì script xoá nó và dừng với mã 1, các bản cũ
vẫn chạy. Migration đã chạy ở bước 2 nên phải tương thích với code cũ trong lúc
thay, như trước đây (đổi tên hay xoá cột thì tách hai lần deploy).

**Có sửa `Caddyfile` thì phải tạo lại container caddy.** File gắn vào bằng bind
mount một file, nên `git checkout` thay file mới mà container vẫn đọc bản cũ, và
`docker compose up -d` thấy cấu hình dịch vụ không đổi nên không làm gì. Script
deploy tự so và tạo lại; làm tay thì:

```bash
docker compose -p <zoldify|zoldify-staging> up -d --force-recreate --no-deps caddy
```

---

## Database dựng từ số không

`src/migrations/1690000000000-InitialSchema.ts` tạo toàn bộ 25 bảng. Sau nó là
năm migration cũ, tất cả đều chịu được chạy lại.

**Chuyện đã xảy ra và vì sao có file đó.** Trước ngày 14/08, năm migration đang
có đều là `ALTER` — thêm index, thêm cột, xoá cột — và không cái nào tạo `users`,
`products`, `orders`. Các bảng ấy sinh ra từ `synchronize: true` trên máy người
viết code rồi không ai chép lại vào migration. Chạy `migration:run` trên một
database rỗng cho ra **đúng 4 bảng**.

Tệ hơn: nó không báo lỗi. `AddPerformanceIndexes` bọc mọi câu lệnh trong
`.catch(() => {})`, nên nó nuốt `Table 'products' doesn't exist` rồi tự ghi vào
bảng `migrations` là đã chạy xong. Một database rỗng mang nhãn *"đã cập nhật tới
bản mới nhất"*, và lần `migration:run` sau trả lời "không có gì để chạy".

Phát hiện đúng lúc chạy `docker compose up` lần đầu — đó là giá trị của việc
viết file triển khai thay vì tả nó.

Máy nào đã có sẵn lược đồ từ `synchronize` thì `InitialSchema` tự bỏ qua: nó
kiểm `hasTable('users')` trước, thấy có thì ghi nhận là đã chạy rồi thoát. Không
ai phải xoá database đang làm việc.

---

## Sao lưu và khôi phục

Service `backup` (ảnh `mysql:8`, chạy `scripts/backup-db.sh`) dump database
ngay khi khởi động, tức mỗi lần deploy, rồi 24 giờ một lần, vào `./backups`
cạnh file compose. Giữ 14 ngày (đổi bằng `BACKUP_KEEP_DAYS` trong `.env`).
File chỉ xuất hiện khi dump chạy hết và kiểm được dòng "Dump completed"; bản
hỏng giữa chừng bị bỏ, không nằm lẫn với bản tốt.

**Đừng cài thêm cron `scripts/backup-mysql.sh`.** Script đó (task #24) là cách
sao lưu trước đây, chạy bằng crontab trên máy chủ, nhưng chưa từng được cài lên
VPS (29/09: crontab không có dòng nào, không có thư mục backup nào). Service
`backup` thay thế nó; cài cả hai thì mỗi đêm có hai bản dump chồng nhau.

```bash
ls -lh backups/                          # các bản đang có
docker compose -p zoldify logs backup    # lần chạy gần nhất: [backup] OK hay LỖI
docker compose -p zoldify run --rm -e BACKUP_ONCE=1 backup   # dump ngay một bản
```

**Khôi phục.** Lệnh này GHI ĐÈ database đang chạy, nên dừng api trước. Mật
khẩu đọc từ biến có sẵn trong container mysql, không gõ ra dòng lệnh:

```bash
docker compose -p zoldify stop api
gunzip -c backups/zoldify-YYYYMMDD-HHMMSS.sql.gz \
  | docker compose -p zoldify exec -T mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"'
docker compose -p zoldify start api
```

**Thử khôi phục trước khi cần thật.** Một bản sao lưu chưa từng được khôi phục
thì chưa biết có dùng được không. Làm một lần vào database tạm:

```bash
docker compose -p zoldify exec -T mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -e "CREATE DATABASE restore_test"'
gunzip -c backups/<file>.sql.gz \
  | docker compose -p zoldify exec -T mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" restore_test'
docker compose -p zoldify exec -T mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -e "SELECT COUNT(*) FROM restore_test.orders; DROP DATABASE restore_test"'
```

`./backups` vẫn nằm trên cùng VPS: chống được xoá nhầm, migration hỏng, dữ liệu
bị ghi sai, nhưng **không** chống được mất cả máy. Vì vậy có thêm service
`offsite`.

### Bản ngoài VPS (Cloudflare R2)

Service `offsite` (ảnh `rclone/rclone`, chạy `scripts/offsite-backup.sh`) chép
`./backups` lên bucket `zoldify-backups` mỗi 6 giờ, vào thư mục `prod/` hoặc
`staging/` theo `BACKUP_R2_PREFIX`. Trên R2 giữ 30 ngày (`OFFSITE_KEEP_DAYS`),
lâu hơn bản local 14 ngày. Chỉ thêm, không đồng bộ xoá: bản local bị xoá nhầm
thì bản trên R2 vẫn còn.

Cần 4 biến trong `.env` (cùng với `R2_ACCOUNT_ID` đã có):

| Biến | Giá trị |
|---|---|
| `BACKUP_R2_ACCESS_KEY_ID`, `BACKUP_R2_SECRET_ACCESS_KEY` | token R2 **riêng**: tên `zoldify-backup-vps`, quyền Object Read & Write, chỉ bucket `zoldify-backups`, chỉ IP của VPS |
| `BACKUP_R2_BUCKET` | `zoldify-backups` |
| `BACKUP_R2_PREFIX` | `prod` hoặc `staging` |

Đừng dùng lại hay nới quyền `R2_ACCESS_KEY_ID` của ứng dụng: token đó chỉ vào
được bucket ảnh `zoldify-images` (vào `zoldify-backups` bị 403), và nới nó ra
thì một lỗ hổng ở api là đủ để đọc hay xoá bản sao lưu. Đổi IP VPS thì phải sửa bộ lọc IP của token trên
Cloudflare (R2, Manage API tokens), nếu không `offsite` báo lỗi 403.

```bash
docker compose -p zoldify logs offsite   # [offsite] OK r2:zoldify-backups/prod: N bản, mới nhất ...
docker compose -p zoldify exec -T -e OFFSITE_ONCE=1 offsite sh /offsite-backup.sh   # chép ngay
```

**Khôi phục khi mất cả VPS.** Trên máy mới, dựng lại theo tài liệu này, rồi
tải bản cần dùng về `./backups` và làm như mục khôi phục ở trên. Tải bằng
chính service `offsite` thì không phải cài rclone, nhưng mount `./backups` của
nó là chỉ đọc, nên tải vào `/tmp` trong container rồi `docker compose cp` ra:

```bash
docker compose -p zoldify exec offsite sh -c 'export RCLONE_CONFIG_R2_TYPE=s3 RCLONE_CONFIG_R2_PROVIDER=Cloudflare RCLONE_CONFIG_R2_ACCESS_KEY_ID="$BACKUP_R2_ACCESS_KEY_ID" RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$BACKUP_R2_SECRET_ACCESS_KEY" RCLONE_CONFIG_R2_ENDPOINT="https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com" RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true; rclone lsf r2:zoldify-backups/prod; rclone copy r2:zoldify-backups/prod/zoldify-YYYYMMDD-HHMMSS.sql.gz /tmp/'
docker compose -p zoldify cp offsite:/tmp/zoldify-YYYYMMDD-HHMMSS.sql.gz backups/
```

Máy mới có IP khác thì token sẽ từ chối (403): sửa bộ lọc IP của token trước,
hoặc tải file trực tiếp trên dashboard Cloudflare (R2, bucket
`zoldify-backups`).

---

## Chưa có, và biết là chưa có

| Thứ | Trạng thái |
|---|---|
| CI/CD | không có `.github/workflows` trong bất kỳ repo nào |
| HTTPS / reverse proxy | **đã dựng** (task #6): `caddy` kết thúc TLS, chia tải cho ba bản api bằng `dynamic a`. Chưa ai kiểm trên VPS thật xem thứ gì đang giữ 80/443 — phải làm trước lần deploy đầu |
| Redis | **không có dòng code nào dùng** — bộ nhớ đệm nằm trong tiến trình Node (`CacheModule.register()`), nên compose cũng không khởi động Redis |
| Nhân bản API | **đã có** (task #6): ba bản, `API_REPLICAS` chỉnh được. Chỗ để ảnh không còn chặn vì cả ba bản ở **cùng một VPS** nên mount chung `product-images`; trải ra nhiều máy mới cần R2/S3 |
| Healthcheck thật | `GET /` chỉ nói tiến trình còn sống, **không** chạm database. Cụm vẫn báo healthy khi MySQL đã chết |

---

## Khi hỏng

**`compose up` dừng ngay với `DB_PASSWORD đang trống`** — đúng như thiết kế. Điền
`DB_PASSWORD` vào `.env`.

**`api` khởi động rồi tắt.** Xem `docker compose logs api`. Thường là biến môi
trường thiếu; `npm run env:check` liệt kê biến nào chưa có.

**`migrate` thoát khác 0.** `api` sẽ không khởi động — đó là chủ ý. Đọc
`docker compose logs migrate`, sửa, rồi `npm run docker:up` lại.

**`ports are not available: ... 80`** (hoặc 443). Cổng đang bị chiếm — trên VPS
thường là một reverse proxy cài thẳng trên máy, trên máy cá nhân thường là IIS
hay một cụm compose khác. Xem ai giữ rồi đặt cổng khác:

```bash
ss -ltnp | grep -E ':(80|443)'      # Linux
netstat -ano -p tcp | findstr ":80 "  # Windows
```

```
CADDY_HTTP_PORT=8080
CADDY_HTTPS_PORT=8443
```

**`api` chết với mã 137 lúc tải cao, log không có lỗi nào.** Đó là OOM-killer,
không phải app crash. Trần đặt ở `API_MEM`, và `API_HEAP_MB` phải THẤP HƠN nó —
Node không đọc `mem_limit`, nó nhắm kích thước heap theo RAM của cả máy.

**Cụm chạy nhưng số đo không khá hơn một bản.** Kiểm `docker compose ps api` ra
đủ ba dòng, rồi kiểm `Caddyfile` còn dùng `dynamic a`. Dạng
`reverse_proxy api:3000` chốt một IP lúc khởi động: ba bản chạy, tải dồn vào
một. `npm run check:compose` gác đúng chỗ này.

**Muốn xoá sạch làm lại từ đầu:**

```bash
docker compose down -v && npm run docker:up
```
