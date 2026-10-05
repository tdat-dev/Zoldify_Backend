# Báo cáo Epic 3 — Chặn phân trang toàn hệ (quét nốt 6 service)

**Người thực hiện:** Cường · **Ngày:** 2026-08-20 · **Nhánh:** `feat/epic-3-pagination-caps` → PR vào `staging`

## 1. Bối cảnh
Epic 1 đã chặn `limit` cho 2 endpoint nóng (orders, products). Rà lại thấy **6 service
khác vẫn dùng `parseInt(limit)` KHÔNG chặn** → `?limit=1000000` vẫn có thể bắt DB nạp
số lượng lớn (cùng class lỗ hổng đã sửa ở Epic 1). Epic 3 quét nốt.

## 2. Pre-mortem (trước khi code)
| # | Rủi ro | Cách chặn |
|---|--------|-----------|
| E3-1 | Cap 100 có thể "giấu" bản ghi nếu ai gọi >100 (gồm admin xem payments) | Đều là list đã phân trang → page tiếp; cap 100 rộng gấp ~5 nhu cầu. Nêu cho nhóm |
| E3-2 | `chat` mặc định 20 → ép về 10 là đổi hành vi | Thêm tham số `defaultSize` cho `normalizePagination`; chat truyền 20 |
| E3-3 | `interactions` có 2 hàm, dễ sót | Sửa cả 2 (findByProduct + findAll) |
| E3-4 | Mỗi service áp offset/limit khác nhau | Đọc từng file trước khi sửa (không thay máy móc) |

## 3. Cách làm
- `normalizePagination` (common/dto/pagination.dto.ts) thêm tham số **`defaultSize`** tuỳ chọn.
- Thay khuôn `parseInt` thủ công bằng `normalizePagination(currentPage, limit)` ở:
  `payments`, `categories`, `interactions` (×2), `users`, `notifications`,
  `chat` (truyền `20`). Chỉ đổi 3 dòng đầu, **logic query giữ nguyên**.

## 4. Kết quả (test thật, server chạy trên DB 1tr)
| Endpoint | `?limit/pageSize=1000000` | Bình thường |
|---|---|---|
| categories | pageSize=**100** ✓ | ✓ |
| users | pageSize=**100** ✓ | pageSize=5→5 ✓ |
| payments | pageSize=**100** ✓ | ✓ |
| notifications | pageSize=**100** ✓ | ✓ |
| interactions | pageSize=**100** ✓ | ✓ |
| chat | (cùng helper, default 20 giữ nguyên) | — |

TypeScript `Found 0 errors`. Không đụng logic nghiệp vụ (chỉ chuẩn hoá tham số phân trang).

## 5. Còn nợ (ngoài phạm vi PR này)
- **Audit index toàn hệ** (phần 2 của Epic 3): rà `EXPLAIN` các list nặng khác
  (reviews/messages/notifications 500k) — đề xuất làm tách 1 PR vì có thể phát sinh migration.
- products chưa keyset (từ Epic 2).
- **Lưu ý nhóm/FE:** mọi endpoint danh sách giờ trả **tối đa 100 bản ghi/trang**. Chỗ nào
  cần "lấy hết" (export…) phải phân trang hoặc làm đường riêng.
