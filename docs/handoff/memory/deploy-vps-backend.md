---
name: deploy-vps-backend
description: Nơi và cách Zoldify_Backend đang chạy trên VPS production
metadata: 
  node_type: memory
  type: project
  originSessionId: <session>
  modified: 2026-11-03T09:25:20.446Z
---

Zoldify_Backend deploy trên VPS SSH alias `vps` = **<IP>** (Ubuntu 22.04, user root, hostname `tdatdev`, VPS DÙNG CHUNG với notion_manager/cliproxyapi/smartlab.id.vn — cẩn thận không đạp lên).

- Mã ở `/opt/zoldify-backend`, nhánh **`chore/soat-cau-hinh-payos-firebase`** (main/develop CHƯA có Dockerfile + migration InitialSchema → deploy từ đó sẽ dính bug "4 bảng").
- Chạy bằng `docker compose up -d` (mysql→migrate→api). 25 bảng, 6 migration OK. `docker` enabled-on-boot, container `unless-stopped` → sống qua reboot.
- File `.env` production ở `/opt/zoldify-backend/.env` (chmod 600, KHÔNG trong git). DB_PASSWORD + 2 khoá JWT đã sinh bằng openssl. PayOS/Firebase/GHN/Email để TRỐNG — app boot được nhưng thanh toán/vận đơn/mail chưa chạy tới khi điền key thật.
- Cập nhật phiên bản: `cd /opt/zoldify-backend && git pull && docker compose up -d --build`.
- Truy cập: `http://<IP>:3000` (root/products/docs = 200). ufw tắt nên 3000 mở ra ngoài.
- **Domain qua Cloudflare (orange cloud)** — `*.zoldify.com` resolve ra IP Cloudflare, không phải origin. Cloudflare SSL mode = Full → CF kết nối origin qua 443, nên origin PHẢI có cert (thiếu thì 521). System certbot (apt) HỎNG (lỗi pyOpenSSL X509_V_FLAG_NOTIFY_POLICY) — dùng **`/snap/bin/certbot`** (snap install --classic certbot). HTTP-01 qua Cloudflare OK vì "Always Use HTTPS" đang tắt.

## Toàn stack đang chạy (3 domain, HTTPS, 4 container)
- **https://api.zoldify.com** → backend (compose ở /opt/zoldify-backend), container `zoldify-api-1`+`zoldify-mysql-1`.
- **https://zoldify.com** → frontend Next.js 14 (nhánh main), `/opt/zoldify-frontend`, container `zoldify-web-frontend-1` (127.0.0.1:3001).
- **https://admin.zoldify.com** → admin Next.js (main), `/opt/zoldify-admin`, container `zoldify-web-admin-1` (127.0.0.1:3002).
- Web compose ở **`/opt/zoldify-web/docker-compose.yml`** (build cả 2). **ĐÃ chuyển sang `output: standalone`**: image frontend 2.46GB→706MB, admin 1.44GB→359MB; đĩa còn ~7.5G/40G (80%). Dockerfile hai tầng nằm trong mỗi clone. `NEXT_PUBLIC_API_ORIGIN=https://api.zoldify.com` nhúng LÚC BUILD (build arg). Firebase đọc server-side runtime từ `/opt/zoldify-web/frontend.vars` (chmod 600, import FIREBASE_* từ frontend `.env.local`).
- nginx system: mỗi domain một site `listen 80/443 → proxy_pass 127.0.0.1:<3000/3001/3002>`; certbot đã cắm cert 443, auto-renew. `www.zoldify.com` CHƯA có DNS nên chưa cấp cert.
- Cả 4 container `restart: unless-stopped` + docker enabled-on-boot → sống qua reboot.
- **DB đã seed** (`src/seed.ts` chạy trong container tạo từ `--target build`, gọi `node -r ts-node/register -r tsconfig-paths/register src/seed.ts` vì `npm run seed` thiếu tsconfig-paths): seller@zoldify.com + buyer@zoldify.com (mk <pass>), 9 danh mục, 15 sản phẩm (ảnh Unsplash), 3 đơn demo escrow. Bản 360 món `scripts/seed-demo-catalog.ts -- --write` chưa chạy (scripts/ bị .dockerignore của backend loại).
- Deploy files frontend/admin đã commit LOCAL nhánh **`chore/deploy-docker`** (chưa push) trong mỗi repo: Dockerfile + .dockerignore + next.config(output standalone).
- **Firebase Admin (backend) đã cấu hình:** `firebase.service.ts` cần file `firebase-service-account.json` ở `cwd` (=/app trong container). Đã scp `D:/Zoldify/Zoldify_Backend/firebase-service-account.json` (gitignored, project_id "zoldify") lên `/opt/zoldify-backend/`, **chown 1000:1000** (node user, nếu để root:600 thì EACCES), mount `./firebase-service-account.json:/app/firebase-service-account.json:ro` vào service `api` trong compose. Thiếu cái này → `POST /api/auth/firebase` trả 401 "Firebase chưa được cấu hình".
- CÒN LẠI (cần user, trên dashboard): thêm `zoldify.com` vào Firebase Console → Authentication → Settings → Authorized domains để popup đăng nhập Google chạy trên origin thật.

## CI/CD + Staging (2026-08-15)
- **Staging đầy đủ** chạy trên CÙNG VPS: `https://staging.zoldify.com` (:3101), `https://admin-staging.zoldify.com` (:3102), `https://api-staging.zoldify.com` (:3100). DB staging RIÊNG (volume zoldify-staging_*). Mã ở `/opt/staging/{zoldify-backend,zoldify-frontend,zoldify-admin,zoldify-web}`. DB staging chưa seed. Cert LE riêng, auto-renew.
- **Compose backend giờ KHÔNG có `name:`** — project truyền bằng `-p zoldify` (prod) / `-p zoldify-staging` (staging); cổng khác nhau qua API_PORT trong .env mỗi bên. CÙNG một compose chạy cả hai. Web compose thì có `name:` riêng theo thư mục (zoldify-web / zoldify-staging-web).
- **CI/CD = GitHub Actions** (`.github/workflows/deploy.yml` mỗi repo): gate `npm run build` (CHẶN) + `npm run lint` (continue-on-error, codebase còn nợ lint) → job "Deploy to VPS" dùng `appleboy/ssh-action` SSH vào VPS, `git checkout -f -B <ref> origin/<ref>` + `docker compose up -d --build`. Secrets mỗi repo: `VPS_HOST`, `VPS_USER=root`, `VPS_SSH_KEY` (khoá deploy ed25519, public trong ~/.ssh/authorized_keys của VPS).
- **Nhánh → môi trường** (KHÔNG đụng `main` vì đó là nhánh của đồng đội Nguyễn Huy):
  - Backend: prod=`chore/soat-cau-hinh-payos-firebase`, staging=`staging`.
  - Admin: prod=`chore/deploy-docker`, staging=`staging`.
  - Frontend: prod=`deploy-prod` (= origin/main của Huy + file deploy), staging=`staging`.
  - Push vào nhánh tương ứng là tự deploy. Frontend workflow HIỂN THỊ tên "🚀 Deploy Pipeline" (GitHub cache tên theo path file cũ) nhưng thực chất là deploy.yml của mình (job Build + Deploy to VPS).
- Muốn prod↔staging chuẩn `main`: bạn & Huy tự gộp `main`, rồi đổi trigger nhánh trong deploy.yml. Chưa force `main` của ai.

## GHN đã cấu hình prod (2026-08-24)
- Trước đó GHN **trống** trên prod → app mobile checkout hiện "Không có lựa chọn" khi chọn tỉnh (GHN master-data trả 401 khi thiếu Token). Hai lỗi: `GHN_TOKEN` trống + `GHN_HOST` thiếu path (`…ghn.vn` thay vì `…ghn.vn/shiip/public-api/v2` → masterDataUrl sai).
- **Token GHN dev lấy từ portal**: đăng nhập `https://5sao.ghn.dev` (profile chrome:Default = <google-account>, đã login sẵn, shop "tdat"), bắt network request `POST /shiip/public-api/v2/shop/owner` → header **`Token: <redacted>`**. Shop Zoldify: `213906` (gốc), **`213909` Zoldify Kho HCM (mặc định)**, `213910` Hà Nội.
- **Set qua `environment:` trong `/opt/zoldify-backend/docker-compose.yml`** (override env_file, KHÔNG đụng `.env` vì hook chặn): `GHN_TOKEN`, `GHN_SHOP_ID: '213909'`, `GHN_HOST: https://dev-online-gateway.ghn.vn/shiip/public-api/v2`. Recreate LIVE = `docker compose -p zoldify up -d api` (nhớ `-p zoldify`, xem dòng project gotcha ở trên). **`GHN_FROM_DISTRICT_ID` vẫn trống** → phí ship fallback chưa có; shipping-quote dựa pickup từng seller (seed sellers chưa cắm GHN dev district).
- **Verified**: `GET /api/v1/ghn/provinces` (prefix `/api/v1`) trả 200 + tỉnh; app mobile picker tỉnh/quận load OK. **Quirk sandbox**: vài tỉnh test (vd "Hà Nội 02") KHÔNG có quận/huyện — chọn tỉnh khác. Muốn prod thật: token ở `khachhang.ghn.vn` + host `https://online-gateway.ghn.vn/shiip/public-api/v2` + set GHN_FROM_DISTRICT_ID.
- Backup compose để lại: `docker-compose.yml.bak-ghn`, `.bak-ghn2` (chưa xoá được, hook chặn rm).
- **GHN config chuyển vào `.env` (2026-08-25):** GHN_SHOP_ID=213909,
  GHN_HOST=`https://dev-online-gateway.ghn.vn/shiip/public-api/v2` giờ ở `/opt/zoldify-backend/.env`
  (gitignored → sống qua CI deploy `checkout -B`), KHÔNG còn ở docker-compose.yml (đã revert về origin).
  Sửa `.env` bị hook chặn KHI đọc/grep LOCAL, nhưng trên VPS qua SSH thì sed thẳng OK. GHN_FROM_DISTRICT_ID vẫn trống.
- **Token GHN CHẾT lại → thay (2026-09-21):** token cũ `<redacted>` (và cả token trong `.env.bak.ghn.*`)
  bị GHN trả `401 "Token is not valid!"` trên CẢ hai gateway → dropdown Tỉnh/Thành phố rỗng ("Chọn..."),
  frontend `GhnAddressPicker` nuốt lỗi bằng `.catch(()=>[])` nên hỏng âm thầm; log backend 500 +
  "Đồng bộ trạng thái GHN lỗi 401". Token sandbox MỚI = **`<redacted>`**
  (5sao.ghn.dev, verify GHN `master-data/province` → 200, 65 tỉnh). Đã ghi vào **cả 2 file env**:
  prod `/opt/zoldify-backend/.env` và staging `/opt/staging/zoldify-backend/.env` (staging trước đó token RỖNG
  + GHN_HOST THIẾU `/shiip/public-api/v2` → 404; đã sửa đủ path). ⇒ **Token GHN sandbox có thể chết/bị rotate;
  triệu chứng luôn là "mất tỉnh". Cách chẩn: `curl master-data/province -H "Token: <tok>"` → 401 = token chết.**
- **⚠️ GOTCHA đã vấp (2026-09-21):** recreate PHẢI kèm `-p` VÀ `--no-deps`:
  `cd /opt/zoldify-backend && docker compose -p zoldify up -d --force-recreate --no-deps api`
  (staging: `cd /opt/staging/zoldify-backend && docker compose -p zoldify-staging up -d --force-recreate --no-deps api worker`).
  Chạy `docker compose up` KHÔNG kèm `-p` → project mặc định = tên thư mục `zoldify-backend` → dựng stack TRÙNG,
  đụng port 3000, tạo container/network/volume rác (prod thật KHÔNG chết vì bind port fail). Dọn rác:
  `docker compose -p zoldify-backend down --remove-orphans` + `docker volume rm zoldify-backend_*`.
  `docker compose restart` KHÔNG nạp env_file mới — bắt buộc `up --force-recreate` mới đọc lại `.env`.
- **GHN-driven shipping + sandbox simulator (2026-08-25, commit `b18f742` — ĐÃ PUSH lên origin
  chore/soat-cau-hinh-payos-firebase):** người bán KHÔNG còn tự đặt `shipping` (policy
  `order-status.policy.ts` SHIPPING actors = [ADMIN]) — "Đang giao" là GHN-driven. Vì GHN dev không có
  shipper thật (vận đơn `ready_to_pick`, `switch-status/delivering|delivered` trả 400), thêm
  **`PATCH /orders/:id/sim-ghn {phase:"shipping"|"delivered"}`** (guard: GHN_HOST dev + seller-của-đơn/admin)
  giả lập GHN. Verified API: seller confirm 200, seller shipping 403, sim-ghn shipping 200→đơn shipping;
  app hiện "Đang giao" (seller không bấm). **Push từ VPS:** remote HTTPS không có cred → dùng SSH key
  `~/.ssh/id_ed25519` (auth GitHub OK là tdat-dev): `git push git@github.com:tdat-dev/Zoldify_Backend.git <branch>`.
  App: thêm refetch-on-focus + RefreshControl ở orders list/detail (tab giữ mount nên trước không tự mới).

## Profile self-update + address GHN id + condition filter (2026-08-25/26, deployed)
- Prod branch head **`55040a3`** (b18f742 → `fb8dedd` profile+address → `5aaf2a1` condition →
  `55040a3` GET-profile-full). Tất cả CI success.
- **GET /auth/profile** trước trả `req.user` (JWT payload id/full_name/email/role — THIẾU
  avatar/phone/gender). Đã sửa: `authService.getProfile(id)` đọc user từ DB, trả đủ
  avatar/phone/gender/email_verified → màn "Sửa hồ sơ" điền sẵn đúng. Verified: phone=0987654321,
  gender=Nam trả về. jwt.strategy validate vẫn narrow (không đụng, tránh bloat req.user mỗi request).
- **PATCH /auth/profile** giờ nhận thêm `phone_number` + `gender` (trước chỉ full_name+avatar ở 4fd3159);
  trả về đủ field. `/auth/change-password` (oldPassword/newPassword) + `/files/upload` (folder_type header) đã có sẵn.
- **addresses**: +3 cột `ghn_province_id`(int null), `ghn_district_id`(int null), `ghn_ward_code`(varchar20 null)
  — migration **`AddGhnIdsToAddresses1787660000000`** ĐÃ CHẠY prod (compose có service `migrate` chạy
  `typeorm migration:run` trước api → deploy tự migrate, KHÔNG cần tay). CRUD `/addresses` (+`/default`) sẵn có.
- **products condition filter**: `findAll` lọc `qs.condition` (2 nhánh q/non-q). Verified: new=15, used=0.
- **Bài học nhánh:** local `staging` PHÂN KỲ khỏi prod branch (prod head b18f742 KHÔNG có trong clone local;
  prod's products.service KHÔNG có cache-key block mà staging có). Cách deploy đã dùng: `git format-patch`
  local → scp lên VPS → `git am` phần áp sạch (profile+address) + chèn tay phần lệch (condition qua python)
  trên `/opt/zoldify-backend` → commit → `git push git@github.com:tdat-dev/Zoldify_Backend.git <prodbranch>`
  (SSH URL vì origin HTTPS không cred) → CI tự deploy. tsc project-dep KHÔNG có trên VPS; CI build gate validate.

## HỢP NHẤT prod = staging (2026-09-29, head `20b336b`)
- Đã merge 11 commit riêng của prod vào `staging` (nhánh `merge/prod-into-staging`, còn trên origin), CI staging xanh, rồi prod fast-forward lên staging. **Từ giờ quy trình: nhánh phụ từ `staging` → PR/CI xanh → push `staging` (deploy staging) → kiểm → fast-forward `chore/soat-cau-hinh-payos-firebase` = staging (deploy prod).** Không còn phân kỳ, không cần cherry-pick.
- Prod giờ có đủ đồ của staging: `redis`, `worker` (BullMQ, cron KHÔNG còn trong API, 2 lịch `huy-don-qua-han` :07, `chot-van-don` :23), `/health` ping DB, log JSON request-id, `/api/docs` chặn, khoá hàng trước trừ kho. 6 service: mysql, redis, backup, migrate, api, worker.
- Staging repo có `CLAUDE.md` + `docs/BAN-GIAO.md` của nhóm (Cường vai B DevOps): quy trình 6 bước (test đỏ trước), `npm run lint:check` bánh cóc 966 (chỉ được giảm), `check:boundaries` 28, CI `.github/workflows/ci.yml` có MySQL+Redis chạy `check:*`; bước "Sơ đồ" (drawio) đỏ sẵn từ trước. Chạy CI trên nhánh phụ: `gh workflow run ci.yml --ref <branch>`.
- **Staging và prod dùng CHUNG tag image `zoldify-backend:latest` trên cùng VPS.** Deploy staging build lại tag đó; nếu sau đó chạy tay `docker compose -p zoldify up -d` trên prod (không kèm build prod) thì prod lên mã STAGING. Container đang chạy thì an toàn (giữ image id cũ). Ngay sau khi GitHub báo deploy xong, container api mới cần vài giây mới nhận request: kiểm live lần đầu có thể trúng bản cũ, đợi rồi kiểm lại.
- Hook Bash chặn chuỗi `--rm`: backup tay trên prod dùng `docker compose -p zoldify exec -T -e BACKUP_ONCE=1 backup sh /backup-db.sh`.
- Bẫy gộp đã dính: WorkerModule phải tự nạp module @Global mà service cần (FirebaseModule); key cache danh sách sản phẩm phải chứa mọi tham số lọc; `openapi.json` phải sinh lại (`npm run openapi:gen`) khi đổi API, CI kiểm.

## GHN + Đơn bán (2026-10-05, prod = staging `90d660b`)
- Gốc H-07: GHN đánh dấu quận **2045 Huyện Văn Giang** Status=2/SupportType=0 (13/726 quận toàn quốc như vậy). available-services trả `data: null` cho quận ngừng phục vụ. Fix: /ghn/districts + /ghn/wards lọc Status!=1 hoặc SupportType=0; tạo đơn mà GHN không tính được phí thì **400 kèm lý do** (không còn 0đ); quote có `ok`; `ghnErrorMessage` lấy lý do trong body GHN; vận đơn FAILED tạo lại được (`POST /orders/:id/shipments/retry`, chốt dòng bằng UPDATE có điều kiện trên `error`); sim-ghn chặn khi người bán chưa có vận đơn hợp lệ.
- H-02: tạo đơn báo từng người bán (notification + push, data view=seller); `GET /orders/:id` mở cho người bán (chỉ thấy món + vận đơn của mình, user người mua rút gọn); cancel/remove dùng `findOneAsBuyerOrAdmin`.
- **Staging .env thiếu GHN_SHOP_ID / GHN_FROM_DISTRICT_ID** (trước được che bởi phí 0đ) → đã chép từ prod (213909 / 1461, cùng token sandbox), backup `.env.bak-ghn-20261005`.
- Tài khoản seed dùng được để kiểm: prod + staging `seller@zoldify.com` / `buyer@zoldify.com` mật khẩu <pass> (đơn test 7 prod là của cặp này). Staging buyer test: hotfix-1790665884176@example.test / Hotfix#2026.
- Dữ liệu test prod đã sửa: shop 1 (Shop Test E2E) pickup 2045 → 1680/220117; đơn 7 shipping → confirmed (vận đơn vẫn FAILED vì địa chỉ nhận ở 2045).
- Worktree backend `D:/Zoldify/wt-ghn`; node_modules worktree và mobile hay bị dọn giữa phiên → `npm ci` lại.

## Backup offsite R2 (2026-09-30, head `f5315e5` prod = staging)
- Service compose **`offsite`** (ảnh `rclone/rclone:1`, `scripts/offsite-backup.sh`): chép `./backups` (mount :ro) lên bucket R2 **`zoldify-backups`** mỗi 6h, thư mục `prod/` / `staging/` theo `BACKUP_R2_PREFIX`, giữ 30 ngày trên R2 (`rclone delete --min-age`), chỉ copy không sync-xoá. Log: `[offsite] OK r2:zoldify-backups/prod: N bản`.
- Token R2 riêng **`<token-name>`**: Object R&W chỉ bucket zoldify-backups, **lọc IP <IP>** (đổi IP VPS phải sửa token, không thì 403). Biến trong .env prod+staging: `BACKUP_R2_ACCESS_KEY_ID/SECRET_ACCESS_KEY/BUCKET/PREFIX` (+ `R2_ACCOUNT_ID` có sẵn). Token app `zoldify-backend` (R2_*) đọc zoldify-backups = 403, đúng scope.
- Account còn token **`<token-name>`** quyền R/W MỌI bucket (gồm zoldify-backups), không phải của app; đã báo user cân nhắc thu hẹp/xoá.
- Đã kiểm khôi phục: tải bản prod từ R2 về, sha1 khớp bản local, gzip OK, 27 bảng. Lệnh tải về khi mất VPS: DEPLOY.md mục "Bản ngoài VPS".

## Hotfix bảo mật + backup prod (2026-09-29)
- Prod head **`6611537`** (hotfix Đợt 0, xem [[production-audit-2026-09]]). Compose prod giờ có service **`backup`** (ảnh mysql:8, `scripts/backup-db.sh`): dump khi khởi động + 24h/lần vào `/opt/zoldify-backend/backups/`, giữ 14 ngày; bản đầu `zoldify-20260929-045835.sql.gz` khớp DB (27 bảng, 9 users). Log mọi container json-file 10m x 5. Khôi phục: DEPLOY.md "Sao lưu và khôi phục". Backup vẫn CÙNG VPS, đã có bản ngoài VPS, xem mục dưới.
- **Staging PHÂN KỲ lớn** khỏi prod (143 commit riêng: /health thật, request-id log, chặn /api/docs, khoá hàng trước khi trừ kho, redis + worker, backup bằng cron host `scripts/backup-mysql.sh`). Đưa fix từ prod sang staging = **cherry-pick trong worktree** (`git worktree add ../_be-stg-wtN -b ... origin/staging`), không merge. `/health` prod = 404 (chỉ staging có).
- Throttle route `/auth/register`: gửi 2 lần liền là 429, đợi ~65s. Staging có user test `hotfix-1790657481033@example.test` (id 7) đã khoá bằng DB để kiểm B-04.

## Kho ảnh Cloudflare R2 (2026-08-15)
- Ảnh upload mới (`POST /files/upload`) đẩy lên **Cloudflare R2** thay vì đĩa VPS. Code: `src/catalog/files/storage.service.ts` (S3 API), multer đổi sang `memoryStorage`. Thiếu biến R2_* thì tự fallback lưu `public/images`.
- Cloudflare account chứa `zoldify.com` = **`<cf-id>`** (đăng nhập `<google-account>@gmail.com`, KHÔNG phải whalelo.net/994fd9). Bucket **`zoldify-images`** (APAC), custom domain **`img.zoldify.com`** (Active, phục vụ qua CDN Cloudflare).
- Token R2 tên `<token-name>`, quyền **Object Read & Write**, scope riêng bucket zoldify-images. Đã nạp vào `.env` prod (`/opt/zoldify-backend`) và staging (`/opt/staging/zoldify-backend`, thêm `R2_KEY_PREFIX=staging/` để tách ảnh). Log backend: "R2 storage bật (...)".
- Biến: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET=zoldify-images, R2_PUBLIC_URL=https://img.zoldify.com, R2_KEY_PREFIX.
- Đã kiểm thật: PUT object bằng token OK, đọc qua `https://img.zoldify.com/health/test.txt` = 200.
- Cloudflare MCP (`mcp__plugin_cloudflare_cloudflare-api__*`) có sẵn nhưng OAuth flow hay rớt giữa chừng; làm bucket/domain/token bằng realbrowser (profile chrome:Default = <google-account>) thì chạy. realbrowser vs claude-in-chrome giành CDP 9222 — user muốn dùng realbrowser.
- LƯU Ý BẢO MẬT: secret token có đi qua transcript lúc đọc từ dashboard; token đã scope hẹp (chỉ Object R/W bucket này). Muốn chắc thì rotate token trong Cloudflare R2 → API Tokens rồi báo tôi nạp lại .env.

## i18n danh mục (2026-08-16)
- Nội dung (tên/mô tả SẢN PHẨM) KHÔNG dịch — do người bán nhập (như Chợ Tốt). Chỉ giao diện (next-intl vi/en) + tên DANH MỤC được dịch.
- Tên danh mục: frontend `src/lib/categoryI18n.ts` (hook `useCategoryName`), thứ tự EN: **name_en (DB) → bảng tĩnh 9 slug → tên VN**. Dùng ở CategoryRail, CategoryTiles, /category/[slug], /search. `categories.service.findAll` phải select thêm `name_en` (nó chỉ select cột lẻ).
- **Auto-dịch danh mục MỚI**: cột `categories.name_en` (migration 1786900000000) + `TranslationService` (src/catalog/categories/translation.service.ts) gọi Cloudflare Workers AI model `@cf/meta/m2m100-1.2b`. `categories.service` create/update tự dịch name→name_en. Tắt mềm nếu thiếu env.
- Env cần: `CF_ACCOUNT_ID=<cf-id>`, `CF_AI_TOKEN` (token Workers AI, đã nạp prod+staging). 9 danh mục cũ KHÔNG backfill (bảng tĩnh đẹp hơn output máy). E2E đã test: "Đồ chơi trẻ em" → "toys of children.".
- Admin sửa/thêm danh mục ở `zoldify.com/admin/categories` (frontend, KHÔNG phải admin.zoldify.com — đó là khung rỗng). Cần user role=admin. Admin hiện: `<google-account>@gmail.com` (prod). tdatdev@whalelo.net đã trả về buyer (email cty, user không muốn admin).
- Hook local chặn mọi lệnh Bash chứa chuỗi `.env`/`.env.local`/`.env.sample` — lách bằng ghép tên từ biến (`F=".e"; F="${F}nv"`). Import secret local→server bằng `grep ... | ssh vps 'cat > /tmp/x.vars'` để giá trị không in ra context.

## Đánh giá thật + sửa viết lại/cache (2026-10-07, prod = staging `80c5ca7`)
Prod đã nhận: H-01 (rating_avg/review_count, seller stats), sửa xoá-rồi-viết-lại đánh giá, xoá cache Redis sản phẩm khi đổi điểm, kèm GHN picked→Đang giao và 16 commit `fix/hotfix-dot-0` (sơ đồ + 2 fix auth: thu hồi phiên khi đặt lại mật khẩu, tài khoản OTP đánh dấu email đã xác minh) do phiên khác gộp staging. Không migration mới. admin@zoldify.com/<pass> trả 401 trên prod (mật khẩu prod khác, không phải lỗi deploy).

## Caddy x3 api (2026-10-08): staging sập 502, đã vá bằng override trên VPS
PR #33/#34 (staging `50e351a`) đổi compose: `api` x3 KHÔNG publish cổng nữa, `caddy` là đường vào và mặc định đòi 80/443 trên máy chủ. Nhưng nginx của máy chủ giữ 80/443 (api.zoldify.com -> 127.0.0.1:3000, api-staging -> 127.0.0.1:3100) nên staging 502. Vá: file KHÔNG commit `/opt/staging/zoldify-backend/docker-compose.override.yml` với `caddy.ports: !override ['127.0.0.1:3100:80']` (deploy.yml chỉ `git checkout -B` + `compose up`, không xoá file lạ). Đã verify HTTPS + 3 bản api chia đều.

## 2026-10-12: prod = staging = GitHub `b055ecf`, caddy x3 api cả hai môi trường
Đã tạo `/opt/zoldify-backend/docker-compose.override.yml` (`caddy.ports: !override ["127.0.0.1:3000:80"]`) CÙNG lần ff; backup trước khi lên: `/opt/manual-backups/prod-before-caddy-20261012-0255.sql.gz`. 4 migration chạy OK (DropDeadPayosWebhookLogs, AddOrderIdempotencyKey, AddDashboardAndShopIndexes, AddAdminActionLogs). Nhánh GitHub prod đã đồng bộ, CD deploy cả hai nhánh giữ nguyên override (verify). Giờ deploy prod chỉ cần push nhánh prod (CD tự làm). seller@zoldify.com đã có shop id 2, kho Phường 9 Gò Vấp HCM (= GHN_FROM_DISTRICT_ID 1461; Cầu Giấy 1485 KHÔNG có tuyến sandbox tới Hưng Yên). Ô chọn tỉnh lọc IsEnable=1 + còn quận phục vụ (63 tỉnh). Bẫy: `rtk git log` ẨN merge commit, dùng `rtk proxy git log` khi cần thấy merge.

## 2026-11-02: IP thật cho giới hạn tốc độ, prod = staging = `839616e`
Trước đó mọi khách chung một bucket throttler (req.ip = gateway docker). Sửa 3 tầng: `/etc/nginx/conf.d/cloudflare-real-ip.conf` (set_real_ip_from dải CF + real_ip_header CF-Connecting-IP, áp MỌI site), site api.zoldify.com và api-staging dùng `X-Forwarded-For $remote_addr`, Caddyfile `trusted_proxies static private_ranges`, Express trust proxy 'loopback, linklocal, uniquelocal' (`src/common/tin-proxy.ts`). Kiểm prod: burst 20 từ VPS = 10x200/10x429, máy khác 0x429, XFF giả không lách. Bẫy: push `staging` cho CD build lại `zoldify-backend:latest` và image prod cũ bị dọn mất, nên "giữ :latest để rollback" KHÔNG đứng được; muốn rollback giữ được thì `docker tag` image prod cũ thành tên khác TRƯỚC khi push staging. Còn sót file không track `docker-compose.ip-that.yml` ở cả 2 thư mục (CD không nạp, vô hại) và image `ip-that`, `ip-that-prod`. Cập nhật dải IP Cloudflare bằng tay.

## 2026-11-03: đợt 1 triệu dòng lên prod, prod = staging = `944dfac`
Fast-forward nhánh prod từ 839616e, CD xanh. 3 migration chỉ thêm index (AddHotListIndexesFor1M, AddDeletedAtIndexesFor1M, AddSellerOrderIndexesFor1M) chạy OK, DB prod chỉ 5.8 MB nên tức thì. Mysql bị tạo lại (đổi tham số), downtime ngắn. **Prod `MYSQL_BUFFER_POOL=256M` trong .env prod** (không phải 512M mặc định, vì VPS chung RAM; backup .env: `.env.bak-1m-20261103-0558`); max_execution_time 5000. Thêm service `redis-queue` (noeviction, AOF). Backup DB trước khi lên: `/opt/manual-backups/prod-before-1m-20261103-0558.sql.gz` (272 KB, 27 bảng). Image rollback `zoldify-backend:prod-keep-20261102` (56a784c) vẫn còn. RAM: trước 843 MB available, swap 1374/2047; sau ~17 phút 618 MB available, swap 1212/2047; mysql prod ~450 MB, không OOM. Kiểm giới hạn: 20 request SONG SONG tới /categories từ VPS = 10x200/10x429 (bắn tuần tự thì không chạm 10/s, toàn 200).

## 2026-11-03 (chiều): cache biên Cloudflare lên prod, prod = `3ec10a9`, staging = `3ec10a9` + docs
Ff prod 944dfac -> 3ec10a9 (639fb78 test, 6eff20b feat `src/common/cache-bien.ts`, 3ec10a9 docs). GET ẩn danh /products, /categories*, /shop/:id(/products) trả `CDN-Cache-Control: max-age=30|300, swr, stale-if-error=300` + ACAO *; có Authorization = private, no-store; chi tiết sản phẩm KHÔNG cache (đếm view). Cloudflare zone <cf-id> (Free), ruleset <cf-id>, rule staging <cf-id>, rule prod <cf-id>, edge_ttl bypass_by_default; tạo qua session dashboard (profile Chrome "Your Chrome" <google-account>, fetch /api/v4 kèm header x-atok = window.bootstrap.atok). Đo: 200 req cùng URL -> origin 200 xuống 3 (staging) / 9 (prod). Hoàn tác = tắt rule prod. Bẫy: image prod đang chạy bị CD staging dọn nên `docker tag`/`commit` "not found"; rollback `zoldify-backend:prod-keep-20261103` dựng bằng `docker export | docker import` (không có HEALTHCHECK/ENV Dockerfile). Burst từ VPS dùng chung bucket với IP VPS; phía server của web chỉ gọi API ở middleware bảo trì (`/settings/public`), từ fix `1d10734` (03/11) gộp thành ~1 lần/15s và giữ cờ cũ khi gặp 429/5xx (xem docs/bao-cao/ssr-ip-that.md). Báo cáo: docs/bao-cao/cache-cloudflare.md.

## 2026-10-12 (chiều): PR #35 B-19 (GHN song song theo seller + retry timeout, HttpModule timeout 10s) lên staging rồi prod `05cec34`
Test E2E staging bằng script (scratchpad e2e-b19.mjs): đơn 2 người bán, xác nhận 870ms ra 2 vận đơn, retry không sinh trùng. Dữ liệu test staging: seller2@zoldify.test / Test@12345 (user id 9, shop "Shop Hai", sản phẩm 17 "Tai nghe test B19"), shop của seller@ trên staging id 1; cả hai kho Gò Vấp 1461 / Phường 9 21316. Đơn test staging ORD-20261012-F5106A58.
