---
name: mobile-e2e-emulator
description: "Cách test E2E Zoldify_Mobile trên emulator Pixel_10a bằng adb (không Maestro/Detox), các bẫy môi trường máy này, và kết quả đợt test 2026-09-30"
metadata:
  node_type: memory
  type: project
  originSessionId: <session>
  modified: 2026-09-30T08:32:12.603Z
---

Đợt test E2E 2026-09-30: báo cáo `Zoldify_Mobile/docs/qa/2026-09-30-e2e-android.md` (51 ca, 37 đạt, 12 lỗi) + ảnh, commit dface24 nhánh `docs/qa-e2e-2026-09-30`. Lỗi mã H-01..H-09, M-01..M-05, L-01..L-06 dẫn chiếu từ đó.

**Môi trường:** SDK `D:\AndroidSdk`, AVD home `D:\AndroidAvd` (KHÔNG phải ~/.android), AVD `Pixel_10a`. Đã đổi `hw.keyboard = no` trong config.ini (bản gốc `.bak-e2e`) vì bật bàn phím phần cứng thì Gboard chỉ hiện thanh nhỏ, không kiểm được bàn phím che ô. Công cụ điều khiển: script `ui.mjs` (uiautomator dump + input tap/text/screencap) trong scratchpad phiên; adb `input text` chỉ gõ ASCII, nên test tìm kiếm không dấu.

**Bẫy máy này:**
- `node_modules` của backend VÀ mobile từng bị mất file (package.json, .bin) và cache Gradle `transforms` bị "modified" → có thứ gì đó dọn cache ngoài ý muốn. Chữa: `npm ci`; Gradle: `cmd /c rd /s /q "\\?\C:\Users\tvmar\.gradle\caches\9.3.1\transforms"` (đường dẫn >260 ký tự, Remove-Item fail).
- `Start-Process` (PowerShell tool) cho emulator/gradle bị chết khi phiên công cụ kết thúc → chạy bằng Bash `run_in_background` (được theo dõi).
- Build x86_64 cho emulator: `gradlew.bat -p android assembleRelease -PreactNativeArchitectures=x86_64` ~18 phút, APK 48MB. Trong lúc build, uiautomator rất chậm, đừng test song song.
- Git Bash đổi `/sdcard` thành `D:/Git/sdcard` → `export MSYS_NO_PATHCONV=1` trước `adb push`.
- curl từ Git Bash gửi tiếng Việt SAI mã hoá (đã làm hỏng địa chỉ prod 1 lần, đã khôi phục) → gửi dữ liệu có dấu bằng Node fetch.
- Email tạm để nhận OTP: API mail.tm (tạo account + đọc /messages).

**Why:** tránh lặp lại 1-2 giờ vấp môi trường; biết lỗi nào đã ghi nhận để không báo lại.
**How to apply:** test lại app thì dùng đúng AVD/config trên, build x86_64, cài `adb install -r`; muốn sửa lỗi thì bắt đầu từ danh sách H-xx trong báo cáo. Liên quan [[mobile-build-local-apk]], [[production-audit-2026-09]], [[deploy-vps-backend]].

## Đợt sửa 05/10 (H-02/H-06/H-07/H-08) đã test máy ảo
- Đạt trên máy ảo: H-06 (Đã lưu theo tài khoản), H-07 (Văn Giang biến khỏi picker, checkout "Chưa tính được" + khoá nút, địa chỉ hợp lệ ra phí 60.500đ), H-08 (đơn hiện lý do vận đơn lỗi), H-02 người bán (thông báo đơn mới, Đơn bán, xác nhận, GHN timeout → Tạo lại vận đơn → giả lập lấy hàng → Đang giao). Đơn test prod ORD-20261005-389 (buyer@/seller@zoldify.com, <pass>) đang "Đang giao", vận đơn L8AR88.
- Lỗi thấy khi test và đã sửa (commit mobile 5433967, 198abe7, 1044c0e, CHƯA test lại trên máy): đơn huỷ vẫn hứa "sẽ được giao"; câu lỗi lồng ngoặc; bấm thông báo đơn mới TRONG APP mở màn đơn mua (điều hướng chép 2 nơi → gom về features/notifications/route.ts).
- Thêm địa chỉ mới ở checkout tự chọn địa chỉ vừa thêm: đã sửa d32ad7a (chưa test máy).
- 06/10 ĐÃ ĐẨY GitHub: mobile `fix/e2e-ghn-orders-wishlist` (9 commit H-09..H-02, nối sau refactor/feature-first-structure) + `docs/qa-e2e-2026-09-30`; backend `docs/audit-production-readiness`. Chưa gộp vào refactor/feature-first-structure, chưa mở PR.
- Người dùng từng đóng máy ảo / chặn lệnh cài APK: hỏi trước khi mở máy ảo hay cài APK.

## H-01 (06/10) + bẫy máy ảo treo
- H-01 xong: BE products.rating_avg/review_count (migration 1787700000000) + GET /interactions/seller/:id/stats (sold đếm từ đơn delivered vì products.sold_count KHÔNG được ghi ở đâu) + ?mine=1; mọi route đọc đánh giá chỉ trả user {id, full_name, avatar} (từng lộ email/sđt). Seed: scripts/seed-reviews.sql (prod 80 đánh giá). Mobile bỏ mock.ts/store.ts, dùng features/reviews/api.ts. Prod f51f116.
- 07/10 ĐÃ test máy hết: chi tiết SP, danh sách đánh giá, trang shop, viết đánh giá đơn 389 (đã "Đã nhận"), 4 bản sửa mobile 05/10. Lỗi tìm thêm và đã sửa: số điểm lớn bị cắt (mobile d672494), xoá đánh giá rồi viết lại 500 do UNIQUE idx_user_product giữ dòng xoá mềm (BE be7d222), màn SP hiện điểm cũ 60s do Redis product:<id> không bị xoá (BE 80c5ca7), đăng xuất không xoá cache query (mobile 17163d2). Prod BE 80c5ca7.
- Dữ liệu: seller@zoldify.com (id 1) KHÔNG có bản ghi shops nên checkout luôn hiện "Một số người bán chưa cài địa chỉ lấy hàng" (đúng, không phải lỗi). Picker tỉnh có tỉnh rác của GHN sandbox ("Hà Nội 02", "Test - Alert - Tỉnh - 001"). Đánh giá seed của buyer@ (Nguyen Van Mua) chặn viết đánh giá mới cho cùng SP.
- BẪY: máy ảo có thể treo cứng (adb shell không trả lời, qemu ~7.8GB RAM) và taskkill /F không giết được (driver ảo hoá giữ) → giữ khoá AVD, không mở lại được kể cả -read-only. Cần khởi động lại Windows. Lần sau mở máy ảo nên dùng -read-only ngay từ đầu để còn mở phiên thứ hai khi kẹt (07/10: `emulator -avd Pixel_10a -read-only -no-snapshot-load -no-boot-anim` qua Bash run_in_background, boot ~50s). Build APK tăng dần chỉ 1-3 phút khi .cxx còn nguyên.
- DB test MySQL trong WSL: cổng 127.0.0.1:3307 có lúc KHÔNG forward sang Windows → chạy jest với TEST_DB_HOST=<IP WSL> (`wsl hostname -I`, VD <IP>).
- origin/staging bị phiên khác đẩy commit liên tục: TRƯỚC khi ff prod luôn `git log HEAD..origin/staging` trên VPS để biết prod nhận những gì (07/10 lỡ đưa 16 commit fix/hotfix-dot-0 lên prod, đã báo user).