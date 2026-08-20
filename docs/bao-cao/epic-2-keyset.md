# Báo cáo Epic 2 — Keyset pagination cho trang sâu (tương thích ngược)

**Người thực hiện:** Cường · **Ngày:** 2026-08-20 · **Nhánh:** `feat/epic-2-keyset` → PR vào `staging`

## 1. Vấn đề
Sau Epic 1, `/orders` phân trang bằng `LIMIT/OFFSET`. Trang **rất sâu** vẫn chậm:
`LIMIT 20 OFFSET 500000` bắt MySQL **quét bỏ 500k dòng** rồi mới lấy 20. Đo: trang
25.000 mất ~2.8s (lạnh) / ~1.0s (nóng).

## 2. Pre-mortem (làm TRƯỚC khi code)
| # | Mức | Rủi ro | Cách chặn |
|---|-----|--------|-----------|
| K1 | CAO | Đổi offset→keyset **vỡ hợp đồng API** (frontend gửi `currentPage`) | **Cộng thêm, không thay thế**: giữ `currentPage`, thêm `?cursor=` tuỳ chọn |
| K2 | TB | Keyset cần index đúng `(created_at, id)` | EXPLAIN xác nhận: `idx_created_at` của InnoDB đã ngầm kèm PK `id` → **không cần index mới** |
| K3 | Thấp | Nhảy tới trang bất kỳ thì không có cursor sẵn | Giữ offset cho kiểu nhảy trang; keyset cho "tải thêm/next" |

## 3. Cách làm
- Thêm `encodeCursor/decodeCursor` (opaque base64url của `created_at.id`) ở
  `common/dto/pagination.dto.ts`.
- `orders.findAll`: có `cursor` → thêm `WHERE (created_at,id) < con_trỏ` rồi LIMIT (keyset);
  không có → `OFFSET` như cũ. Trả `meta.nextCursor` (null khi hết). Controller thêm
  `@Query('cursor')`.
- **Không đụng** `currentPage`, không đổi hình dạng meta cũ (chỉ thêm trường).

## 4. Kết quả (đo trên 1 triệu đơn)
| Kiểm tra | Kết quả |
|---|---|
| Tương thích ngược (currentPage cũ) | Chạy nguyên, thêm `nextCursor` ✓ |
| Keyset nối tiếp (admin/seller) | Không trùng, đúng thứ tự, kể cả qua ranh giới cùng timestamp (id 3→2→1) ✓ |
| Cursor sai định dạng | HTTP 400 rõ ràng ✓ |
| **EXPLAIN offset sâu** | `type=index`, **rows=500,020** (quét qua toàn bộ dòng bỏ) |
| **EXPLAIN keyset** | `type=range` trên `idx_created_at`, key_len=11 (created_at+id) — **seek thẳng** |
| Thời gian keyset @ depth 500k | ~0.4s = **bằng trang đầu** (độc lập độ sâu) |

## 4b. Hotfix độ chính xác con trỏ (quan trọng)
Rà lại sau khi merge phát hiện: cột `created_at` là **`timestamp(6)` (micro-giây)**,
mặc định `CURRENT_TIMESTAMP(6)` → đơn tạo qua app CÓ µs thật. Nhưng con trỏ ban đầu mã
hoá bằng JS `Date.getTime()` = **mili-giây** → mất µs → ở ranh giới trang sẽ **BỎ SÓT**
các đơn nằm trong khe µs bị cắt. Dữ liệu seed bulk tình cờ chỉ có ms nên load test
không lộ. **Sửa:** con trỏ mang chuỗi µs đầy đủ qua `DATE_FORMAT('%f')`, so sánh đúng
tuyệt đối. **Kiểm:** tạo 30 đơn cùng giây khác µs → walk qua cursor thu đủ 30/30, đúng
thứ tự, không sót/không lặp (code cũ sẽ nhảy qua gần hết). Index vẫn `range`.

## 5. Ghi chú
- Ở chế độ keyset, chi phí còn lại chủ yếu là `getCount()` (đếm 1tr để trả `total`);
  nếu cần "tải thêm" cực nhẹ sau này có thể cho phép bỏ `total`.
- Chưa áp keyset cho `products` (deep-offset ở products chưa đo thấy nặng) — ghi nợ.
