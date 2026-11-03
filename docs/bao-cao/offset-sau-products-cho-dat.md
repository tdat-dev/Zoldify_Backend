# Vấn đề cần nhóm quyết — OFFSET sâu ở danh sách sản phẩm

**Người nêu:** Cường (vai B) · **Ngày:** 2026-11-03 · **Gửi:** Đạt + nhóm FE/Mobile
**Mục đích:** chốt *cách* sửa trước khi gõ code. Đụng hợp đồng API nên liên quan
cả Web, Admin và Mobile. Tài liệu để thảo luận, **chưa sửa dòng nào**.

> Nối tiếp `epic-2-keyset.md` và `epic-3-pagination-caps.md`. Nợ này đã ghi ở
> `epic-3-pagination-caps.md §5`: *"products chưa keyset (từ Epic 2)"*.
>
> **Bối cảnh quyết định hướng đi:** trang chủ sắp làm **cuộn vô hạn**
> ("tải thêm"), không phải lưới "1 2 3 … N". Điều này đổi hẳn phương án nên
> chọn — xem §4.

---

## 1. Vấn đề (đo được, không suy đoán)

Danh sách sản phẩm công khai `GET /products` (nhánh không tìm kiếm,
`src/catalog/products/products.service.ts` ~459–513) phân trang bằng **OFFSET**
(`findAndCount` với `skip: offset`). Ở quy mô ~1 triệu sản phẩm, mỗi trang có
**hai** chi phí:

1. **OFFSET sâu.** `skip: 500000` bắt MySQL quét bỏ 500k dòng mới lấy được 20.
   Số đo của nhóm ở `pagination.dto.ts:97` và Epic 2: **~2.8s lạnh / ~1.0s nóng**
   tại trang sâu.
2. **`COUNT(*)` ở MỌI request.** `findAndCount` sinh thêm một `SELECT COUNT(*)`
   trên tập đã lọc, chạy **kể cả trang 1**. Epic 2 §5 đã tự ghi: *"chi phí còn
   lại chủ yếu là `getCount()` (đếm 1tr để trả `total`)"*. Mỗi lượt mở trang chủ
   đều trả giá này — đông người duyệt là nghẽn, không riêng trang sâu.

**Không nhầm với lỗi `/orders` cũ.** `/orders` từng nạp cả bảng vào RAM
(>240s, 500MB/request) — **đã sửa ở Epic 1**. Danh sách sản phẩm phân trang đúng
ở SQL, *không* nạp cả bảng; chi phí chỉ là hai mục trên.

## 2. Đã chặn được gì rồi (để không ai tưởng chưa làm gì)

| Đã làm | Hiệu lực |
|---|---|
| Trần cứng `MAX_PAGE_SIZE = 100` (`pagination.dto.ts:35`) | `?limit=1000000` **không** nạp cả bảng được nữa — Epic 1 + Epic 3 |
| Keyset đã có và đã chứng minh trên `/orders` | `encodeCursor/decodeCursor` ở `pagination.dto.ts:73-126`; depth 500k còn **~0.4s = bằng trang đầu** |
| Chuẩn hoá phân trang toàn hệ | 6 service qua `normalizePagination` — Epic 3 |

Phần còn hở **chỉ là**: danh sách sản phẩm vẫn OFFSET + COUNT-mỗi-request.

## 3. Hai bề mặt, hai nhu cầu khác nhau

Mấu chốt: không phải mọi màn danh sách đều cần như nhau.

- **Trang chủ / duyệt sản phẩm (công khai, sắp là cuộn vô hạn).** Cuộn vô hạn
  chỉ cần "lấy 20 cái tiếp theo". **Không cần số trang, không cần `total`.** Đây
  đúng là hình mẫu keyset sinh ra để giải: trả `items` + `nextCursor`, client
  cuộn tới đâu xin con trỏ tới đó.
- **Bảng quản trị (Admin).** Thường cần "nhảy tới trang N" và tổng số bản ghi để
  soát. Chỗ này offset + `total` là hợp lý, lưu lượng lại thấp.

## 4. Vì sao cuộn vô hạn đổi hẳn lựa chọn

Trước đây lo "đổi sang keyset thì mất `total`/mất số trang, buộc FE sửa". Nhưng
**trang chủ cuộn vô hạn thì vốn không dùng số trang và không cần `total`** — nên
keyset *không* lấy đi thứ gì màn đó đang xài. FE làm cuộn vô hạn thì tiêu thụ
`nextCursor` là **đường đi gọn nhất**, không phải việc phát sinh.

Và đây là phần quan trọng nhất về hiệu năng: **cuộn vô hạn cho phép bỏ hẳn
`COUNT(*)`** ở endpoint đó (không hiện tổng thì không phải đếm). Tức keyset ở
trang chủ giết **cả hai** chi phí ở §1 cùng lúc, không chỉ OFFSET sâu.

Hạ tầng đã có sẵn từ Epic 2 (`encodeCursor/decodeCursor`), và Epic 2 cũng đã
chứng minh cách **cộng thêm không phá vỡ** (giữ `currentPage`, thêm `?cursor=`,
thêm `nextCursor` vào meta — rủi ro K1). Nên client cũ nào còn gọi offset vẫn
chạy trong lúc FE chuyển dần sang cursor.

## 5. Phương án đề xuất

**Trang chủ / duyệt công khai → keyset cursor (cộng thêm).**
- Thêm `?cursor=` cho `GET /products`; trả `meta.nextCursor`.
- Khi client gọi bằng `cursor`, **bỏ `COUNT(*)`** (không trả `total`) → cắt chi
  phí đếm.
- Giữ đường `currentPage` cũ để không vỡ gì trong lúc FE/Mobile chuyển sang cuộn
  vô hạn. Đặt chốt độ sâu cho đường offset cũ (vd offset > 50.000 thì 400
  "hãy lọc hẹp hơn") để không ai bò trang sâu làm nghẽn trong giai đoạn giao thời.

**Bảng Admin → giữ offset + `total`, chốt độ sâu.**
- Lưu lượng thấp, cần nhảy trang, nên giữ nguyên hợp đồng số trang; chỉ thêm chốt
  độ sâu + cân nhắc cache COUNT nếu đo thấy chậm.

## 6. Pre-mortem (làm trước khi code)

| # | Mức | Rủi ro | Cách chặn |
|---|---|---|---|
| P1 | CAO | Đổi API làm vỡ client đang gọi `currentPage` | Theo Epic 2 K1: **cộng thêm cursor, giữ currentPage** — không bỏ đường cũ |
| P2 | TB | Chốt độ sâu "giấu" sản phẩm ở trang rất sâu | Cuộn vô hạn không bao giờ chạm offset sâu (nó đi bằng cursor); chốt chỉ để chặn bò dữ liệu. Ngưỡng nêu cho nhóm trước khi chốt |
| P3 | TB | Keyset products cần index `(sort_key, id)` đúng | EXPLAIN xác nhận trước; Epic 2 thấy index InnoDB đã ngầm kèm PK |
| P4 | TB | Con trỏ mất micro-giây → sót ở ranh giới (lỗi thật Epic 2) | Dùng lại `encodeCursor` đã sửa, mang chuỗi µs đầy đủ (`pagination.dto.ts:78-88`) |
| P5 | TB | Sắp xếp trang chủ không phải theo `created_at` (vd `best_selling`, `most_viewed`) thì keyset theo `(created_at,id)` không áp được | Chốt với nhóm: cuộn vô hạn áp cho sắp xếp "mới nhất"/mặc định; các sắp xếp theo đếm cần khoá keyset khác hoặc vẫn dùng offset có chốt |

> **P5 là câu hỏi mở quan trọng.** `queryProductList` hiện cho sort theo
> `price`, `sold_count`, `view_count`… (whitelist ở products.service). Keyset chỉ
> gọn khi khoá sắp x="giá trị duy nhất tăng/giảm đều" như `(created_at,id)`. Cần
> chốt: cuộn vô hạn ở trang chủ dùng *những* kiểu sắp xếp nào.

## 7. Câu hỏi cần Đạt + FE/Mobile trả lời

1. Trang chủ cuộn vô hạn dùng **những kiểu sắp xếp nào**? (quyết định P5 — kiểu
   nào keyset được, kiểu nào phải offset-có-chốt)
2. Màn Admin có **bắt buộc** giữ số trang + tổng số không? (gần như chắc là có)
3. Chấp nhận **chốt độ sâu** cho đường offset công khai ở ngưỡng nào? Trên ngưỡng
   trả 400 "hãy lọc hẹp hơn", hay kẹp im lặng?
4. Mobile có cùng dùng `GET /products` + cursor cho danh sách không, để BE làm
   một hợp đồng dùng chung?

## 8. Cách đo để chốt bằng số (đúng tinh thần repo)

Có sẵn `npm run seed:bulk` (`scripts/seed-bulk.ts`) để đổ dữ liệu lớn và
`npm run loadtest`. Trước khi chốt, đo trên DB bulk: `EXPLAIN` + thời gian cho
(a) trang 1 — thấy chi phí COUNT; (b) offset 500k — thấy chi phí OFFSET sâu;
(c) đường cursor. So p95 ba đường rồi mới quyết. Việc đo cần dựng stack
(Redis + MySQL bulk) lên.
