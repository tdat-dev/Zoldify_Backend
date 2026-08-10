# Zoldify — Tập sơ đồ kiến trúc

**Ngày:** 06/08/2026
**Đi kèm:** [`2026-08-06-zoldify-scale-mobile-design.md`](./2026-08-06-zoldify-scale-mobile-design.md)

> Sơ đồ ở đây **minh hoạ** các quyết định đã lập luận trong design doc, không thay thế nó. Đọc design doc trước để biết *vì sao*; đọc file này để thấy *hình dạng*.

**Nhãn trong sơ đồ viết bằng tiếng Anh, chữ giải thích quanh sơ đồ để tiếng Việt.**
Báo cáo phải toàn tiếng Anh nên nhãn dịch sẵn; phần chữ là để nhóm đọc, không đi vào
báo cáo. Cùng quy ước với `2026-08-08-activity-class-diagrams.md`.

Toàn bộ viết bằng Mermaid — render trực tiếp trên GitHub, GitLab và VS Code (extension *Markdown Preview Mermaid Support*). Sửa được bằng text nên **diff review được trong Pull Request**, khác với ảnh PNG hay file draw.io.

Xuất ảnh và file nguồn:

```bash
npm run diagrams:export     # SVG + PNG 2x + .mmd cho từng sơ đồ
```

Báo cáo yêu cầu sơ đồ vẽ bằng **draw.io**. File `.mmd` sinh ra là để dán vào
draw.io theo đường **+ (Insert) → Advanced → Mermaid…**, nó dựng lại thành hình khối
sửa được.

---

## Mục lục

**Kiến trúc**
1. [C4 mức 1 — Bối cảnh hệ thống](#1-c4-mức-1--bối-cảnh-hệ-thống)
2. [C4 mức 2 — Container](#2-c4-mức-2--container)
3. [C4 mức 3 — Bounded context & luật phụ thuộc](#3-c4-mức-3--bounded-context--luật-phụ-thuộc)
4. [Sơ đồ triển khai](#4-sơ-đồ-triển-khai)

**Dữ liệu**

5. [ERD — lõi tiền](#5-erd--lõi-tiền)
6. [ERD — catalog & đơn hàng](#6-erd--catalog--đơn-hàng)
7. [Sơ đồ dòng tiền (T-account)](#7-sơ-đồ-dòng-tiền-t-account)

**Hành vi**

8. [Sequence — Đặt hàng, thanh toán, ký quỹ](#8-sequence--đặt-hàng-thanh-toán-ký-quỹ)
9. [Sequence — Webhook PayOS chống lặp](#9-sequence--webhook-payos-chống-lặp)
10. [Sequence — Giải ngân escrow](#10-sequence--giải-ngân-escrow)
11. [Sequence — Refresh token single-flight](#11-sequence--refresh-token-single-flight)
12. [State — Vòng đời đơn hàng](#12-state--vòng-đời-đơn-hàng)
13. [State — Vòng đời escrow](#13-state--vòng-đời-escrow)

**Cho báo cáo đồ án**

14. [Use case tổng quát](#14-use-case-tổng-quát)
15. [Sơ đồ điều hướng app](#15-sơ-đồ-điều-hướng-app)
16. [Luồng CI/CD](#16-luồng-cicd)

---

## 1. C4 mức 1 — Bối cảnh hệ thống

Zoldify nhìn từ bên ngoài: ai dùng, và nó phụ thuộc dịch vụ nào.

```mermaid
flowchart TB
    buyer["Buyer<br/>(student)"]
    seller["Seller<br/>(student)"]
    admin["Admin<br/>(operations)"]

    zoldify["<b>ZOLDIFY</b><br/>Second-hand marketplace<br/>with wallet and escrow"]

    payos["PayOS<br/>Payment gateway"]
    sepay["SePay<br/>Bank transfer reconciliation"]
    ghn["GHN<br/>Shipping"]
    fcm["Firebase FCM<br/>Push notifications"]
    r2["Cloudflare R2<br/>Image storage"]
    smtp["Gmail SMTP<br/>Email"]
    bank["Bank<br/>Withdrawal payouts"]

    buyer -->|"browse · buy · pay · chat"| zoldify
    seller -->|"list items · fulfil orders · withdraw"| zoldify
    admin -->|"approve withdrawals · reconcile"| zoldify

    zoldify -->|"create payment link"| payos
    payos -->|"confirmation webhook"| zoldify
    zoldify -->|"match incoming transfers"| sepay
    zoldify -->|"create and track shipments"| ghn
    zoldify -->|"send notifications"| fcm
    zoldify -->|"store and read images"| r2
    zoldify -->|"verification email"| smtp
    admin -->|"manual bank transfer"| bank

    style zoldify fill:#2C67C8,color:#fff
    style payos fill:#f6d365
    style bank fill:#f6d365
```

**Điểm cần chú ý:** khâu chi trả rút tiền hiện là **thủ công** — admin tự chuyển khoản rồi đánh dấu hoàn tất. Đây là thiết kế có chủ đích ở quy mô này (API chi hộ của ngân hàng cần pháp nhân và thẩm định), nhưng ledger phải mô hình hoá đúng nó bằng hai bước: `duyệt` rồi mới `đã chuyển khoản`. Xem sơ đồ 7.

---

## 2. C4 mức 2 — Container

Bên trong Zoldify có những tiến trình nào, chạy ở đâu, nói chuyện với nhau ra sao.

```mermaid
flowchart TB
    web["<b>Web</b><br/>Next.js 14 App Router<br/>SSR"]
    app["<b>Mobile</b><br/>React Native + Expo<br/>Android and iOS"]

    subgraph vps["Single VPS — Docker Compose"]
        caddy["<b>Caddy</b><br/>Automatic TLS + load balancing"]

        subgraph apis["API processes — STATELESS"]
            api1["API #1<br/>NestJS"]
            api2["API #2"]
            api3["API #3"]
        end

        worker["<b>Worker × 1</b><br/>BullMQ + Cron<br/>reconciliation · email · cleanup"]

        mysql[("<b>MySQL 8</b><br/>source of truth")]
        redis[("<b>Redis 7</b><br/>cache · throttle<br/>socket adapter · queue")]
    end

    r2["<b>Cloudflare R2</b><br/>product images"]

    web -->|"HTTPS /api/v1"| caddy
    app -->|"HTTPS /api/v1"| caddy
    app -.->|"WebSocket /chat"| caddy

    caddy --> api1
    caddy --> api2
    caddy --> api3

    api1 --> mysql
    api2 --> mysql
    api3 --> mysql
    api1 --> redis
    api2 --> redis
    api3 --> redis

    worker --> mysql
    worker --> redis

    api1 -.->|"upload"| r2
    web -.->|"read images"| r2
    app -.->|"read images"| r2

    style redis fill:#dc382d,color:#fff
    style mysql fill:#00758f,color:#fff
    style worker fill:#7b68ee,color:#fff
```

**Ba điều sơ đồ này nói ra:**

- **API không giữ trạng thái** → nhân bao nhiêu bản cũng được. Mọi thứ từng nằm trong RAM tiến trình (cache, bộ đếm rate limit, danh sách socket) đã dời vào Redis.
- **Worker chỉ có đúng 1 bản.** Cron nằm trong API thì 3 tiến trình sẽ chạy job đối soát 3 lần — với job đụng tiền, đó là lỗi nghiêm trọng.
- **Ảnh không nằm trên đĩa VPS.** Đó là điều kiện tiên quyết để nhân bản API, và cũng để redeploy không mất dữ liệu.

---

## 3. C4 mức 3 — Bounded context & luật phụ thuộc

```mermaid
flowchart TB
    ops["<b>Ops</b><br/>admin · settings · tasks"]
    ordering["<b>Ordering</b><br/>carts · orders · ghn"]
    catalog["<b>Catalog</b><br/>products · categories · shop<br/>files · interactions · follows"]
    money["<b>💰 Money</b><br/>ledger · wallets · escrows<br/>payments · payos · sepay · withdrawals"]
    messaging["<b>Messaging</b><br/>chat · notifications · firebase"]
    identity["<b>Identity</b><br/>auth · users · addresses"]

    ops --> ordering
    ops --> money
    ops --> catalog

    ordering --> catalog
    ordering --> money
    ordering --> identity

    catalog --> identity
    messaging --> identity
    money --> identity

    style money fill:#2C67C8,color:#fff
    style identity fill:#e8e8e8
```

Đọc sơ đồ: mũi tên đi **xuống dưới**. `Identity` là nền, không phụ thuộc ai. `Money` chỉ phụ thuộc `Identity`.

### Vì sao Money KHÔNG trỏ tới Ordering

Đây là quyết định quan trọng nhất của sơ đồ này. `EscrowsService` hiện tại đang `inject Repository<Order>` để tự đi đọc đơn hàng và tự tính tiền cho từng người bán.

Trong thiết kế mới, chiều phụ thuộc **đảo lại**: `Ordering` tính xong số tiền rồi *gọi* `Money`, truyền vào số tiền và một tham chiếu (`reference_type='order'`, `reference_id=123`). Với `Money`, tham chiếu đó chỉ là một chuỗi ký tự vô nghĩa — nó không cần biết "đơn hàng" là gì.

Nhờ vậy `Money` trở thành context **tách ra thành service riêng dễ nhất** khi cần (§3.6 của design doc).

### Luật được máy ép tuân thủ

```mermaid
flowchart LR
    escrow["escrows.service.ts"]

    userRepo[("users table")]
    ledger["LedgerService.post()"]

    escrow -.->|"FORBIDDEN — blocked by eslint-plugin-boundaries<br/>userRepository.increment('balance')"| userRepo
    escrow ==>|"CORRECT<br/>one transaction · idempotency key · audit trail"| ledger
    ledger --> userRepo

    style escrow fill:#ffe0e0
    style ledger fill:#d4f8d4
```

Đường đứt nét màu đỏ chính là dòng `escrows.service.ts:68` đang tồn tại hôm nay — nguồn gốc của việc số dư phân kỳ.

---

## 4. Sơ đồ triển khai

```mermaid
flowchart TB
    subgraph internet["Internet"]
        users["Users"]
        gh["GitHub Actions"]
        cf["Cloudflare R2"]
    end

    subgraph vps["VPS — Ubuntu, Docker Compose"]
        direction TB
        caddy["caddy:2<br/>:80 :443<br/>automatic TLS"]

        api1["zoldify-api<br/>mem_limit 512M"]
        api2["zoldify-api<br/>mem_limit 512M"]
        api3["zoldify-api<br/>mem_limit 512M"]
        worker["zoldify-worker<br/>mem_limit 256M"]

        mysql[("mysql:8<br/>max_connections 200<br/>volume: mysql_data")]
        redis[("redis:7<br/>volume: redis_data")]

        cron["cron on host<br/>daily mysqldump"]
    end

    users -->|"HTTPS"| caddy
    caddy --> api1
    caddy --> api2
    caddy --> api3

    api1 --> mysql
    api2 --> mysql
    api3 --> mysql
    api1 --> redis
    api2 --> redis
    api3 --> redis
    worker --> mysql
    worker --> redis

    gh -->|"SSH: compose pull && up -d"| vps
    api1 -.-> cf
    cron -->|"compressed backup, 14-day retention"| cf

    style caddy fill:#1f88c0,color:#fff
```

**Tính toán kết nối** — cái bẫy sẽ nổ đúng lúc demo nếu bỏ qua:

| | Hiện tại | Sau khi sửa |
|---|---|---|
| `connectionLimit` mỗi tiến trình | 50 | **15** |
| × 3 API + 1 worker | 200 | 60 |
| `max_connections` của MySQL | 151 *(mặc định)* | **200** |
| Kết quả | 🔴 **Vượt ngưỡng → sập** | 🟢 Còn dư |

---

## 5. ERD — lõi tiền

```mermaid
erDiagram
    users ||--o{ ledger_accounts : "owns several accounts"
    ledger_accounts ||--o{ ledger_entries : "records many entries"
    ledger_transactions ||--|{ ledger_entries : "holds 2 or more entries summing to zero"
    orders ||--o{ escrows : "splits into"
    orders ||--o{ payments : "is paid by"
    users ||--o{ withdrawals : "requests"

    users {
        int id PK
        varchar email UK
        enum role
        decimal balance "TO BE DROPPED — second source of truth"
    }

    ledger_accounts {
        bigint id PK
        enum owner_type "user | platform | external"
        bigint owner_id FK
        enum purpose "available | escrow_hold | withdrawal_pending | revenue | gateway_clearing | bank_external"
        bigint balance "dong as BIGINT, not decimal"
        int version
    }

    ledger_transactions {
        bigint id PK
        varchar type
        varchar idempotency_key UK "the guard against double processing"
        varchar reference_type "free string — Money does not depend on Ordering"
        bigint reference_id
        json metadata
    }

    ledger_entries {
        bigint id PK
        bigint transaction_id FK
        bigint account_id FK
        bigint amount "negative = out, positive = in"
        bigint balance_after
        timestamp created_at "APPEND-ONLY, never UPDATE or DELETE"
    }

    escrows {
        int id PK
        int order_id FK
        int buyer_id FK
        int seller_id FK
        bigint amount
        enum status "holding | released | refunded | cancelled"
    }

    payments {
        int id PK
        int order_id FK
        bigint amount
        varchar payos_order_code
        enum status
    }

    withdrawals {
        int id PK
        int user_id FK
        bigint amount
        varchar bank_account
        enum status "pending | approved | rejected | completed"
    }
```

**Ba điều ERD này ép buộc:**

1. `ledger_entries` là **append-only**. Không có cột nào cho phép sửa. Muốn đảo một giao dịch thì ghi giao dịch ngược lại — lịch sử không bao giờ mất.
2. `idempotency_key` là `UNIQUE` ở tầng database, không phải ở tầng code. Code có thể quên kiểm tra; database thì không.
3. `users.balance` bị xoá. Còn tồn tại là còn có người ghi vào.

---

## 6. ERD — catalog & đơn hàng

```mermaid
erDiagram
    users ||--o{ products : "sells"
    users ||--o{ orders : "places"
    users ||--o{ addresses : "has"
    categories ||--o{ products : "classifies"
    products ||--o{ order_items : "appears in"
    orders ||--|{ order_items : "contains"
    orders ||--o{ escrows : "splits per seller"
    users ||--o{ carts : "holds"
    products ||--o{ carts : ""

    products {
        int id PK
        int seller_id FK
        int category_id FK
        varchar title
        bigint price
        int quantity
        varchar status
    }

    orders {
        int id PK
        varchar order_code UK
        int user_id FK
        bigint total_amount
        bigint shipping_fee
        bigint final_amount
        enum status
        tinyint is_paid
        varchar tracking_code
        int ghn_district_id
    }

    order_items {
        int id PK
        int order_id FK
        int product_id FK
        int quantity
        bigint subtotal
    }
```

**Vì sao một đơn sinh ra nhiều escrow:** giỏ hàng có thể chứa sản phẩm của nhiều người bán khác nhau. Người mua trả **một lần**, nhưng tiền phải được giữ hộ và giải ngân **riêng cho từng người bán** — người bán A giao xong thì nhận tiền của mình, không phải chờ người bán B.

---

## 7. Sơ đồ dòng tiền (T-account)

Từng đồng đi qua Zoldify di chuyển theo đúng sơ đồ này. Không có đường nào khác.

```mermaid
flowchart LR
    gateway["gateway_clearing<br/><i>money arriving from PayOS</i>"]
    buyerAcc["buyer.available<br/><i>buyer wallet</i>"]
    hold["escrow_hold<br/><i>held by Zoldify</i>"]
    sellerAcc["seller.available<br/><i>seller wallet</i>"]
    revenue["platform.revenue<br/><i>Zoldify revenue</i>"]
    pending["withdrawal_pending<br/><i>awaiting payout</i>"]
    bank["bank_external<br/><i>left the system</i>"]

    gateway -->|"1 · wallet top-up"| buyerAcc
    buyerAcc -->|"2 · place order"| hold
    hold -->|"3a · delivered (95%)"| sellerAcc
    hold -->|"3b · platform fee (5%)"| revenue
    hold -->|"4 · order cancelled, refund"| buyerAcc
    sellerAcc -->|"5 · admin approves withdrawal"| pending
    pending -->|"6 · bank transfer completed"| bank

    style hold fill:#ffd700
    style revenue fill:#90ee90
    style bank fill:#e8e8e8
```

**Ô vàng `escrow_hold` là ô quan trọng nhất trong toàn hệ thống.** Số dư của nó phải luôn khớp với số tiền thật đang nằm trong tài khoản ngân hàng của Zoldify. Đây là câu hỏi đầu tiên mà bất kỳ bên kiểm toán, nhà đầu tư, hay đối tác thanh toán nào cũng sẽ hỏi:

> *"Các bạn đang giữ hộ người dùng bao nhiêu tiền, và chứng minh bằng cách nào?"*

Kiến trúc hiện tại **không trả lời được câu này**. Kiến trúc mới trả lời bằng một câu truy vấn duy nhất.

Lưu ý bước 5 và 6 tách rời: khoảng giữa hai bước là lúc admin đang thao tác chuyển khoản thủ công ở ngân hàng. Tiền đã rời ví người bán nhưng chưa ra khỏi hệ thống — phải có một tài khoản riêng cho trạng thái đó, nếu không sẽ không đối soát được.

---

## 8. Sequence — Đặt hàng, thanh toán, ký quỹ

```mermaid
sequenceDiagram
    autonumber
    actor B as Buyer
    participant APP as App / Web
    participant API as API (Ordering)
    participant L as LedgerService
    participant DB as MySQL
    participant P as PayOS

    B->>APP: Press "Place order"
    APP->>API: POST /api/v1/orders

    rect rgb(230, 240, 255)
        note over API,DB: ONE single transaction
        API->>DB: Check stock, lock product rows
        API->>DB: INSERT orders + order_items
        API->>L: post(escrow_hold, key=order_create:123)
        L->>DB: buyer.available -500k · escrow_hold +500k
    end

    alt Wallet has enough balance
        API-->>APP: 201 · escrow opened
        APP-->>B: Order placed
    else Wallet short of funds
        API->>P: Create payment link
        P-->>API: checkout_url
        API-->>APP: 201 · payment required
        APP->>B: Open PayOS WebView
        B->>P: Bank transfer / scan QR
        P->>API: Webhook (see diagram 9)
        B->>APP: deep link zoldify://payment/return
        APP->>API: GET /orders/123
        note right of APP: Display only.<br/>NEVER trust URL parameters<br/>to credit money.
        API-->>APP: real status from the database
    end
```

**Bước 9 là chỗ dễ sai nhất khi làm app.** Deep link quay về là do *trình duyệt* gọi, mà URL thì người dùng sửa được. Nếu app tin vào tham số trên URL để coi như đã thanh toán, ai cũng có thể tự "thanh toán" bằng cách gõ tay một địa chỉ. Deep link **chỉ được phép điều hướng giao diện**; nguồn sự thật duy nhất là webhook đi thẳng từ PayOS vào backend.

---

## 9. Sequence — Webhook PayOS chống lặp

Đây là sơ đồ vá lỗi **L4** trong design doc.

```mermaid
sequenceDiagram
    autonumber
    participant P as PayOS
    participant API as API (Money)
    participant L as LedgerService
    participant DB as MySQL

    P->>API: POST /api/v1/payos/webhook
    API->>API: Verify signature
    alt Invalid signature
        API-->>P: Reject, write a warning to the log
    end

    rect rgb(230, 255, 230)
        note over API,DB: ONE transaction — this is the fix
        API->>L: post(key="payos:1234:link_abc")
        L->>DB: BEGIN
        L->>DB: SELECT ledger_transactions WHERE idempotency_key

        alt Key already exists (PayOS resent)
            DB-->>L: row found
            L-->>API: Return the existing transaction, credit nothing
        else New key
            L->>DB: INSERT ledger_transactions (idempotency_key UNIQUE)
            L->>DB: SELECT ... FOR UPDATE (ordered by account_id)
            L->>DB: INSERT entries: gateway -500k · escrow_hold +500k
            L->>DB: UPDATE ledger_accounts.balance
            L->>DB: UPDATE orders SET is_paid, status
            L->>DB: INSERT escrows (one row per seller)
            L->>DB: COMMIT
        end
    end

    API-->>P: 200 OK
```

### So sánh trước và sau

```mermaid
flowchart TB
    subgraph before["BEFORE — five separate saves"]
        direction TB
        b1["INSERT webhook_log — commits immediately"] --> b2["process dies here"] --> b3["credit the wallet"]
        b4["PayOS resends, the log row exists, so it is SKIPPED<br/><b>The customer paid but the money never arrives</b>"]
    end

    subgraph after["AFTER — one transaction"]
        direction TB
        a1["BEGIN"] --> a2["INSERT ledger_transactions"] --> a3["process dies here, automatic ROLLBACK"] --> a4["COMMIT"]
        a5["PayOS resends, no record exists, processed normally"]
    end

    style before fill:#ffe0e0
    style after fill:#d4f8d4
```

Điểm mấu chốt: bản ghi chống lặp và việc cộng tiền phải **chung một số phận**. Hoặc cả hai cùng tồn tại, hoặc cả hai cùng không. Ở giữa là chỗ tiền biến mất.

---

## 10. Sequence — Giải ngân escrow

```mermaid
sequenceDiagram
    autonumber
    actor B as Buyer
    participant API as API (Ordering)
    participant G as Authorization policy
    participant M as Money
    participant L as LedgerService
    participant N as Notifications

    B->>API: PATCH /orders/123/status to delivered

    rect rgb(230, 255, 230)
        API->>G: Is the caller allowed to do this?
        note right of G: order-status.policy.ts<br/>Whoever gains must not press the button:<br/>the seller cannot set delivered,<br/>the buyer cannot set refunded.
        G-->>API: Buyer of this order, GHN webhook, or admin<br/>and only from status shipping
    end

    API->>M: releaseEscrows(orderId=123)

    loop each escrow still HOLDING
        M->>L: post(key="escrow_release:{id}")
        note right of L: Calling it 100 times<br/>takes effect exactly once
        L->>L: escrow_hold -500k<br/>seller.available +475k<br/>platform.revenue +25k
        M->>M: escrow.status = RELEASED
    end

    M->>N: Notify the seller
    N-->>API: push and email sent
    API-->>B: 200 OK
```

Sơ đồ này gom **hai lỗ hổng** vào một hình:

- **Ô đỏ** — thiếu kiểm tra phân quyền. Đây là card *"tiền kẹt trong escrow"* đã có sẵn trên board: `PATCH /orders/:id/status` không kiểm vai trò, nên bất kỳ ai xem được đơn cũng có thể đặt trạng thái `delivered` và tự giải ngân tiền về ví mình.
- **Vòng lặp** — hiện tại đọc rồi ghi mà không khoá, hai request đồng thời sẽ giải ngân hai lần. Khoá idempotency giết luôn khả năng này.

---

## 11. Sequence — Refresh token single-flight

Không có phần này thì app đăng xuất người dùng mỗi 15 phút.

```mermaid
sequenceDiagram
    autonumber
    participant S1 as Screen A
    participant S2 as Screen B
    participant S3 as Screen C
    participant H as httpClient
    participant API as API

    par App opens, three requests fire at once
        S1->>H: GET /products
    and
        S2->>H: GET /orders
    and
        S3->>H: GET /notifications
    end

    H->>API: Three requests with an expired access token
    API-->>H: 401 three times

    rect rgb(255, 250, 220)
        note over H: SINGLE-FLIGHT: refresh only ONCE
        H->>H: Is a refresh already in progress?
        H->>API: POST /auth/refresh (exactly once)
        API-->>H: new access token
        H->>H: Wake the three queued requests
    end

    H->>API: Retry all three with the new token
    API-->>H: 200 three times
    H-->>S1: data
    H-->>S2: data
    H-->>S3: data
```

Không có single-flight thì 3 request sẽ gọi 3 lần refresh. Backend có `token_version` nên lần refresh sau **vô hiệu hoá** token của lần trước — kết quả là người dùng bị đăng xuất đúng vào lúc mở app. Triệu chứng rất khó lần ra vì nó chỉ xảy ra khi nhiều request đồng thời.

---

## 12. State — Vòng đời đơn hàng

```mermaid
stateDiagram-v2
    [*] --> pending: buyer places the order

    pending --> confirmed: seller accepts
    pending --> cancelled: cancelled before acceptance

    confirmed --> processing: preparing the goods
    processing --> shipping: GHN shipment created
    shipping --> delivered: receipt confirmed

    delivered --> [*]: RELEASE escrow

    confirmed --> refunded: cancelled after acceptance
    processing --> refunded
    shipping --> refunded: delivery failed

    refunded --> [*]: REFUND escrow
    cancelled --> [*]: REFUND escrow

    note right of delivered
        Who may move an order here?
        Only the buyer of this order,
        the GHN webhook, or an admin,
        and only from status shipping.
        Enforced by order-status.policy.ts
    end note
```

**Mỗi mũi tên dẫn tới `[*]` đều làm tiền chuyển động.** Đó là lý do phân quyền trên chuyển trạng thái là vấn đề bảo mật tài chính, không phải chuyện UX.

---

## 13. State — Vòng đời escrow

```mermaid
stateDiagram-v2
    [*] --> holding: order paid, money held

    holding --> released: order delivered
    holding --> refunded: order cancelled or refunded
    holding --> cancelled: payment window expired

    released --> [*]
    refunded --> [*]
    cancelled --> [*]

    note left of holding
        The escrow_hold balance must ALWAYS
        match the real bank account.
        A reconciliation job checks it hourly.
    end note

    note right of released
        TERMINAL state. No way back.
        To reverse it, post an opposite
        transaction; never edit the old row.
    end note
```

---

## 14. Use case tổng quát

Dành cho báo cáo đồ án.

```mermaid
flowchart LR
    buyer(("Buyer"))
    seller(("Seller"))
    admin(("Admin"))
    payos(("PayOS"))
    ghn(("GHN"))

    subgraph sys["Zoldify system"]
        uc1["Register / Log in"]
        uc2["Search products"]
        uc3["Manage cart"]
        uc4["Place order"]
        uc5["Top up wallet"]
        uc6["Track order"]
        uc7["Confirm delivery received"]
        uc8["Send messages"]
        uc9["List an item for sale"]
        uc10["Manage sales orders"]
        uc11["Create shipment"]
        uc12["View wallet and transactions"]
        uc13["Request withdrawal"]
        uc14["Approve withdrawal"]
        uc15["Reconcile the ledger"]
        uc16["Manage users"]
        uc17["Process payment webhook"]
    end

    buyer --- uc1
    buyer --- uc2
    buyer --- uc3
    buyer --- uc4
    buyer --- uc5
    buyer --- uc6
    buyer --- uc7
    buyer --- uc8

    seller --- uc1
    seller --- uc8
    seller --- uc9
    seller --- uc10
    seller --- uc11
    seller --- uc12
    seller --- uc13

    admin --- uc14
    admin --- uc15
    admin --- uc16

    payos --- uc17
    ghn --- uc11
```

---

## 15. Sơ đồ điều hướng app

28 màn, nhóm theo Expo Router.

```mermaid
flowchart TB
    start(["App launch"]) --> check{"Valid token?"}
    check -->|no| auth
    check -->|yes| tabs

    subgraph auth["(auth) — 4 screens"]
        login["log in"] --- register["register"]
        forgot["forgot password"] --- verify["verify email"]
    end

    auth --> tabs

    subgraph tabs["(tabs) — 5 screens"]
        home["home"]
        search["search"]
        myorders["my orders"]
        chatlist["chat"]
        profile["profile"]
    end

    home --> product["product detail"]
    search --> product
    product --> shop["seller shop page"]
    product --> cart["cart"]
    cart --> checkout["checkout"]
    checkout --> payos["PayOS WebView"]
    payos -.->|"deep link"| ret["payment/return"]
    ret --> orderDetail

    myorders --> orderDetail["order detail"]
    orderDetail --> tracking["GHN tracking"]
    chatlist --> room["chat room"]

    profile --> sellerHub

    subgraph sellerHub["seller/ — 9 screens"]
        dash["dashboard"]
        prods["my products"]
        newProd["list an item"]
        editProd["edit listing"]
        sorders["sales orders"]
        sorderDetail["fulfil order"]
        wallet["wallet"]
        withdraw["withdraw"]
        txns["transaction history"]
    end

    profile --> settings["settings and addresses"]

    style sellerHub fill:#fff4e0
    style payos fill:#f6d365
```

Khối màu cam là phần người bán — **đúng một nửa khối lượng công việc của app**, khớp với cảnh báo lúc chốt scope.

---

## 16. Luồng CI/CD

```mermaid
flowchart TB
    dev["Developer<br/>pushes a feature branch"] --> pr["Open Pull Request"]

    pr --> ci{"CI checks"}

    ci --> c1["lint + typecheck"]
    ci --> c2["eslint-plugin-boundaries<br/><i>blocks context boundary violations</i>"]
    ci --> c3["test<br/><i>money module must be covered</i>"]
    ci --> c4["build"]
    ci --> c5["regenerate openapi.json<br/><i>differs from the commit, fail</i>"]

    c1 & c2 & c3 & c4 & c5 --> pass{"All green?"}
    pass -->|no| dev
    pass -->|yes| review["Reviewed by another member"]
    review --> merge["Merge into develop"]

    merge --> main["Merge develop into main"]
    main --> build["Build Docker image, push to GHCR"]
    build --> deploy["SSH to the VPS<br/>compose pull and up -d"]
    deploy --> migrate["Run migrations<br/><i>separate step with a rollback path</i>"]
    migrate --> health{"/api/v1/health"}
    health -->|fails| rollback["Roll back to the previous image"]
    health -->|ok| done["Done"]

    style c2 fill:#ffe8cc
    style c5 fill:#ffe8cc
    style rollback fill:#ffe0e0
```

Hai ô cam là hai cổng kiểm tra tự động đặc thù của kiến trúc này:

- **`eslint-plugin-boundaries`** biến luật ranh giới context từ một thoả thuận miệng thành một điều kiện chặn merge. Không có nó, luật sẽ bị phá trong vòng hai tuần.
- **Kiểm `openapi.json`** đảm bảo web và mobile không bao giờ code dựa trên một hợp đồng đã lỗi thời.

---

## Phụ lục — Sơ đồ nào cần cho báo cáo đồ án

| Sơ đồ | Chương báo cáo | Bắt buộc |
|---|---|---|
| 14 · Use case | Phân tích yêu cầu | ✅ |
| 5, 6 · ERD | Thiết kế cơ sở dữ liệu | ✅ |
| 8, 9, 10 · Sequence | Thiết kế chi tiết | ✅ |
| 12, 13 · State | Thiết kế chi tiết | ✅ |
| 1, 2, 3 · C4 | Kiến trúc hệ thống | ✅ |
| 4 · Triển khai | Cài đặt & triển khai | ✅ |
| 7 · Dòng tiền | Nghiệp vụ cốt lõi | ⭐ điểm nhấn |
| 15 · Điều hướng app | Thiết kế giao diện | nên có |
| 16 · CI/CD | Quy trình phát triển | nên có |

Sơ đồ 7 là thứ đáng đưa lên đầu khi bảo vệ: hầu như không đồ án nào ở mức này mô hình hoá dòng tiền tử tế, và nó chứng minh nhóm hiểu bài toán chứ không chỉ ghép API.
