---
name: production-audit-2026-09
description: "Audit A (validation+concurrency) và B (production readiness 13 hạng mục) ngày 2026-09-28, nằm ở Zoldify_Backend/docs/audit/ trên nhánh docs/audit-production-readiness; 5 lỗ hổng prod chờ hotfix"
metadata:
  node_type: memory
  type: project
  originSessionId: <session>
  modified: 2026-09-29T07:18:04.462Z
---

Ngày 2026-09-28 đã audit toàn dự án (chỉ đọc, chưa sửa code). Báo cáo ở `Zoldify_Backend/docs/audit/A-validation-concurrency.md` (29 lỗi, mã A-xx) và `B-production-readiness.md` (mã B-xx, tổng ~3.6/10), commit d768c24 + 9635246 trên nhánh local `docs/audit-production-readiness` (chưa push, tách từ nhánh prod `chore/soat-cau-hinh-payos-firebase`).

5 lỗ hổng Đợt 0 (ĐÃ SỬA + ĐÃ DEPLOY 2026-09-29: prod = fast-forward `chore/soat-cau-hinh-payos-firebase` lên `6611537`; staging = cherry-pick 6 commit bảo mật lên `staging` @ `735ec8b`, BỎ commit backup vì staging đã có backup cron riêng `scripts/backup-mysql.sh`. Kiểm live: staging 15/15 kể cả khoá TK, prod 11/11 bằng tài khoản demo buyer@zoldify.com, không tạo dữ liệu): B-01 `POST /auth/register` nhận `role: admin`; A-01 `PATCH /payments/:id` cho buyer tự set success -> is_paid; B-02 `POST /notifications` ai cũng gửi push; B-03 `/escrows` lộ PII; B-04 `is_locked` không được kiểm tra.

Sau đó (cùng ngày) đã HỢP NHẤT prod = staging @ `20b336b` (xem [[deploy-vps-backend]]), nên audit B các mục staging đã làm giờ cũng có trên prod: A-02 oversell (khoá hàng), A-18 phân trang có trần, B-13 chặn /api/docs, /health thật, request-id log, worker tách cron. Kèm sửa thêm: DELETE /notifications/push-token theo chủ sở hữu.

Hotfix còn kèm: service `backup` (mysql:8 + scripts/backup-db.sh, dump 24h vào ./backups, giữ 14 ngày, chưa chép ra ngoài VPS) + log Docker 10m x 5; chưa smoke test backup trên VPS (máy dev không có Docker). Test `order-status.policy.spec.ts` đỏ từ trước (commit b18f742 đổi luật shipping, test chưa cập nhật). `node_modules` backend từng hỏng, đã `npm ci` lại. Hook Bash chặn mọi lệnh chứa `rm -f` (kể cả trong heredoc) và formatter reflow file khi Edit: dùng script Node áp edit.

**Why:** người dùng gọi 2 phạm trù "validate + giao dịch song song" là Data Integrity trong nhóm Production Hardening; muốn biết còn thiếu gì để lên production.
**How to apply:** khi user bảo "sửa theo audit" thì làm theo lộ trình Đợt 0 -> 3 trong báo cáo B, dẫn mã A-xx/B-xx; mỗi fix race condition kèm test song song. Hook commit của máy này tự đổi prefix Conventional Commit theo từ khoá (từng biến "docs" thành "fix:" vì chữ "hotfix"), nên kiểm tra lại `git log` sau khi commit. Liên quan [[ghn-multiseller-and-local-db]], [[deploy-vps-backend]].
