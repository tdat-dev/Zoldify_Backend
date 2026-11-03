---
name: audit-2026-10-25-fix-branches
description: "Rà soát toàn app 25/10/2026 (~60 lỗi) và các nhánh sửa đang chạy: wt-race, wt-sec, wt-mobile, FE/Admin branch; DB test zoldify_race đã migrate"
metadata:
  node_type: memory
  type: project
  originSessionId: <session>
  modified: 2026-10-25T17:43:33.508Z
---

Rà soát 25/10/2026 (5 agent: đặt hàng, tiền, bảo mật, module khác, client). Ghi chú gộp ở scratchpad phiên 20eb20f6 `audit/findings-1-2.md`. Đặt hàng/tồn kho cơ bản đã đúng (A-02/A-03 fixed, check:race R1-R5 xanh); lỗi nằm ở đua trạng thái đơn, ký quỹ, webhook PayOS, Firebase login, client (ví không trừ tiền, phí ship 0đ khi thiếu mã GHN, admin Users gọi sai API).

Nhánh sửa (chỉ commit local, chưa push/deploy):
- Backend `fix/dua-trang-thai-don-ky-quy` ở worktree `D:\Zoldify\wt-race` (23 commit, A-H xong, 359 test xanh).
- Backend `fix/va-bao-mat-dot-2` ở `D:\Zoldify\wt-sec`.
- Frontend `fix/client-thanh-toan-va-loi-dua` (checkout trong repo chính), Admin `fix/admin-users-va-don-hang`, Mobile worktree `D:\Zoldify\wt-mobile` nhánh `fix/client-thanh-toan-va-loi-dua` từ origin/main (repo Mobile chính có file APK staged của người khác, đừng đụng).
- Thẻ 4 "Validation, giới hạn và vận hành (BE)" chưa làm, chờ gộp 2 nhánh BE.

Môi trường test: MySQL test trong WSL docker `zoldify-test-mysql` cổng 3307 root/<pass>; DB `zoldify_test` (spec), `zoldify_test_sec`, `zoldify_race` (đã migration:run, dùng cho `check:race` với env DB_HOST=127.0.0.1 DB_PORT=3307 DB_USERNAME=root DB_PASSWORD=<pass> DB_DATABASE=zoldify_race). WSL tự tắt khi rảnh: giữ bằng `wsl -d Ubuntu -- sh -c "docker start zoldify-test-mysql; exec sleep infinity"` chạy nền. Worktree cần node_modules thật (junction bị chặn "untrusted mount point"): dùng robocopy /E /MT:32. Agent kiểu `claudekit-engineer:fullstack-developer` hỏng (tools rỗng), dùng `builder`.

GHN sandbox không có shipper: giả lập bằng nút "Giả lập GHN" ở Admin Orders (shipping/delivered) hoặc app người bán (shipping). Nhánh bảo mật đổi: "delivered" chỉ admin, chỉ khi đơn đang SHIPPING, công tắc env GHN_SIMULATOR.

Liên quan [[production-audit-2026-09]], [[deploy-vps-backend]], [[docker-in-wsl-test-db]].

## 26/10 gộp + nghiệm thu
- Nhánh tích hợp `fix/dot-sua-25-10` ở worktree `D:\Zoldify\wt-merge` = staging + 2 nhánh BE + 5 bản vá lúc nghiệm thu (R7 hạ cờ webhookKhongCoKhoa; Redis của BoDemNhip/ProductsService/TasksService unref để jest không treo khi có REDIS_URL; spec nhật ký admin chờ đủ dòng; .gitattributes ghim LF cho openapi.json). `npm run nghiem-thu` 18 PASS, check:core BỎ QUA (cần zoldify_bulk_test), commit a6a1217. CHƯA push/deploy.
- Chạy nghiệm thu: env DB_HOST=<IP> DB_PORT=3307 DB_USERNAME=root DB_PASSWORD=<pass> DB_DATABASE=zoldify_race TEST_DB_HOST=<IP> TEST_DB_PORT=3307 REDIS_URL=redis://<IP>:6379 TEST_REDIS_URL=redis://<IP>:6379 (thiếu TEST_REDIS_URL thì check:redis nối 127.0.0.1 và đỏ sau khi WSL khởi động lại).
- APK 26/10: D:/Zoldify/apk/Zoldify-2026-10-26-prod.apk (build từ wt-mobile).
- Prod SITE_URL đã thêm https://admin.zoldify.com (trước thiếu nên admin.zoldify.com bị CORS chặn); admin prod duy nhất là <google-account>@gmail.com (không có admin@zoldify.com).
- 26/10 ĐÃ LÊN STAGING: backend fix/dot-sua-25-10 (=origin/staging, thêm 2f15b6c sửa đua thêm-vào-giỏ do CI bắt), web fix/client-thanh-toan-va-loi-dua và admin fix/admin-users-va-don-hang fast-forward vào staging; CI + Deploy xanh. Mobile chỉ push nhánh. CHƯA lên production.

## 26/10 tối: thẻ 4 (validation + vận hành)
- Backend `fix/validation-van-hanh` ở worktree `D:\Zoldify\wt-ops` (từ origin/staging): 10 mục + 9 lỗi review + vá jest treo (unref phải giữ biến client cục bộ, không đọc lại `this.redis` vì spec thay bằng bản giả). 2 migration mới: AddOrderClientIdempotencyKey, AddProductHiddenByLockAt. CHƯA push.
- Web nhánh `fix/sua-san-pham-kho-ky-vong` (cd72a9b expected_stock ở trang sửa SP, 34753f6 Idempotency-Key checkout): cd72a9b PHẢI lên sau backend thẻ 4 (backend cũ whitelist sẽ 400 expected_stock). Mobile wt-mobile 8124a91 Idempotency-Key (expo-crypto).
- Agent con chạy jest không có REDIS_URL nên không bắt được treo; luôn tự chạy nghiem-thu có REDIS_URL. WSL tự tắt nhiều lần trong ngày: kiểm cổng 3307 trước mỗi lượt nghiệm thu.
- Chưa test app Android trên máy ảo (APK 26/10 trỏ production, backend fix mới ở staging); đề xuất build APK trỏ api-staging rồi E2E adb, chờ user đồng ý.
- 27/10 ĐÃ LÊN STAGING: backend fix/validation-van-hanh (0367d5d, nghiem-thu 18 PASS, CI+Deploy xanh, smoke 12/12), web fix/sua-san-pham-kho-ky-vong (34753f6). Mobile chỉ push nhánh (8124a91). APK prod 27/10: D:/Zoldify/apk/Zoldify-2026-10-27-prod.apk, đã E2E máy ảo 9/9 đạt trên prod (ví trừ/hoàn đúng, chặn vượt kho, khoá đặt khi GHN không giao). Prod còn lỗi sold_count không trừ khi huỷ (đã sửa ở thẻ 4). CHƯA lên production.
- Script E2E adb: scratchpad phiên 20eb20f6 ui.mjs; deep link app là zoldify://products/<id>.
- 27/10 ĐÃ LÊN PRODUCTION (user duyệt): backend chore/soat-cau-hinh-payos-firebase = staging 0367d5d (192 commit, 2 migration OK, 3 api healthy, smoke prod 12/12), web deploy-prod = 34753f6, admin chore/deploy-docker = 440fafb. Backup trước deploy: /opt/manual-backups/prod-before-dot-sua-2610-20261027-0416.sql.gz. Sửa tay products.sold_count id 13 về 0 (do đơn test huỷ trên code cũ). Prod = staging cả 3 repo. Mobile chỉ có nhánh + APK.
- 27/10 chiều: thẻ 5 BE `fix/thong-bao-va-van-don` (wt-ops, ~56 commit, review 2 vòng, migration AddOrderConfirmedAt có backfill) + thẻ 6 client: web `fix/mua-ngay-dat-so-luong` (b2f75e2), mobile wt-mobile 07556a2..8e769db (số dư ví, hoàn tiền, giỏ tự giảm, push token trước logout, mua ngay), admin `fix/bo-vai-kiem-duyet` (d397ca6, PHẢI lên cùng BE thẻ 5 vì BE bỏ moderator). Chưa push.
- Máy này có thứ tự xoá file: 27/10 mất node_modules wt-mobile, android/app/.cxx (build lại 45'), và cả D:\AndroidAvd (đã dựng lại config tay, nhưng emulator tự thoát khi boot, chưa gỡ được). Claude Code có thể giết tiến trình nền khi RAM thấp: hỏi user trước khi bật lại.
- 27/10 tối ĐÃ LÊN PRODUCTION (user duyệt "deploy đi"): BE a5a2d90 (thẻ 5, migration AddOrderConfirmedAt OK), web deploy-prod = staging (mua ngay b2f75e2), admin chore/deploy-docker = staging (d397ca6). Smoke prod thẻ 5 11/11, thẻ 4 11/11. Backup: /opt/manual-backups/prod-before-the5-20261027-1131.sql.gz. Script smoke: scratchpad smoke-c5.mjs <staging|prod>, smoke-prod.mjs. Mobile: nhánh đã push, APK D:/Zoldify/apk/Zoldify-2026-10-27b-prod.apk chưa test máy ảo.
