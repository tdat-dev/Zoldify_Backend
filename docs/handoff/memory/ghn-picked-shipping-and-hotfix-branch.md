---
name: ghn-picked-shipping-and-hotfix-branch
description: "GHN picked→Đang giao đã lên staging 2026-10-07; nhánh fix/hotfix-dot-0 (sơ đồ UML + 4 bug) lệch staging 190 commit, xung đột 2 file; CI \"Sơ đồ\" trên staging đỏ do Sequence-Diagrams.drawio cũ"
metadata:
  node_type: memory
  type: project
  originSessionId: <session>
  modified: 2026-10-07T04:13:21.304Z
---

Tình trạng 2026-10-07:
- **GHN tài xế lấy hàng → đơn "Đang giao"**: `ShipmentTrackingService` (webhook + quét mỗi giờ) dùng UPDATE có điều kiện (chỉ từ confirmed/processing) khi GHN báo picked/storing/transporting/sorting/delivering/money_collect_delivering/delivery_fail/delivered. Đã push nhánh `fix/ghn-picked-to-shipping` và fast-forward `staging` (deploy staging OK). **Prod ĐÃ fast-forward lên 0d3fc19 (2026-10-07), /health 200.** Sandbox GHN không có tài xế nên vẫn dùng nút giả lập `sim-ghn` trong admin.
- **CI job "Sơ đồ" trên staging đỏ từ trước (594 lỗi)**, do `Sequence-Diagrams.drawio` bản cũ (cạnh trỏ id không tồn tại, `shape=line`). Không phải do code. Bản vẽ lại sạch nằm ở nhánh `fix/hotfix-dot-0`.
- **Sơ đồ UML + 2 bản sửa auth ĐÃ GỘP staging (0d3fc19, 2026-10-07)**, CI staging xanh lại, deploy staging OK. Rebase qua nhánh `fix/hotfix-dot-0-rebase` (worktree `_be-hotfix-rebase`). Bỏ 2 commit trùng vì staging đã tự sửa: chống bán quá số lượng (orders.service) và policy spec SHIPPING. Nhánh cũ `fix/hotfix-dot-0` trên origin giờ lỗi thời. Prod cũng đã lên 0d3fc19.
- **Admin prod (`chore/deploy-docker`) đã fast-forward lên admin staging `4db1ba9`** (2026-10-07): có nút "Giả lập GHN (sandbox)" trong chi tiết đơn, kèm 12 commit giao diện của nhóm đã nằm trên admin staging.
- Bánh cóc lint staging giờ là **943** (đã hạ từ 966).

**Why:** Nhánh làm sơ đồ được tách từ một commit cũ của checkout chính, nên các bản sửa bug kèm theo bị lệch xa staging.
**How to apply:** Lần sau sửa code ở Zoldify_Backend thì luôn tách nhánh từ `origin/staging` mới nhất (dùng worktree như `_be-ghn-picked`), không tách từ checkout chính. Trước khi hứa "gộp là xanh", chạy `git merge-tree --write-tree origin/staging <nhánh>` để thấy xung đột. Liên quan [[ghn-multiseller-and-local-db]], [[deploy-vps-backend]].
