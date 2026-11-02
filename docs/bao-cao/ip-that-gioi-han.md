# IP thật cho giới hạn tần suất (02/11/2026)

Nhánh `fix/ip-that-cho-gioi-han` (tách từ `origin/staging` a5a2d90). Đã chạy và
đo trên **staging**. **Prod chưa đổi gì**, checklist ở mục 5.

## 1. Triệu chứng và nguyên nhân gốc

ThrottlerGuard của `@nestjs/throttler` khoá theo `req.ip`. Đo ngày 02/11 trước
khi sửa: mọi khách cùng một `req.ip`, cả trang dùng chung một xô 10 req/s. Một
máy gửi 4 req/s cũng nhận 429 cho cả 12 request. Nhật ký thao tác admin
(`admin_action_logs.ip`) ghi cùng một địa chỉ cho mọi admin.

Đường đi thật trên VPS:

```
khách -> Cloudflare -> nginx máy chủ (:443) -> Caddy (container, 127.0.0.1:3000/3100) -> api (3 bản)
```

Ba lớp cùng sai:

| Lớp | Hành vi cũ | Hậu quả |
|---|---|---|
| nginx | `$remote_addr` là IP máy biên Cloudflare, `X-Forwarded-For $proxy_add_x_forwarded_for` nối thêm cả phần khách tự gửi | IP nhìn thấy là máy Cloudflare, và XFF chứa rác do khách viết |
| Caddy | không khai `trusted_proxies` nên coi peer là không tin được và **thay** XFF bằng IP peer | IP khách bị xoá, chỉ còn cổng docker `172.18.0.1` |
| api (Express) | `trust proxy 1`: lấy phần tử cuối XFF | phần tử cuối là `172.18.0.1`, giống nhau cho mọi người |

Đổi `trust proxy` thành `2` cũng không bền: thêm hay bớt một chặng là lệch, và
lệch về phía để khách tự viết IP.

## 2. Ba lớp đã đổi

1. **nginx** (máy chủ, không nằm trong repo)
   - `/etc/nginx/conf.d/cloudflare-real-ip.conf`: 22 dòng `set_real_ip_from`
     (dải IPv4 + IPv6 của Cloudflare, lấy 02/11) và `real_ip_header CF-Connecting-IP;`.
     nginx chỉ thay `$remote_addr` bằng `CF-Connecting-IP` khi peer là máy
     Cloudflare, nên ai gọi thẳng IP máy chủ thì header giả bị bỏ qua.
     **Lưu ý:** file nằm trong `conf.d` nên áp cho MỌI site trên nginx này, kể cả
     prod. Với prod hiện tại nó chỉ đổi `$remote_addr` trong log nginx và header
     `X-Real-IP`; `req.ip` của prod vẫn như cũ vì Caddy prod còn ghi đè XFF.
   - `/etc/nginx/sites-enabled/api-staging.zoldify.com`:
     `proxy_set_header X-Forwarded-For $remote_addr;` (ghi đè, không nối), nên
     XFF đi vào Caddy chỉ còn đúng một địa chỉ là IP thật.
2. **Caddy** (commit 8d70e55, `Caddyfile`): khối toàn cục
   `servers { trusted_proxies static private_ranges }`. Caddy giữ XFF do nginx
   ghi khi peer là dải private (cổng docker), còn peer công khai nối thẳng vẫn
   bị ghi đè.
3. **api** (commit af742fe, `src/common/tin-proxy.ts`): `trust proxy` =
   `'loopback, linklocal, uniquelocal'`. `req.ip` là địa chỉ công khai ngoài cùng
   bên phải trong XFF, đúng với mọi số chặng proxy. Phần khách tự chèn luôn nằm
   bên trái địa chỉ proxy ghi, nên không được dùng. Bài kiểm
   `src/common/tin-proxy.spec.ts` (commit 99c05f6) đỏ 4/5 với `1`, xanh 5/5 sau sửa.

Commit thêm 78dc7bf chỉ sửa chú thích cột `ip` của `AdminActionLog` (varchar 45
đã đủ cho IPv6 ánh xạ IPv4) và sinh lại `openapi.json`.

## 3. Trạng thái trên VPS lúc viết

- Staging (`/opt/staging/zoldify-backend`, project compose `zoldify-staging`):
  checkout nhánh `fix/ip-that-cho-gioi-han` (8d70e55), file tạm
  `docker-compose.ip-that.yml` (không commit) trỏ `api` và `worker` sang image
  `zoldify-backend:ip-that` (bffe9d5fbcb1). 3 bản api healthy, worker và caddy
  đã tạo lại.
- Prod (`/opt/zoldify-backend`, project `zoldify`): **không đụng**. Vẫn image
  `zoldify-backend:latest` (9c9a13203203), checkout a5a2d90, Caddyfile chưa có
  `trusted_proxies`, nginx `api.zoldify.com` vẫn `$proxy_add_x_forwarded_for`.
  `https://api.zoldify.com/api/v1/categories` trả 200.

## 4. Số đo nghiệm thu trên staging (02/11, khoảng 18:20 giờ VN)

Máy Windows (IP công khai 1.53.166.166), VPS (103.249.117.151). Giới hạn:
`short` 10 req/1s, `medium` 50 req/10s, `long` 300 req/60s.

| Bài | Cách đo | Kết quả |
|---|---|---|
| Hai nguồn cùng lúc, lượt 1 | VPS bắn khoảng 17 req/s trong 20 s; máy Windows gửi tuần tự song song cùng lúc | VPS 348 request: **324 x 429**, 24 x 200. Windows 26 request: **26 x 200, 0 x 429** |
| Hai nguồn cùng lúc, lượt 2 | như trên, Windows gửi 3 request song song mỗi giây | VPS 360: **340 x 429**, 20 x 200. Windows 30: **30 x 200, 0 x 429** |
| Giả XFF qua Cloudflare | 20 request song song, mỗi cái `X-Forwarded-For: 9.9.9.i` và `X-Real-IP: 7.7.7.i` khác nhau | **10 x 200, 10 x 429**: đúng 10/s của một xô, tức vẫn đếm vào IP thật |
| Giả `CF-Connecting-IP` qua Cloudflare | header `CF-Connecting-IP: 8.8.4.4` | Cloudflare chặn ở biên: 403 `error code: 1000` |
| Gọi thẳng IP máy chủ, bỏ qua Cloudflare | `--resolve api-staging.zoldify.com:443:103.249.117.151`, 20 request song song, mỗi cái `CF-Connecting-IP` và XFF khác nhau | **10 x 200, 10 x 429**: nginx không tin header từ peer không phải Cloudflare |
| Nhật ký admin | đăng nhập `admin@zoldify.com`, `PATCH /admin/users/8/lock` rồi `/unlock`, kèm XFF giả `6.6.6.6` và `X-Real-IP 5.5.5.5` | `admin_action_logs` id 2 và 3 ghi `ip = 1.53.166.166` (IP thật). Toàn bảng: 3 dòng, một IP duy nhất 1.53.166.166 |

Trước khi sửa, cùng bài hai nguồn thì máy Windows nhận 429 vì dùng chung xô với VPS.

Bài kiểm đơn vị: `npx jest src/common/tin-proxy.spec.ts` 5/5 xanh;
`npm run openapi:gen` khớp `openapi.json` đã commit.

## 5. Checklist đưa lên prod (CHƯA làm)

Làm theo đúng thứ tự. Không build đè tag `zoldify-backend:latest` trước khi đã
chạy ổn tag mới: `latest` là đường lùi.

0. Gộp nhánh `fix/ip-that-cho-gioi-han` vào `staging` theo quy trình (PR, nghiệm thu
   `npm run nghiem-thu` xanh), rồi mới đưa lên prod.
1. **nginx prod.** Sao lưu rồi sửa một dòng:
   ```bash
   cp /etc/nginx/sites-enabled/api.zoldify.com /root/api.zoldify.com.nginx.bak-$(date +%Y%m%d)
   sed -i 's|proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;|proxy_set_header X-Forwarded-For $remote_addr;|' /etc/nginx/sites-enabled/api.zoldify.com
   grep -n "X-Forwarded-For" /etc/nginx/sites-enabled/api.zoldify.com
   nginx -t && systemctl reload nginx
   ```
   `cloudflare-real-ip.conf` đã có trong `conf.d`, không cần thêm. Bước này một
   mình chưa đổi `req.ip` (Caddy prod còn ghi đè XFF), nên làm trước an toàn.
2. **Mã nguồn prod.** Trong `/opt/zoldify-backend`, checkout commit đã gộp
   (`git fetch origin && git checkout <commit-đã-gộp>`), kiểm
   `grep -n trusted_proxies Caddyfile` và
   `grep -n uniquelocal src/common/tin-proxy.ts` đều có.
3. **Build image tag mới**, không đụng `latest`:
   ```bash
   cd /opt/zoldify-backend
   docker build -t zoldify-backend:ip-that-prod .
   ```
4. **Override tạm** `/opt/zoldify-backend/docker-compose.ip-that.yml` (giống staging):
   ```yaml
   services:
     api:
       image: zoldify-backend:ip-that-prod
     worker:
       image: zoldify-backend:ip-that-prod
   ```
5. **Lên api, worker, rồi caddy** (không đụng mysql/redis/backup):
   ```bash
   cd /opt/zoldify-backend
   docker compose -p zoldify -f docker-compose.yml -f docker-compose.override.yml -f docker-compose.ip-that.yml up -d --no-deps api worker
   docker compose -p zoldify -f docker-compose.yml -f docker-compose.override.yml -f docker-compose.ip-that.yml up -d --no-deps --force-recreate caddy
   docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}' | grep '^zoldify-'
   ```
   Chờ 3 bản api `healthy`. Không có migration trong thay đổi này.
6. **Kiểm sau khi lên:**
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" https://api.zoldify.com/api/v1/categories   # 200
   ```
   - Từ VPS: 20 request song song tới `/api/v1/categories` thì có khoảng 10 x 429;
     cùng lúc một máy khác gửi 2 đến 3 req/s nhận 0 x 429. (Không cần bắn 20 giây
     trên prod, một loạt ngắn là đủ.)
   - Từ máy ngoài: 20 request song song, mỗi cái XFF giả khác nhau, phải có
     khoảng 10 x 429 (vẫn đếm vào IP thật).
   - Một thao tác admin nhỏ trên prod, rồi
     `SELECT id, path, ip, created_at FROM admin_action_logs ORDER BY id DESC LIMIT 3;`
     phải ra IP công khai thật của người thao tác, không phải `172.x`.
7. **Khi đã ổn vài ngày:** retag để bỏ override
   (`docker tag zoldify-backend:ip-that-prod zoldify-backend:latest`, xoá
   `docker-compose.ip-that.yml`, `up -d api worker` lại), hoặc để deploy bình
   thường build `latest` từ `staging`. Làm tương tự với staging.

## 6. Rollback

Prod, nếu bước 5 hỏng:

```bash
cd /opt/zoldify-backend
git checkout a5a2d90                       # Caddyfile cũ
docker compose -p zoldify -f docker-compose.yml -f docker-compose.override.yml up -d --no-deps api worker
docker compose -p zoldify -f docker-compose.yml -f docker-compose.override.yml up -d --no-deps --force-recreate caddy
cp /root/api.zoldify.com.nginx.bak-YYYYMMDD /etc/nginx/sites-enabled/api.zoldify.com && nginx -t && systemctl reload nginx
```

Image `zoldify-backend:latest` (9c9a13203203) vẫn nguyên nên lùi chỉ là bỏ file
override.

Staging, nếu cần lùi:

```bash
cd /opt/staging/zoldify-backend
git checkout staging                        # hoặc commit trước 99c05f6
docker compose -p zoldify-staging -f docker-compose.yml -f docker-compose.override.yml up -d --no-deps api worker
docker compose -p zoldify-staging -f docker-compose.yml -f docker-compose.override.yml up -d --no-deps --force-recreate caddy
sed -i 's|proxy_set_header X-Forwarded-For $remote_addr;|proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;|' /etc/nginx/sites-enabled/api-staging.zoldify.com
nginx -t && systemctl reload nginx
```

`cloudflare-real-ip.conf` có thể giữ: nó chỉ làm `$remote_addr` đúng hơn. Muốn
gỡ thì xoá file đó rồi `nginx -t && systemctl reload nginx`.

## 7. Nợ còn lại

- Danh sách dải Cloudflare trong `cloudflare-real-ip.conf` là bản chụp ngày
  02/11. Cloudflare đổi dải thì phải cập nhật tay, nếu không khách đi qua dải
  mới sẽ hiện là IP máy Cloudflare (sai nhưng không giả được). Gỡ nợ: cron lấy
  `https://www.cloudflare.com/ips-v4` và `/ips-v6` rồi `nginx -t && reload`.
- Origin vẫn nhận kết nối thẳng không qua Cloudflare (đo được 200). IP vẫn
  đúng và không giả được, nhưng có thể chặn hẳn bằng tường lửa chỉ mở 443 cho
  dải Cloudflare.
