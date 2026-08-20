# Báo cáo Epic 1 — Sửa `orders.service.ts findAll` (nạp hết bảng → phân trang ở SQL)

**Người thực hiện:** Cường · **Ngày:** 2026-08-20 · **Nhánh:** `feat/fix-orders-findall` → PR vào `staging`
**Tiền đề:** DB đã có 1,000,003 đơn / 2,000,003 order_items (từ Epic 0).

---

## 1. Vấn đề (đo được, không suy đoán)

`GET /orders` gọi `findAll`. Code cũ:
1. `createQueryBuilder('order').leftJoin('order.items'...)` rồi **`getRawMany()` KHÔNG có LIMIT**
   → kéo **mọi dòng đơn×món** khớp điều kiện về Node, sau đó mới `slice` phân trang trong app.
2. Vì JOIN sang `items`, mỗi đơn nở thành nhiều dòng → còn phải khử trùng bằng `Set` trong app.

**Hệ quả đo bằng dữ liệu thật (trước khi sửa):**

| Đường gọi | Thời gian 1 request `?limit=20` | RAM |
|-----------|-------------------------------|-----|
| buyer (3 đơn) | 73 ms | — |
| **admin (xem toàn bộ 1tr đơn)** | **>240s vẫn chưa trả về — treo** | **~500 MB cho MỘT request** |

Chỉ một người admin mở trang đơn hàng là đủ ghim 500MB và treo tiến trình. Với nhiều
user thì sập ngay (khớp baseline 1000 VU = 99.55% lỗi ở Epic 0).

---

## 2. Cách sửa

Đẩy **đếm tổng** và **phân trang** xuống SQL, chỉ nạp đúng trang cần:

1. **`total` = `getCount()`** trên câu lọc — TypeORM đếm DISTINCT khoá chính gốc,
   nên seller-view nhiều item/đơn vẫn ra đúng **số đơn** (sửa luôn bug `meta.total`
   đếm theo *món* trước đây).
2. **Lấy ID của trang bằng `LIMIT/OFFSET` ở SQL** (`.limit().offset()`), không kéo hết về app.
3. **Bỏ JOIN cho buyer/admin** — chỉ quét bảng `orders` (dùng index `idx_user_created` /
   `idx_created_at`). Chỉ khi `as=seller` mới JOIN `items→product` lọc `product.seller_id`,
   kèm `DISTINCT` (+ `created_at` vào SELECT cho hợp lệ `ONLY_FULL_GROUP_BY`).
4. Nạp đầy đủ **chỉ ≤ `limit` đơn** của trang qua `find({ where: { id: In(pageIds) } })`.

File đổi: `src/ordering/orders/orders.service.ts` (chỉ hàm `findAll`).

---

## 3. Kết quả SAU khi sửa (cùng máy, cùng dữ liệu)

| Đường gọi | TRƯỚC | SAU | Ghi chú |
|-----------|-------|-----|---------|
| **admin** trang 1 | >240s / ~500MB (treo) | **~1.1s**, RAM phẳng | `total=1,000,003` đúng, trả 20 đơn |
| admin lọc `status=delivered` | (treo) | **1.46s** | |
| admin trang sâu (offset 500k) | (treo) | **2.78s** | chi phí OFFSET sâu → Epic 2 dùng keyset |
| buyer | 73 ms | **28 ms** | `total=3` đúng |
| seller | đếm sai theo *món* | **47 ms** | `total=3` đúng (sửa cả bug đếm) |

**Tóm tắt:** admin từ *treo vô hạn + 500MB* → **~1.1s, bộ nhớ phẳng**; đồng thời sửa
đúng `meta.total` cho seller/admin.

## 4. Còn lại (không thuộc Epic 1)
- OFFSET sâu vẫn tốn ~2.8s ở trang rất xa → **Epic 2**: phân trang keyset (theo `created_at,id`) + chặn `limit` tối đa.
- Đo lại tải 1000 VU tổng thể sau khi gộp Epic 1–3.

**Kiểm chứng nhanh:**
```bash
# đăng nhập admin rồi:
curl -s -o /dev/null -w '%{time_total}s\n' -H "Authorization: Bearer <TOKEN>" \
  "http://localhost:3000/api/v1/orders?currentPage=1&limit=20"
```
