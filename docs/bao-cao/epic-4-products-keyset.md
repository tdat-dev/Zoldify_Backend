# Epic 4 — Keyset cursor cho `/products` (cuộn vô hạn)

**Người làm:** Cường (vai B) · **Ngày:** 2026-11-03 · **Nhánh:** `feat/products-keyset-cursor` (tách từ `staging`)

Nối tiếp `epic-2-keyset.md` (đã làm cho `/orders`) và trả nợ ghi ở
`epic-3-pagination-caps.md §5`: *"products chưa keyset (từ Epic 2)"*. Bối cảnh và
phương án đã bàn với Đạt + FE/Mobile ở `offset-sau-products-cho-dat.md`.

## 0. Vì sao làm bây giờ (đối chiếu code client THẬT)

Pull FE + Mobile về đọc, không đoán:

- **FE** (`Zoldify_Frontend`, nhánh `fix/home-moi-dang-tai-them`): mục "Mới đăng
  gần đây" cuộn vô hạn, `sort=newest`, 24 món/lượt, **tăng `current` (offset)**,
  phụ thuộc `meta.pages` để biết còn trang, và **phải vá lọc trùng theo `id`** vì
  offset lặp khi có tin chèn đầu (bình luận ngay trong `src/app/page.tsx`).
- **Mobile** (`Zoldify_Mobile`): feed "Dạo chợ" `useInfiniteProducts` qua
  `FlatList onEndReached`, `getNextPageParam: current < pages ? +1 : undefined`
  — **cũng offset + phụ thuộc `meta.pages`** (`src/features/products/api.ts`).

Kết luận đo được: bề mặt cuộn vô hạn **chỉ dùng sắp xếp "mới nhất"
(`created_at DESC`)** — đúng khoá keyset `(created_at, id)`. Keyset vừa diệt
OFFSET sâu (~2.8s @ offset 500k, Epic 2), vừa **bỏ được `COUNT(*)`** trên bề mặt
này (cuộn vô hạn không cần tổng số), vừa **sửa lỗi offset lặp** mà FE đang vá tay.

## 1. Pre-mortem (bảng rủi ro, viết TRƯỚC dòng mã đầu)

| # | Mức | Rủi ro | Cách chặn |
|---|---|---|---|
| K1 | CAO | Đổi API làm vỡ client đang gửi `current`/`pageSize` | **Cộng thêm, không thay thế** (như Epic 2): không `cursor` → offset y như cũ, còn `total`/`pages`. Có `cursor` → keyset. Thêm `meta.nextCursor`, không bỏ field cũ |
| K2 | CAO | **Lộ email/phone người bán.** Nhánh offset cũ hạn chế cột seller bằng `select:{seller:{id,full_name,avatar}}` (lỗi cũ: seller chiếm 43% gói tin). Chuyển sang QueryBuilder dễ `leftJoinAndSelect` kéo cả bảng users ra | Dùng `leftJoin(...).addSelect([id,full_name,avatar])`, KHÔNG `leftJoinAndSelect`. Có bài kiểm canh rò |
| K3 | CAO | `products.created_at` là `timestamp` (GIÂY), không phải timestamp(6). Nhiều tin cùng giây có `created_at` BẰNG nhau | Khoá phụ `id` bắt buộc: `(created_at < :cts OR (created_at = :cts AND id < :cid))`. Cursor giây là đủ (không mất µs như orders) — thực ra chắc hơn orders |
| K4 | TB | Cursor dùng với sort khác (`price`, `most_viewed`…) hoặc kèm tìm kiếm → keyset trên `(created_at,id)` trả SAI thứ tự | Chặn tường minh: cursor chỉ hợp lệ với sort mới nhất/mặc định và không `q`. Sai → 400, không trả nhầm âm thầm |
| K5 | CAO | **Cache lẫn trang.** Key cache hiện gồm trang+lọc+sort nhưng CHƯA có cursor → request cursor đụng nhầm bản nhớ của request offset | Thêm `cur` vào khoá cache ở `findAll` |
| K6 | TB | `limit()` + join đếm nhầm dòng nếu quan hệ fan-out | category/seller là many-to-one (một dòng/sản phẩm), không fan-out → `limit()` an toàn. Có bài kiểm đi hết trang để bắt sót/lặp |
| K7 | Thấp | `nextCursor` cấp cả khi đã hết hàng → client gọi thêm một lượt rỗng | Chỉ cấp `nextCursor` khi trang ĐẦY (`length === size`), mô phỏng đúng Epic 2 |

## 2. Hợp đồng API sau thay đổi (tương thích ngược)

`GET /products` thêm tham số tuỳ chọn `?cursor=`:

- **Không `cursor`** (mọi client hiện tại): y như cũ — offset theo `current`,
  `meta` vẫn có `pages`/`total`. Với sort mới nhất/mặc định, thêm `meta.nextCursor`
  để client bắt đầu cuộn.
- **Có `cursor`** (chỉ với sort mới nhất/mặc định, không `q`): keyset
  `(created_at,id) < con_trỏ`, **bỏ `COUNT`** (`pages`/`total` = null),
  `meta.nextCursor` = con trỏ trang kế (null khi hết).

### Việc FE/Mobile cần làm (để Cường báo lại, KHÔNG sửa hộ)
- Đổi nguồn "còn trang": từ `current < meta.pages` → `!!meta.nextCursor`.
- Lượt đầu gọi không `cursor`, các lượt sau gửi `?cursor=<nextCursor>`.
- FE bỏ được đoạn vá dedup theo `id` (keyset không lặp).
- Thay đổi gói gọn một hàm mỗi client (`loadMoreNewest` ở FE,
  `getNextPageParam`/`fetchProducts` ở Mobile).

## 3. Nghiệm thu
Bằng chính `products-keyset.spec.ts` (viết đỏ trước). Cần test DB: `npm run test:db`
rồi `npm test -- products-keyset`. Đo quy mô lớn (OFFSET vs cursor) bằng
`npm run seed:bulk` + `EXPLAIN` khi có DB bulk.
