# Zoldify — Activity Diagram & Class Diagram

> Bổ sung sơ đồ **#17** và **#18** trong bảng kiểm kê ở
> `2026-08-06-capstone-delivery-plan.md` §6. Hai sơ đồ này bắt buộc có trong báo cáo
> và là hai sơ đồ duy nhất còn thiếu.
>
> **Nhãn trong sơ đồ viết bằng tiếng Anh ngay từ đầu.** Báo cáo phải toàn tiếng Anh,
> nên dịch lại sau là làm hai lần. Phần chữ giải thích quanh sơ đồ để tiếng Việt cho
> nhóm đọc — chữ đó không đi vào báo cáo, chỉ sơ đồ mới đi.

---

## Mục lục

| Mã | Sơ đồ | Dùng ở đâu |
|---|---|---|
| [AD-01](#ad-01--registration-with-email-otp) | Activity — Đăng ký có OTP | Ch. **II** Analyze System Requirements |
| [AD-02](#ad-02--place-order-and-pay) | Activity — Đặt hàng và thanh toán | Ch. **II** · slide 10 |
| [AD-03](#ad-03--escrow-release) | Activity — Giải ngân ký quỹ | Ch. **II** · slide 13 |
| [AD-04](#ad-04--seller-withdrawal-two-step) | Activity — Rút tiền 2 bước | Ch. **II** |
| [CD-01](#cd-01--domain-model) | Class — Mô hình miền | Ch. **III** Design Details |
| [CD-02](#cd-02--money-service-layer) | Class — Tầng dịch vụ tiền | Ch. **III** · dùng khi phản biện |
| [CD-03](#cd-03--request-pipeline) | Class — Đường đi một request | Ch. **III** |

Mẫu báo cáo đòi Activity Diagram ở **chương II** (đi kèm bảng đặc tả use case) và
Class Diagram ở **chương III** (đi kèm Sequence + ERD) — xem §4 của
`2026-08-06-capstone-delivery-plan.md`. Đặt nhầm chương là mất điểm hình thức mà
không ai nhắc.

---

## Quy ước đọc: TO-BE, không phải AS-IS

Sơ đồ dưới đây vẽ **hệ thống sẽ bảo vệ**, không phải hệ thống đang chạy hôm nay.
Chỗ nào chưa có trong mã nguồn, tôi đánh dấu 🔴 ngay trong sơ đồ và liệt kê ở bảng
"Còn thiếu" ngay dưới mỗi sơ đồ.

Làm vậy vì hai lý do. Thứ nhất, báo cáo mô tả sản phẩm cuối. Thứ hai — quan trọng hơn
với nhóm lúc này — **mỗi ô 🔴 chính là một task**. Đây là nguồn để chia việc, không
phải hình vẽ trang trí.

---

## AD-01 — Registration with email OTP

Nguồn: `identity/auth/auth.service.ts:60-119`, `identity/users/users.service.ts`.

```mermaid
flowchart TD
    Start([Start]) --> C1["Enter full name and email"]

    subgraph Client["Client — Mobile app / Web"]
        C1
        C4["Enter OTP and password"]
        C7["Redirect to Login"]
    end

    subgraph API["Backend — AuthService"]
        A1["POST /api/v1/auth/register/send-otp"]
        D1{"Email already<br/>registered?"}
        A2["Generate 6-digit OTP"]
        A3["Store OTP in cache<br/>key register_otp_email, TTL 300s"]
        A4["Send OTP email via SMTP"]
        D2{"Mail delivered?"}
        A5["POST /api/v1/auth/register/verify-otp"]
        D3{"OTP found<br/>in cache?"}
        D4{"OTP matches?"}
        A6["Hash password with bcrypt"]
        A7["INSERT users<br/>role = buyer, email_verified = true"]
        A8["Delete OTP from cache"]
        A9["Create ledger account<br/>user / available"]
    end

    subgraph Err["Error responses"]
        E1["400 — Email already registered"]
        E2["400 — Cannot send email"]
        E3["400 — OTP expired"]
        E4["400 — Wrong OTP"]
    end

    C1 --> A1
    A1 --> D1
    D1 -- yes --> E1
    D1 -- no --> A2
    A2 --> A3
    A3 --> A4
    A4 --> D2
    D2 -- no --> E2
    D2 -- yes --> C4
    C4 --> A5
    A5 --> D3
    D3 -- no --> E3
    D3 -- yes --> D4
    D4 -- no --> E4
    D4 -- yes --> A6
    A6 --> A7
    A7 --> A8
    A8 --> A9
    A9 --> C7
    C7 --> End([End])

    E1 --> End
    E2 --> End
    E3 --> End
    E4 --> End

    classDef todo fill:#fee2e2,stroke:#dc2626,stroke-width:2px
    class A9 todo
```

**Còn thiếu (🔴 = ô tô đỏ)**

| Ô | Việc phải làm | Ai | Chi phí |
|---|---|---|---|
| `A9` | Tạo sẵn `ledger_accounts` cho user mới ngay khi đăng ký, thay vì tạo lười lúc giao dịch đầu | A | 1 giờ |

**Điểm đáng nói khi bảo vệ.** OTP nằm trong cache có TTL chứ không nằm trong bảng
`users`. Nghĩa là tài khoản **chỉ được tạo sau khi xác thực xong** — không có hàng
đống tài khoản rác `email_verified = false` nằm chiếm chỗ email của người khác. Đổi
lại, cache mất thì người dùng phải xin OTP lại; với 5 phút thì đó là đánh đổi đúng.

---

## AD-02 — Place order and pay

Nguồn: `ordering/orders/orders.service.ts:51-169`, `money/payos/payos.service.ts:45-109, 315+`.

Đây là sơ đồ dày nhất và cũng là sơ đồ hay bị hỏi nhất, vì nó là chỗ tiền đổi chủ.

```mermaid
flowchart TD
    Start([Start]) --> B1["Review cart and press Checkout"]

    subgraph Buyer["Buyer"]
        B1
        B2["Fill receiver name, phone, address"]
        B3["Choose payment method"]
        B6["Scan QR / pay on PayOS page"]
    end

    subgraph Order["Backend — OrdersService"]
        O1["POST /api/v1/orders"]
        O2["BEGIN TRANSACTION"]
        O3["SELECT products FOR UPDATE"]
        D1{"Every item<br/>in stock?"}
        O4["Compute subtotal, shipping fee, final amount"]
        O5["INSERT orders — status = pending, is_paid = 0"]
        O6["INSERT order_items"]
        O7["UPDATE products SET stock = stock - qty"]
        D2{"Payment<br/>method?"}
        O8["COMMIT"]
    end

    subgraph Pay["Backend — PayosService"]
        P1["Call PayOS create-payment-link"]
        P2["INSERT payments — status = pending"]
        P3["Return checkoutUrl and qrCode"]
        W1["POST /api/v1/payos/webhook"]
        W2["Verify HMAC signature"]
        D3{"Signature<br/>valid?"}
        W3["BEGIN TRANSACTION"]
        W4["INSERT ledger_transactions<br/>key = payos:orderCode:linkId"]
        D4{"Duplicate<br/>key?"}
        W5["Ledger entries:<br/>gateway_clearing -X, escrow_hold +X"]
        W6["UPDATE orders SET is_paid = 1, status = confirmed"]
        W7["INSERT escrows — one row per seller, status = holding"]
        W8["COMMIT"]
    end

    subgraph Async["Async — worker"]
        N1["Notify sellers — push and in-app"]
        N2["Create GHN shipping order"]
    end

    subgraph ErrO["Error responses"]
        EO1["400 — Out of stock"]
        EO2["ROLLBACK — order not created"]
        EO3["200 OK — already processed, ignore"]
        EO4["401 — Invalid signature"]
    end

    B1 --> B2 --> B3 --> O1
    O1 --> O2 --> O3 --> D1
    D1 -- no --> EO1 --> EO2 --> End([End])
    D1 -- yes --> O4 --> O5 --> O6 --> O7 --> D2

    D2 -- "COD" --> O8
    O8 --> N1

    D2 -- "PayOS" --> P1
    P1 --> P2 --> O8b["COMMIT"]
    O8b --> P3 --> B6
    B6 --> W1
    W1 --> W2 --> D3
    D3 -- no --> EO4 --> End
    D3 -- yes --> W3
    W3 --> W4 --> D4
    D4 -- yes --> EO3 --> End
    D4 -- no --> W5 --> W6 --> W7 --> W8
    W8 --> Fork(( ))
    Fork --> N1
    Fork --> N2
    N1 --> Join(( ))
    N2 --> Join
    Join --> End

    classDef todo fill:#fee2e2,stroke:#dc2626,stroke-width:2px
    class O3,W3,W4,W5,W8,N2 todo
```

**Còn thiếu (🔴)**

| Ô | Việc phải làm | Ai | Chi phí |
|---|---|---|---|
| `O3` | `SELECT ... FOR UPDATE` khi trừ kho. Hiện đọc rồi ghi không khoá → hai người mua món cuối cùng cùng lúc thì kho về âm | A | 3 giờ |
| `W3`,`W8` | Gói webhook vào **một** transaction. Hiện log chống lặp ghi **trước** và **ngoài** transaction: sập giữa chừng là tiền vào mà đơn không đổi trạng thái | A | 1 ngày |
| `W4` | Dùng `ledger_transactions.idempotency_key` thay cho bảng `payos_webhook_log` | A | trong cùng task |
| `W5` | Ghi bút toán kép thay vì `users.balance += X` | A | trong cùng task |
| `N2` | Tạo vận đơn GHN tự động sau khi trả tiền | B | 0,5 ngày |

**Vì sao có hai nhánh COMMIT.** Với COD, đơn chốt xong là hết. Với PayOS thì phải
tạo được link thanh toán **trước khi** commit — nếu PayOS trả lỗi mà đơn đã commit,
người dùng có đơn treo không có đường trả tiền. Trừ kho và tạo link nằm chung một
transaction, hỏng một cái là hỏng cả hai.

**Vì sao webhook là nguồn sự thật, không phải deep link.** Người dùng trả tiền xong
có thể tắt trình duyệt trước khi bị chuyển về app. Deep link `zoldify://payment/return`
chỉ để điều hướng cho đẹp; cái quyết định "đã trả tiền" là webhook PayOS gọi thẳng
vào backend. Thầy hay hỏi chỗ này.

---

## AD-03 — Escrow release

Nguồn: `money/escrows/escrows.service.ts:55-76`, `ordering/orders/orders.service.ts:238-326`.

Đây là sơ đồ có nhiều ô đỏ nhất, và đó chính là vấn đề: **hôm nay tiền vào escrow
rồi không có đường ra hợp lệ.**

```mermaid
flowchart TD
    Start([Start]) --> T1{"What ends<br/>the holding period?"}

    subgraph Trigger["Trigger — three ways in"]
        T1
        T2["Buyer presses<br/>Confirm received"]
        T3["GHN webhook<br/>status = delivered"]
        T4["Cron job — 3 days after<br/>delivery, no dispute"]
    end

    subgraph Guard["Backend — authorization"]
        G1["PATCH /api/v1/orders/:id/status"]
        G2{"Caller is buyer<br/>of this order,<br/>or admin?"}
        G3{"Transition<br/>shipping to delivered<br/>allowed?"}
    end

    subgraph Ledger["Backend — LedgerService.post"]
        L1["BEGIN TRANSACTION"]
        L2["INSERT ledger_transactions<br/>key = escrow_release:escrowId"]
        D1{"Duplicate<br/>key?"}
        L3["SELECT ledger_accounts FOR UPDATE<br/>ordered by id ASC"]
        L4["Read platform_fee_percent<br/>from settings"]
        L5["Entries:<br/>escrow_hold -X<br/>seller/available +X-fee<br/>platform/revenue +fee"]
        D2{"SUM entries = 0<br/>and no user balance < 0?"}
        L6["INSERT ledger_entries<br/>UPDATE balances"]
        L7["UPDATE escrows SET status = released"]
        L8["UPDATE orders SET status = delivered"]
        L9["COMMIT"]
    end

    subgraph After["After commit"]
        F1["Notify seller — money available"]
        F2["Notify buyer — order complete"]
    end

    subgraph ErrL["Error handling"]
        X1["403 — Not your order"]
        X2["400 — Illegal status transition"]
        X3["Return existing transaction<br/>no double credit"]
        X4["ROLLBACK — ledger unchanged"]
    end

    T1 --> T2
    T1 --> T3
    T1 --> T4
    T2 --> G1
    T3 --> G1
    T4 --> G1

    G1 --> G2
    G2 -- no --> X1 --> End([End])
    G2 -- yes --> G3
    G3 -- no --> X2 --> End
    G3 -- yes --> L1

    L1 --> L2 --> D1
    D1 -- yes --> X3 --> End
    D1 -- no --> L3 --> L4 --> L5 --> D2
    D2 -- no --> X4 --> End
    D2 -- yes --> L6 --> L7 --> L8 --> L9
    L9 --> Fork(( ))
    Fork --> F1
    Fork --> F2
    F1 --> Join(( ))
    F2 --> Join
    Join --> End

    classDef todo fill:#fee2e2,stroke:#dc2626,stroke-width:2px
    classDef done fill:#dcfce7,stroke:#16a34a,stroke-width:2px
    class T2,T3,T4,G2,G3,L4,L5,L7,L8 todo
    class L1,L2,L3,L6,L9 done
```

**Đã có (🟢)** — `L1`, `L2`, `L3`, `L6`, `L9` chính là `LedgerService.post()` đã viết
xong và có 6 test chạy trên MySQL thật.

**Còn thiếu (🔴)**

| Ô | Việc phải làm | Ai | Chi phí |
|---|---|---|---|
| `G2` | **Lỗ hổng bảo mật.** `PATCH /orders/:id/status` không kiểm vai trò. Ai xem được đơn cũng đặt được `delivered`, tức tự nhả tiền cho chính mình | A | 2 giờ · **làm trước tiên** |
| `G3` | Bảng chuyển trạng thái hợp lệ. Hiện nhảy từ `pending` thẳng sang `delivered` được | A | 2 giờ |
| `T2` | Nút "Đã nhận hàng" ở app + web. Grep toàn bộ frontend: **không nơi nào** gửi `status = delivered`, chỉ có một nhãn tab lọc | B (web) · C (app) | 0,5 ngày |
| `T3` | Webhook GHN | B | 0,5 ngày |
| `T4` | Cron tự giải ngân sau 3 ngày | A | 0,5 ngày |
| `L4`,`L5` | Phí sàn đọc từ `settings`, chia 3 chân thay vì 2 | A | 0,5 ngày |
| `L7`,`L8` | Cập nhật escrow + order **trong cùng** transaction ledger | A | trong cùng task |

**Câu hỏi phản biện gần như chắc chắn bị hỏi:** *"Nếu người mua không bao giờ bấm xác
nhận thì tiền của người bán kẹt vĩnh viễn à?"* — Trả lời bằng ô `T4`: có cron tự giải
ngân sau 3 ngày kể từ khi GHN báo đã giao, nếu không có khiếu nại. Ba đường vào
`T2`/`T3`/`T4` tồn tại chính là để không có đường cụt.

---

## AD-04 — Seller withdrawal (two-step)

Nguồn: `money/withdrawals/withdrawals.service.ts`.

Hai bước, vì chuyển khoản ngân hàng là thao tác **tay** của admin. Tiền phải rời ví
người bán ngay lúc duyệt (chống rút hai lần), nhưng chỉ rời hệ thống khi admin xác
nhận đã chuyển thật.

```mermaid
flowchart TD
    Start([Start]) --> S1["Seller enters amount + bank details"]

    subgraph Seller["Seller"]
        S1
    end

    subgraph Req["Backend — WithdrawalsService.create"]
        R1["POST /api/v1/withdrawals"]
        R2{"amount <= available<br/>balance?"}
        R3{"amount >= minimum<br/>from settings?"}
        R4["INSERT withdrawals — status = pending"]
    end

    subgraph Admin["Admin"]
        M1["Review request list"]
        M2{"Approve?"}
        M3["Transfer money in banking app"]
        M4["Press Mark as transferred"]
    end

    subgraph Step1["Step 1 — approve — LedgerService.post"]
        A1["key = withdrawal_approve:id"]
        A2["Entries:<br/>seller/available -X<br/>platform/withdrawal_pending +X"]
        A3["UPDATE withdrawals SET status = approved"]
    end

    subgraph Step2["Step 2 — complete — LedgerService.post"]
        B1["key = withdrawal_complete:id"]
        B2["Entries:<br/>platform/withdrawal_pending -X<br/>external/bank_external +X"]
        B3["UPDATE withdrawals SET status = completed"]
    end

    subgraph Rej["Reject path"]
        J1["UPDATE withdrawals SET status = rejected"]
        J2["No ledger entry — money never moved"]
    end

    subgraph ErrW["Error responses"]
        Y1["400 — Insufficient balance"]
        Y2["400 — Below minimum amount"]
    end

    S1 --> R1 --> R2
    R2 -- no --> Y1 --> End([End])
    R2 -- yes --> R3
    R3 -- no --> Y2 --> End
    R3 -- yes --> R4 --> M1 --> M2
    M2 -- no --> J1 --> J2 --> End
    M2 -- yes --> A1 --> A2 --> A3
    A3 --> M3 --> M4
    M4 --> B1 --> B2 --> B3 --> End

    classDef todo fill:#fee2e2,stroke:#dc2626,stroke-width:2px
    class A1,A2,A3,B1,B2,B3,R3 todo
```

**Còn thiếu (🔴)** — toàn bộ phần ledger. Hiện `approve()` chỉ đổi cột `status`, không
đụng tới tiền. Việc của A tuần 4, ~1,5 ngày.

**Vì sao phải có tài khoản `withdrawal_pending` riêng.** Nếu chỉ trừ ví người bán rồi
coi như xong, thì lúc đối soát sẽ thấy tổng ví < tổng tiền thật trong ngân hàng, mà
không giải thích được phần chênh nằm đâu. Tài khoản trung gian này chính là câu trả
lời: *"chỗ chênh là 7 lệnh rút đã duyệt, admin chưa bấm nút chuyển."*

---

## CD-01 — Domain model

Đây là **Class Diagram**, không phải ERD. Khác nhau ở chỗ nào — xem ghi chú cuối mục.

```mermaid
classDiagram
    direction LR

    class User {
        +int id
        +string full_name
        +string email
        -string password
        +string phone_number
        +UserRole role
        +bool email_verified
        +bool is_locked
        +int token_version
        +isSeller() bool
        +canModerate() bool
    }

    class Product {
        +int id
        +string name
        +string slug
        +decimal price
        +int stock
        +string condition
        +int sold_count
        +ProductStatus status
        +isAvailable() bool
        +decreaseStock(qty) void
    }

    class Category {
        +int id
        +string name
        +string slug
    }

    class Cart {
        +int id
        +int quantity
    }

    class Order {
        +int id
        +string order_code
        +decimal total_amount
        +decimal shipping_fee
        +decimal final_amount
        +OrderStatus status
        +PaymentMethod payment_method
        +bool is_paid
        +string tracking_code
        +canTransitionTo(next) bool
        +isCancellable() bool
    }

    class OrderItem {
        +int id
        +string product_name
        +decimal price
        +int quantity
        +decimal subtotal
    }

    class Payment {
        +int id
        +decimal amount
        +PaymentStatus status
        +string payos_order_code
        +string payos_payment_link_id
    }

    class Escrow {
        +int id
        +decimal amount
        +EscrowStatus status
        +datetime released_at
        +isReleasable() bool
    }

    class Withdrawal {
        +int id
        +decimal amount
        +string bank_name
        +string bank_account
        +WithdrawalStatus status
    }

    class LedgerAccount {
        +bigint id
        +LedgerOwnerType owner_type
        +bigint owner_id
        +LedgerPurpose purpose
        +bigint balance
    }

    class LedgerTransaction {
        +bigint id
        +LedgerTxType type
        +string idempotency_key
        +string reference_type
        +bigint reference_id
    }

    class LedgerEntry {
        +bigint id
        +bigint amount
        +bigint balance_after
    }

    class Conversation {
        +int id
    }

    class Message {
        +int id
        +string content
        +bool is_read
    }

    class Review {
        +int id
        +int rating
        +string comment
    }

    class Address {
        +int id
        +string receiver_name
        +string phone
        +bool is_default
    }

    class Notification {
        +int id
        +string title
        +bool is_read
    }

    User "1" --> "0..*" Product : sells
    User "1" --> "0..*" Order : places
    User "1" --> "0..*" Cart : holds
    User "1" --> "0..*" Address : owns
    User "1" --> "0..*" Withdrawal : requests
    User "1" --> "0..*" Notification : receives
    User "1" --> "0..*" Review : writes

    Category "1" --> "0..*" Product : classifies
    Product "1" --> "0..*" OrderItem : appears in
    Product "1" --> "0..*" Review : receives

    Order "1" *-- "1..*" OrderItem : contains
    Order "1" --> "0..*" Payment : paid by
    Order "1" --> "1..*" Escrow : splits into

    Escrow "0..*" --> "1" User : holds for seller

    LedgerTransaction "1" *-- "2..*" LedgerEntry : balances to zero
    LedgerAccount "1" --> "0..*" LedgerEntry : records

    Conversation "1" *-- "0..*" Message : contains
    User "2" --> "0..*" Conversation : participates
```

**Vì sao `Order` có `1..*` Escrow chứ không phải `1`.** Một đơn có thể chứa hàng của
nhiều người bán khác nhau. `EscrowsService.createOrderEscrows()` gom `order_items`
theo `seller_id` rồi tạo **một escrow cho mỗi người bán** — xem
`escrows.service.ts:31-52`. Đây là điểm dễ bị hỏi và cũng là chỗ nhiều nhóm làm sai.

**Vì sao `LedgerTransaction` có `2..*` Entry.** Không thể có bút toán một chân. Tiền
phải đi *từ đâu đó* *tới đâu đó*, và tổng phải bằng không. Ràng buộc này được ép ở
`LedgerService.validateInput()` chứ không chỉ vẽ cho đẹp.

**Class Diagram khác ERD chỗ nào** — câu hỏi phản biện kinh điển:

| | ERD (sơ đồ #5, #6) | Class Diagram (sơ đồ này) |
|---|---|---|
| Mô tả | Bảng trong MySQL | Lớp trong mã nguồn TypeScript |
| Thành phần | Cột, kiểu dữ liệu, khoá chính/ngoại | Thuộc tính **và phương thức**, tầm nhìn `+`/`-` |
| Có gì mà bên kia không có | Index, ràng buộc `UNIQUE`, `ON DELETE` | Hành vi (`canTransitionTo`), lớp không có bảng (`LedgerService`) |
| Ví dụ cụ thể | `users.password VARCHAR(255)` | `User.password` để dấu `-` vì `select: false` |

---

## CD-02 — Money service layer

Sơ đồ này là thứ ERD **không thể** biểu diễn: các lớp có hành vi nhưng không có bảng
tương ứng. Nó cũng là chỗ thể hiện luật kiến trúc quan trọng nhất của dự án.

```mermaid
classDiagram
    direction TB

    class LedgerService {
        <<gateway>>
        -DataSource dataSource
        +post(input) LedgerTransaction
        +getBalance(ownerType, ownerId, purpose) bigint
        +getOrCreateAccount(ownerType, ownerId, purpose) LedgerAccount
        -validateInput(input) void
        -lockAccounts(em, ids) Map
        -isDuplicateKey(err) bool
    }

    class PostLedgerTxInput {
        <<interface>>
        +string idempotencyKey
        +LedgerTxType type
        +LedgerEntryInput[] entries
        +reference
        +metadata
    }

    class EscrowsService {
        +createOrderEscrows(orderId) Escrow[]
        +release(orderId) Escrow[]
        +refund(orderId) Escrow[]
        +getHeldBalance(sellerId) decimal
        +findBySeller(sellerId, page, limit) Page
    }

    class WalletsService {
        +getOrCreateWallet(userId) Wallet
        +getBalance(userId) decimal
        +topup(userId, amount, ref) WalletTransaction
        +deduct(userId, amount, ref) WalletTransaction
        +refund(userId, amount, ref) WalletTransaction
    }

    class WithdrawalsService {
        +create(userId, dto) Withdrawal
        +approve(id, adminId) Withdrawal
        +reject(id, adminId, note) Withdrawal
        +findAll(page, limit, status) Page
    }

    class PayosService {
        +createOrderPaymentLink(orderId, userId) Link
        +createWalletTopupLink(amount, userId) Link
        +handleWebhook(rawBody) void
        +refreshOrderStatus(orderId, userId) Status
        +cancelPaymentLink(code, userId) void
    }

    class ReconciliationJob {
        <<cron hourly>>
        +verifyGlobalSumIsZero() Report
        +verifyEachAccountMatchesEntries() Report
        +alertOnDrift(report) void
    }

    class SettingsService {
        +get(key) string
        +getPlatformFeePercent() decimal
    }

    LedgerService ..> PostLedgerTxInput : accepts
    EscrowsService ..> LedgerService : posts through
    WalletsService ..> LedgerService : posts through
    WithdrawalsService ..> LedgerService : posts through
    PayosService ..> LedgerService : posts through
    EscrowsService ..> SettingsService : reads fee
    ReconciliationJob ..> LedgerService : audits

    note for LedgerService "The ONLY class allowed to change a balance — enforced by eslint-plugin-boundaries"
    note for WalletsService "To be deleted in week 3 — balance becomes a read-only projection of ledger_accounts"
```

**Luật đọc từ sơ đồ này:** mọi mũi tên tiền đều **đi vào** `LedgerService`, không có
mũi tên nào đi ra. Không lớp nào được `UPDATE ledger_accounts.balance` trực tiếp, kể
cả các lớp trong cùng context `money`. Luật đó không nằm trong quy ước miệng — nó
được `eslint-plugin-boundaries` ép, và CI đỏ nếu ai vi phạm.

**`WalletsService` sẽ bị xoá.** Hiện nó là **nguồn sự thật thứ ba** cho số dư, bên
cạnh `users.balance` và `wallets.balance`. Ba nguồn sự thật cho cùng một con số là
lý do dự án phải làm ledger ngay từ đầu.

---

## CD-03 — Request pipeline

Đường đi của một request từ lúc chạm server đến lúc trả về. Sơ đồ này trả lời câu
"kiến trúc backend theo mô hình gì" bằng lớp thật, không bằng chữ.

```mermaid
classDiagram
    direction TB

    class JwtAuthGuard {
        <<guard>>
        +canActivate(ctx) bool
        -verifyToken(token) IUser
        -checkTokenVersion(user) bool
    }

    class RolesGuard {
        <<guard>>
        +canActivate(ctx) bool
        -matchRoles(required, userRole) bool
    }

    class ValidationPipe {
        <<pipe>>
        +transform(value, meta) any
    }

    class Controller {
        <<controller>>
        +handler(dto, user) Promise
    }

    class Service {
        <<service>>
        +businessMethod(dto, user) Promise
    }

    class Repository {
        <<typeorm>>
        +find(options) Entity[]
        +save(entity) Entity
        +createQueryBuilder(alias) QueryBuilder
    }

    class TransformInterceptor {
        <<interceptor>>
        +intercept(ctx, next) Observable
        -wrap(data) Envelope
    }

    class AllExceptionsFilter {
        <<filter>>
        +catch(exception, host) void
    }

    class Envelope {
        +int statusCode
        +string message
        +T data
    }

    JwtAuthGuard --> RolesGuard : then
    RolesGuard --> ValidationPipe : then
    ValidationPipe --> Controller : validated dto
    Controller --> Service : delegates
    Service --> Repository : queries
    Service --> Controller : returns plain object
    Controller --> TransformInterceptor : return value
    TransformInterceptor --> Envelope : wraps into
    AllExceptionsFilter ..> Envelope : errors use same shape

    note for Controller "Controllers hold no business logic — they validate, delegate, return"
    note for TransformInterceptor "Every response has the same shape — only sitemap.xml opts out via RawResponse"
```

**Vì sao Controller mỏng.** Ba client (web, Android, iOS) gọi cùng một `Service`.
Nếu logic nằm ở Controller thì mỗi lần thêm một cửa vào — ví dụ một cron job hay một
lệnh CLI — là chép lại logic. Đây cũng là lý do `LedgerService` gọi được từ webhook
PayOS, từ admin panel, và từ cron mà không cần đi qua HTTP.

---

## Cách xuất sơ đồ ra ảnh cho báo cáo

Thông báo capstone cấm chụp màn hình sơ đồ. Dùng script có sẵn:

```bash
npm run diagrams:export      # xuất SVG + PNG ra docs/system-design/exports/
npm run diagrams:check       # chỉ kiểm cú pháp, không ghi ảnh — dùng cho CI
```

Script đọc mọi khối ```` ```mermaid ```` trong `docs/system-design/*.md`, render bằng
`@mermaid-js/mermaid-cli` và ghi ra `docs/system-design/exports/<tên-file>/`.
SVG để chèn vào Word (nét ở mọi cỡ in), PNG 2x cho PowerPoint.

Chạy được script cũng có nghĩa **mọi sơ đồ trong repo hợp lệ về cú pháp** — khối nào
sai thì script in ra số dòng và trả mã thoát khác 0. Lần chạy gần nhất: **25 sơ đồ,
0 lỗi**.

Script cần Chrome. Nó tự dò các đường dẫn quen thuộc trên Windows/macOS/Linux; máy
nào để chỗ khác thì đặt `PUPPETEER_EXECUTABLE_PATH`.

> **Chưa nối vào CI.** Backend hiện chưa có `.github/workflows` nào. Khi B dựng CI
> ở tuần 3 thì thêm `npm run diagrams:check` vào job lint — lúc đó mới thật sự không
> ai merge được sơ đồ hỏng.
