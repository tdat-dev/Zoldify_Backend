# Zoldify — Khung báo cáo và slide, bám đúng template VTC

> Trích thẳng từ ba file trong `D:\Zoldify\3. Project Templates\`:
> `Project Report_en-Template.docx` · `Class Name - Group XX - Presentation Template.pptx` ·
> `TestCaseTemplate.xlsx`
>
> Mục đích: không ai phải đoán mẫu đòi gì. Tiêu đề dưới đây **chép nguyên văn** từ
> template, giữ đúng tiếng Anh và đúng thứ tự. Cột bên phải nói phần đó lấy ở đâu.

---

## 0. Hai chỗ tôi nói sai trước đây, nay sửa

**Slide 13 không phải chỗ để sơ đồ dòng tiền.** Tôi đã bảo vậy. Đọc kỹ template thì
slide 2 (OBJECTIVES) liệt kê 11 mục, đối chiếu với 14 slide thì **"Testing (Unit Test)"
là mục duy nhất không có slide nào**. Slide 13 để trống chính là chỗ của nó.

Đây là tin tốt: nhóm có **21 test**, trong đó 9 test chạy trên MySQL thật kiểm chuyện
đồng thời và tiền. Slide đó mạnh hơn hẳn một sơ đồ lặp lại cái đã chiếu ở slide trước.

**Bảng đặc tả use case có 11 dòng, không phải 8.** Tôi liệt kê thiếu `Description` và
`Organizational Benefits`. Danh sách đủ ở mục 2 dưới đây.

---

## 1. Khung báo cáo — chép nguyên văn từ `.docx`

Không được bỏ mục nào. Cột "Nguồn" cho biết nội dung đã có sẵn ở đâu.

### Bìa
`PROJECT REPORT` · Project Name · Semester · **Class: PFXX** · Group · Instructor ·
Group Members

> Mẫu chỉ có **3 ô thành viên**, nhóm có **4 người** — thêm một dòng.
> Ô `Class` phải điền đúng mã lớp của nhóm, đừng để `PFXX`.

### I. Project Introduction

| Mục con (nguyên văn) | Nguồn | Ai |
|---|---|---|
| *(mô tả hệ thống hiện tại)* | Design doc §1 | D |
| Proposed System | Design doc §2 | D |
| The Scope of the Project to be Applied | Design doc §2 | D |
| System Name | — | D |
| Deployment Environment | Sơ đồ #4 deployment · docker-compose | B |
| Development Tools | package.json hai repo | B |
| Customer Requirements (System Features) | Rubric Level 3 · design doc §2 | D |

### II. Analyze System Requirements

| Mục con | Nguồn | Ai |
|---|---|---|
| Use Case *(danh sách + sơ đồ + **bảng đặc tả từng cái**)* | Sơ đồ #14 · mục 2 dưới | D |
| Activity Diagram | **AD-01..04** đã vẽ, nhãn sẵn tiếng Anh | A |

### III. Design Details

| Mục con | Nguồn | Ai |
|---|---|---|
| UI Design | Chụp màn web + app *(màn hình được chụp, chỉ sơ đồ mới cấm)* | C, D |
| Code Design (Class Diagram) | **CD-01..03** đã vẽ | A |
| Sequence Diagram | Sơ đồ #8-11 — **cần dịch sang tiếng Anh** | A |
| Database Design → Entity Relationship Diagram | Sơ đồ #5, #6 — **cần dịch** | B |
| Database Design Details *(bảng cột từng table)* | Mục 3 dưới | B |

### IV. Test

Template `.docx` và file `.xlsx` **đòi hai bộ cột khác nhau** — xem mục 4.

### V. Task Assignment (To Each Group Member)

Cột: `No` · `Task name` · `Description` · `Start Date` · `End Date` · `Member` ·
`Self-Assessment`

Đã có sẵn 49 dòng đúng thứ tự cột này trong `2026-08-08-phan-cong-4-nguoi.md` mục 5.
Chép sang, thêm cột tự đánh giá.

### VI. Installation Instructions

| Mục con | Nguồn | Ai |
|---|---|---|
| Deployment Diagram | Sơ đồ #4 — **vẽ lại theo ký pháp UML**, bản hiện tại là sơ đồ khối | B |
| Install Database | Migration + `npm run migration:run` | B |
| Install Server | docker-compose · Caddy · biến môi trường | B |
| Install Application | Build web · EAS build APK | B, C |

### Appendix
Terms and abbreviations · References · Some other issues *(kết quả, hạn chế, kinh nghiệm)*

---

## 2. Bảng đặc tả use case — 11 dòng, và một bản mẫu đã điền

Mẫu đòi đúng 11 dòng sau. Đây là chương ngốn thời gian nhất của cả báo cáo.

`Use Case Name` · `Use Case ID` · `Description` · `Actor` · `Organizational Benefits` ·
`Triggers` · `Preconditions` · `Postconditions` · `Main Course` · `Alternate Courses` ·
`Exceptions`

Dưới đây là **một bản đã điền đầy đủ** để D nhân bản cho 9 use case còn lại. Nội dung
lấy từ sơ đồ AD-02, nên nó khớp với hệ thống thật chứ không phải bịa.

| Field | Content |
|---|---|
| **Use Case Name** | Place Order and Pay |
| **Use Case ID** | UC-05 |
| **Description** | A buyer converts the items in their cart into a paid order. Payment is made through the PayOS gateway, and the money is held in escrow by the platform until the buyer confirms delivery. |
| **Actor** | Buyer (primary) · PayOS payment gateway (secondary, system actor) |
| **Organizational Benefits** | Revenue is captured at the moment of purchase rather than on delivery, and holding the money in escrow protects both sides of a student-to-student trade where neither party knows the other. |
| **Triggers** | The buyer presses **Checkout** on the cart screen. |
| **Preconditions** | The buyer is logged in · the cart contains at least one item · every item has `stock > 0` and `status = active` · the buyer has a delivery address. |
| **Postconditions** | An `orders` row exists with `is_paid = 1` and `status = confirmed` · product stock is decremented · one `escrows` row exists per seller in the order, all with `status = holding` · the ledger contains a balanced transaction moving the amount from `gateway_clearing` to `escrow_hold`. |
| **Main Course** | 1. The buyer reviews the cart and presses Checkout.<br>2. The buyer fills in receiver name, phone and address.<br>3. The buyer selects PayOS as the payment method.<br>4. The system locks the product rows, verifies stock, and computes subtotal, shipping fee and final amount.<br>5. The system creates the order with `status = pending` and decrements stock.<br>6. The system requests a payment link from PayOS and returns the checkout URL and QR code.<br>7. The buyer completes the payment on the PayOS page.<br>8. PayOS calls the system webhook.<br>9. The system verifies the webhook signature.<br>10. In a single database transaction the system records the ledger entries, marks the order paid and confirmed, and creates one escrow row per seller.<br>11. The system notifies the sellers. |
| **Alternate Courses** | **AC1: The buyer selects Cash on Delivery**<br>1. Steps 1–5 are followed.<br>2. The system commits the order with `is_paid = 0` and notifies the sellers.<br>3. No payment link is created and no escrow is opened.<br><br>**AC2: PayOS sends the same webhook more than once**<br>1. Steps 8–9 are followed.<br>2. The system finds an existing ledger transaction with the same idempotency key.<br>3. The system returns success without moving money a second time. |
| **Exceptions** | **EX1: An item is out of stock**<br>1. The system rolls back the transaction; no order is created.<br>2. The system returns `400 Out of stock` naming the item.<br><br>**EX2: The webhook signature is invalid**<br>1. The system rejects the request with `401` and records nothing.<br><br>**EX3: The system fails part-way through the webhook transaction**<br>1. The database rolls back every change, including the idempotency marker.<br>2. PayOS retries; the request is processed exactly once. |

**Vì sao bản mẫu này đáng chép.** Ba dòng cuối (`Alternate Courses`, `Exceptions`) là
chỗ đa số nhóm viết qua loa, và cũng là chỗ giám khảo hỏi. `EX3` mô tả đúng thứ đã sửa
ở commit `2daf37e` — nói được điều đó là nói về hệ thống thật, không phải đọc lý thuyết.

### Mười use case chính nên đặc tả

`UC-01` Register with email OTP · `UC-02` Log in · `UC-03` Post an item for sale ·
`UC-04` Search and filter products · `UC-05` Place order and pay · `UC-06` Confirm
delivery received · `UC-07` Release escrow to seller · `UC-08` Request a withdrawal ·
`UC-09` Approve a withdrawal *(admin)* · `UC-10` Chat with a seller

Bảy cái phụ (địa chỉ, thông báo, theo dõi, đánh giá, theo dõi shop, huỷ đơn, hồ sơ) ghi
gọn một dòng mỗi cái trong danh sách use case, không cần bảng đầy đủ.

---

## 3. Bảng chi tiết cột — đúng 4 cột mẫu đòi

`Column Name` · `Data Type` · `Constraints` · `Description`

Ví dụ mẫu dùng bảng `Users`. Zoldify có ~25 bảng; làm hết là quá nhiều, nên chọn
**12 bảng lõi**: `users` · `products` · `categories` · `orders` · `order_items` ·
`carts` · `payments` · `escrows` · `withdrawals` · `ledger_accounts` ·
`ledger_transactions` · `ledger_entries`.

Sinh nhanh bằng cách đọc thẳng từ database đang chạy:

```sql
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, EXTRA
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'zoldify' AND TABLE_NAME = 'orders'
ORDER BY ORDINAL_POSITION;
```

Cột `Description` phải tự viết — đó là phần duy nhất máy không sinh được, và cũng là
phần giám khảo đọc.

---

## 4. Test — hai template đòi hai bộ cột khác nhau

| Nguồn | Cột |
|---|---|
| Chương IV trong `.docx` | Test Case Number · Test Case Name · Test Case Description · Preconditions · Test Case Input · Test Case Expected Output · Test Case Steps · Default Value Preserving |
| `TestCaseTemplate.xlsx` | Test Case ID · Test Scenario · Test Case Description · Test Data · Prerequisites · Test Conditions · Step # · Step Details · Expected Results · Actual Results · Pass/Fail · Created By · Date Tested · Reviewed By · Version |

**Cách xử lý:** điền **file `.xlsx`** làm sản phẩm nộp kèm (nó chi tiết hơn và có sẵn ví
dụ `BU_001` để bắt chước), rồi trong chương IV của báo cáo dùng **bộ cột của `.docx`**
cho khoảng 15-20 ca chính. Hai nơi, hai độ chi tiết, không mâu thuẫn.

Chương IV cũng nên có một đoạn về **unit test tự động**, vì mẫu ghi rõ "Testing (Unit
Test)" ở slide agenda:

- 21 test, chạy bằng `npm test`
- 9 test chạy trên **MySQL thật**, không mock — vì thứ cần kiểm là khoá dòng
  `SELECT ... FOR UPDATE` và ràng buộc `UNIQUE`, mock đi thì test xanh mà không
  chứng minh gì
- Ca mạnh nhất: **100 lệnh giải ngân đồng thời cùng một escrow, tiền chỉ cộng một lần**

---

## 5. Mười bốn slide — nguyên văn tiêu đề từ `.pptx`

| # | Tiêu đề trong mẫu | Đặt gì vào | Ai |
|---|---|---|---|
| 1 | *(bìa)* | Tên, lớp, nhóm, 4 thành viên | D |
| 2 | OBJECTIVES | Giữ nguyên 11 mục của mẫu | D |
| 3 | INTRODUCTION TO PROJECT | Tên, mô tả, công nghệ, ngôn ngữ, database | D |
| 4 | CUSTOMER REQUIREMENTS | Tính năng theo rubric Level 3 | D |
| 5 | USE CASE | Danh sách + sơ đồ #14 | D |
| 6 | ACTIVITY DIAGRAM | **AD-02** và **AD-03** — hai cái đắt nhất | A |
| 7 | UI DESIGN | Ảnh chụp web + app | C |
| 8 | CLASS DIAGRAM | **CD-01** *(CD-02 để dành trả lời phản biện)* | A |
| 9 | SEQUENCE DIAGRAM | Sơ đồ #9 webhook chống lặp | A |
| 10 | ENTITY RELATIONSHIP DIAGRAM | Sơ đồ #5 lõi tiền | B |
| 11 | TASK ASSIGNMENT | Theo tuần, mẫu ghi rõ "Week 1 (x - y)" | D |
| 12 | EXPERIENCE LEARNED | Good thing / Bad thing | Cả nhóm |
| **13** | *(trống trong mẫu)* | **TESTING (UNIT TEST)** — mục duy nhất trong agenda không có slide | B |
| 14 | Q & A | — | — |

---

## 6. Định dạng bắt buộc

| | |
|---|---|
| Giấy | A4 (210 × 297 mm), **in một mặt** |
| Bìa | **in màu xanh**, đúng bố cục trang đầu template |
| Font | Helvetica Neue (Light/Medium) **hoặc Arial**, 12pt |
| Lề | trên 20-25 · dưới 20-25 · **trái 30-35** · phải 15-20 (mm) |
| Header | trái: logo VTC · phải: tên project |
| Footer | trái: `Class_Name–Project_Name` · phải: số trang |
| Độ dài | **tối thiểu 50 trang** |

Logo lấy sẵn trong `3. Project Templates\logo-vtc-academy-plus-color.png`.

Lề trái 30-35mm rộng hơn lề phải rõ rệt — đó là chừa chỗ đóng gáy. Đặt lề đều bốn phía
là sai mẫu, và là lỗi nhìn phát ra ngay.

---

## 7. Ước lượng số trang

| Chương | Trang |
|---|---|
| I. Project Introduction | 4 |
| II. Use case list + diagram + **10 bảng đặc tả** | 18 |
| III. UI Design (ảnh màn hình) | 8 |
| III. Class + Sequence + ERD | 6 |
| III. Bảng cột 12 bảng dữ liệu | 9 |
| IV. Test | 6 |
| V. Task Assignment (49 dòng) | 4 |
| VI. Installation Instructions | 4 |
| Appendix | 2 |
| **Tổng** | **≈ 61** |

Trên mức 50 tối thiểu, có dư để cắt. **Không cần viết dài cho đủ trang** — hai chương
nặng nhất (đặc tả use case và bảng cột) tự nó đã ra 27 trang.
