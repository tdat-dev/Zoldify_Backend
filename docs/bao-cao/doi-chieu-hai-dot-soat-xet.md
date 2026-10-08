# Đối chiếu hai đợt soát xét — Đạt và Cường, và kết luận gộp

**Ngày:** 02/10/2026 · **Người viết:** vai B (Cường)
**Mục đích:** trước khi gộp 7 file xung đột, hiểu **ý đồ** và **giới hạn** của
từng bên, thay vì chọn bừa bên nào.

---

## 1. Cách làm

Không merge. Đọc diff của **từng bên so với tổ tiên chung** (`2562975`), rồi so
hàm với hàm. Kết luận dưới đây dẫn được về số dòng cụ thể.

---

## 2. Hai đợt soát xét có ý đồ khác hẳn nhau

| | **Đạt** | **Cường** |
|---|---|---|
| Cách tiếp cận | Soát xét **có mã hoá**: A-01, B-01…B-04, B-20, H-04…H-08 | Kiểm thử **một luồng từ đầu đến cuối**: mua → trả tiền → kho |
| Xuất phát từ | rà quyền truy cập trên từng route | đi theo đồng tiền và món hàng |
| Sản phẩm | 46 commit · 3 spec mới | 29 commit · 22 lỗi · 28 ca kiểm |
| Bắt được | lỗ **ai được gọi route nào** | lỗ **trạng thái sai sau khi gọi** |

Hai cách này bắt hai loại lỗi khác nhau, và đó là lý do chúng **bổ sung** chứ
không thay thế nhau. Trong khoảng 30 hạng mục của hai bên cộng lại, chỉ **2 chỗ
thật sự chạm nhau**.

---

## 3. Hai chỗ chạm nhau — và cả hai lần bản của Đạt đều tốt hơn

### 3.1 `payments` — hoá ra KHÔNG chạm nhau, và tôi suýt khuyên sai

Bản đồ xung đột tôi viết hôm qua ghi *"ưu tiên bản Đạt"* cho file này. **Sai.**

Đọc kỹ thì hai bên sửa **hai hàm khác nhau**:

| | Hàm | Việc |
|---|---|---|
| Đạt (A-01) | `update()` | khoá route: chỉ admin, **cấm** đặt `SUCCESS` bằng tay, cấm sửa giao dịch đã `SUCCESS`, bỏ hẳn đoạn ghi `orders.is_paid` |
| Cường | `create()` | trả bằng ví phải tạo **ký quỹ** và chuyển đơn sang `confirmed`, trong **một** transaction |

Lấy bản của Đạt đè lên là **xoá mất bản vá `create()`**, tức mở lại cái bẫy:
trả bằng ví thì không có bản ghi ký quỹ nào, `release()` về sau không tìm thấy
gì để giải ngân, và **người bán không bao giờ nhận được tiền của đơn đó**.

→ **Giữ cả hai.** Xung đột ở đây chỉ là import và dòng kề nhau.

Điểm đáng ghi: Đạt kiểm quyền **cả ở controller lẫn trong service**, kèm chú
thích *"Controller đã gắn AdminGuard; kiểm lại ở đây để service không phụ thuộc
vào việc route nào gọi nó."* Anh ấy tự rút ra đúng nguyên tắc tôi viết ở
`escrows` — hai người độc lập đi tới cùng một kết luận là dấu hiệu nguyên tắc
đó đúng.

### 3.2 `escrows.findByOrder` — chạm nhau thật, và **mã của tôi rò**

Đây là chỗ duy nhất hai bên sửa **cùng một hàm**.

| | Cơ chế |
|---|---|
| **Đạt** | lọc **hàng ngay trong SQL**: người không phải admin chỉ nhận khoản mà mình là bên mua hoặc bên bán (`where` dạng mảng = OR) |
| **Cường** | đọc **tất cả** khoản của đơn, rồi hỏi "người này có là một bên nào không" — có thì **trả tất cả**, không thì `Forbidden` |

Hệ này cho phép **một đơn nhiều người bán** — chính migration của tôi thêm
`UNIQUE(order_id, seller_id)`, và `giai-ngan-nhieu-nguoi-ban.spec.ts` kiểm điều
đó. Nên trên một đơn có hai người bán:

> Người bán A gọi `GET /escrows/order/:id` → `trongDon` đúng (A là một bên) →
> hàm trả về **cả dòng của người bán B**: số tiền, trạng thái, id người bán.
> Và vì nạp `relations: ['buyer','seller']` không giới hạn cột, nó kèm luôn
> **email và số điện thoại** của người mua lẫn của B.

Đó đúng loại dữ liệu mà bản vá `f021036` của tôi sinh ra để che — tôi bịt cửa
trước mà để hở cửa sau.

→ **Lấy bản của Đạt cho `findByOrder`.** Nó lọc ở tầng SQL nên không có khe nào.

### 3.3 Và Đạt có một thứ tôi hoàn toàn không có: giới hạn **cột**

```ts
const SAFE_PARTY = { id: true, full_name: true, avatar: true } as const;
```

Áp ở 3 chỗ đọc escrow. Tôi chặn **ai được gọi**; anh ấy còn chặn **trả ra cái
gì**. Hai lớp khác nhau, và lớp của anh ấy là lớp tôi thiếu.

---

## 4. Bốn route escrow — ai phủ bằng cách nào

| Route | Đạt | Cường |
|---|---|---|
| `GET /escrows` toàn sàn | `AdminGuard` ở controller | `chiAdmin()` ở service |
| `GET /escrows/order/:id` | **lọc hàng trong SQL** ✅ | kiểm rồi trả tất cả ⚠️ |
| `GET /escrows/seller/:id` | `assertSelfOrAdmin()` ở controller | `adminHoacChinhChu()` ở service |
| `GET /escrows/held/:id` | `assertSelfOrAdmin()` ở controller | `adminHoacChinhChu()` ở service |
| Giới hạn cột | `SAFE_PARTY` ×3 ✅ | không có ⚠️ |

**Kết luận cho escrows: giữ cả hai, lấy `findByOrder` của Đạt.**

Guard của anh ấy nằm ở controller; của tôi nằm ở service. Giữ cả hai không thừa
— đó là phòng thủ hai lớp, đúng câu tôi viết trong chính file đó: *"Controller
là một cửa; service là cái két. Kiểm ở cửa thì cửa thứ hai mở ra sau này sẽ đi
thẳng vào két."*

---

## 5. Phần KHÔNG chạm nhau — mỗi bên bịt một nửa khác nhau

### Đạt có, tôi không có

| Mã | Việc |
|---|---|
| B-01 | chặn **tự chọn `role`** khi đăng ký công khai — ai cũng tự đăng ký thành `admin` được |
| B-02 | `POST /notifications` chỉ admin |
| B-04 | **khoá tài khoản có hiệu lực thật** ở login, JWT và socket — trước đó khoá xong vẫn dùng được token cũ |
| B-20 | sao lưu MySQL hằng ngày + chép ra Cloudflare R2 + xoay vòng log Docker |
| H-04/05 | `is_default` trả boolean, `has_password` đọc đúng cột |
| H-07/08 | **phí ship GHN lỗi thì từ chối đặt đơn** (trước đó âm thầm thành 0đ); vận đơn FAILED tạo lại được |
| — | migration `push_tokens` (thứ ERD đang thiếu) |

### Tôi có, Đạt không có

| Việc |
|---|
| giá TOCTOU — đọc lại giá dưới khoá (BUG-16) |
| idempotency khi đặt hàng — bấm hai lần một đơn |
| `updateStock` ghi đè (lost update) |
| `order_code` trùng — 7–13% đơn/ngày hỏng |
| phí ship kẹt vĩnh viễn trong ký quỹ khi huỷ |
| trả bằng ví không tạo ký quỹ |
| danh sách sản phẩm công khai không lọc `status` |
| 9 ràng buộc `CHECK` ở tầng database |
| `db-exception.filter` · `public-url` |
| caddy · api ×3 · `mem_limit` (task #6) |
| nhật ký hành động admin (task #34) |
| 18 sơ đồ nguồn + 11 chỗ sơ đồ nói sai |
| 43 bài kiểm cho 6 module trắng test |

---

## 6. Chỗ cả HAI đều chưa chạm

Đáng ghi vào việc còn lại, vì không ai trong hai đợt soát xét bắt được:

1. **`shop.controller.ts:68` ném `new Error(...)` trần** thay vì
   `ForbiddenException` → NestJS trả **HTTP 500** chứ không phải 403. Chặn vẫn
   chặn, nhưng báo sai mã và có thể lộ stack trace. Phép kiểm lại nằm ở
   controller chứ không ở service.
2. **Không có endpoint refresh token** trong khi bảng phân công task #7 giao
   mobile làm *"TokenStore · refresh single-flight"* — app có thể đang gọi vào
   chỗ không tồn tại.
3. **`follows` không có `UNIQUE(follower_id, following_id)`** → hai request song
   song tạo được hai dòng trùng. Hậu quả nhẹ, đã chốt thành một ca ghi nhận.
4. **3 câu SQL mức CAO** còn lại (`sitemap:65`, `products:302`, `shop:110`).

---

## 7. Kết luận gộp, từng file

| File | Quyết định | Mức rủi ro |
|---|---|---|
| `escrows.service.ts` | giữ cả hai; **`findByOrder` lấy bản Đạt**; giữ `SAFE_PARTY`; giữ `chiAdmin`/`adminHoacChinhChu` | thấp |
| `escrows.controller.ts` | giữ cả hai (guard controller của Đạt + chữ ký có `user` của tôi) | thấp |
| `payments.service.ts` | **giữ cả hai** — `update()` của Đạt, `create()` của tôi | thấp |
| `products.service.ts` | giữ cả hai — Đạt thêm lọc `condition` vào khoá cache và hai nhánh truy vấn | thấp |
| `address.entity.ts` | **lấy nguyên bản Đạt** — phía tôi không đổi gì | không |
| `docker-compose.yml` | giữ cả hai; **nhớ thêm `mem_limit` cho dịch vụ `backup` mới**, nếu không `check:compose` đỏ (và nó đỏ đúng) | thấp |
| `orders.service.ts` | ⚠️ **chỗ duy nhất cần đọc kỹ** — xem dưới | **trung bình** |

### Chỗ rủi ro duy nhất: `orders.service.ts`

Đây là file hai bên **cùng sửa một vùng**: đoạn tính phí ship trong lúc tạo đơn.

- **Đạt (H-07):** phí ship lỗi thì **từ chối đặt đơn**, thay vì âm thầm coi là 0đ.
- **Cường:** ký quỹ phải mang theo `shipping_amount`, và cả bốn việc nằm trong
  một transaction.

Hai ý **không mâu thuẫn** — "từ chối khi không tính được phí" và "khi tính được
thì ghi phí vào ký quỹ" ghép được. Nhưng đây là chỗ duy nhất không gộp bằng
cách dán hai khối cạnh nhau; phải viết lại đoạn đó cho cả hai ý cùng đúng, rồi
chạy **cả hai bộ bài kiểm**: `dat-hang-va-ton-kho.spec.ts` của tôi và bài H-07/
H-08 của Đạt.

---

## 8. Bản đồ xung đột ngày 01/10 có hai chỗ sai — đã sửa tại chỗ

Ai đã đọc `gop-bon-nhanh-va-xung-dot-con-lai.md` trước 02/10 cần đọc lại hai
mục này:

| Mục | Bản 01/10 ghi | Đúng ra là |
|---|---|---|
| 3.2 `payments` | *"ưu tiên bản Đạt, lấy bản của anh ấy"* | **giữ cả hai** — hai bên sửa hai hàm khác nhau; lấy một bên là xoá bản vá `create()` |
| 3.1 `escrows` | *"giữ cả hai"* | giữ cả hai **trừ `findByOrder`** — bản của tôi rò dòng của người bán khác |

Cả hai câu sai cùng một nguyên nhân: kết luận ở **mức file** trong khi mới đọc
**thống kê dòng**. Một kết luận mức file đòi đọc tới mức hàm.
