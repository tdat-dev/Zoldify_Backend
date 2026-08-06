# Zoldify — Tập sơ đồ kiến trúc

**Ngày:** 06/08/2026
**Đi kèm:** [`2026-08-06-zoldify-scale-mobile-design.md`](./2026-08-06-zoldify-scale-mobile-design.md)

> Sơ đồ ở đây **minh hoạ** các quyết định đã lập luận trong design doc, không thay thế nó. Đọc design doc trước để biết *vì sao*; đọc file này để thấy *hình dạng*.

Toàn bộ viết bằng Mermaid — render trực tiếp trên GitHub, GitLab và VS Code (extension *Markdown Preview Mermaid Support*). Sửa được bằng text nên **diff review được trong Pull Request**, khác với ảnh PNG hay file draw.io.

Xuất ảnh cho báo cáo: dán vào [mermaid.live](https://mermaid.live) → Export PNG/SVG.

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
    buyer["Người mua<br/>(sinh viên)"]
    seller["Người bán<br/>(sinh viên)"]
    admin["Admin<br/>(vận hành)"]

    zoldify["<b>ZOLDIFY</b><br/>Marketplace đồ cũ<br/>có ví và ký quỹ"]

    payos["PayOS<br/>Cổng thanh toán"]
    sepay["SePay<br/>Đối soát chuyển khoản"]
    ghn["GHN<br/>Vận chuyển"]
    fcm["Firebase FCM<br/>Push notification"]
    r2["Cloudflare R2<br/>Lưu trữ ảnh"]
    smtp["Gmail SMTP<br/>Email"]
    bank["Ngân hàng<br/>Chi trả rút tiền"]

    buyer -->|"duyệt · mua · thanh toán · chat"| zoldify
    seller -->|"đăng bán · xử lý đơn · rút tiền"| zoldify
    admin -->|"duyệt rút tiền · đối soát"| zoldify

    zoldify -->|"tạo link thanh toán"| payos
    payos -->|"webhook xác nhận"| zoldify
    zoldify -->|"đối chiếu biến động số dư"| sepay
    zoldify -->|"tạo vận đơn · tra cứu"| ghn
    zoldify -->|"gửi thông báo"| fcm
    zoldify -->|"lưu và đọc ảnh"| r2
    zoldify -->|"email xác thực"| smtp
    admin -->|"chuyển khoản thủ công"| bank

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
    app["<b>Mobile</b><br/>React Native + Expo<br/>Android"]

    subgraph vps["VPS đơn — Docker Compose"]
        caddy["<b>Caddy</b><br/>TLS tự động + cân bằng tải"]

        subgraph apis["Tiến trình API — KHÔNG giữ trạng thái"]
            api1["API #1<br/>NestJS"]
            api2["API #2"]
            api3["API #3"]
        end

        worker["<b>Worker × 1</b><br/>BullMQ + Cron<br/>đối soát · email · dọn dẹp"]

        mysql[("<b>MySQL 8</b><br/>nguồn sự thật")]
        redis[("<b>Redis 7</b><br/>cache · throttle<br/>socket adapter · queue")]
    end

    r2["<b>Cloudflare R2</b><br/>ảnh sản phẩm"]

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
    web -.->|"đọc ảnh"| r2
    app -.->|"đọc ảnh"| r2

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

    userRepo[("bảng users")]
    ledger["LedgerService.post()"]

    escrow -.->|"❌ CẤM — eslint-plugin-boundaries chặn<br/>userRepository.increment('balance')"| userRepo
    escrow ==>|"✅ ĐÚNG<br/>1 transaction · có idempotency key · có ghi sổ"| ledger
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
        users["Người dùng"]
        gh["GitHub Actions"]
        cf["Cloudflare R2"]
    end

    subgraph vps["VPS — Ubuntu, Docker Compose"]
        direction TB
        caddy["caddy:2<br/>:80 :443<br/>TLS tự động"]

        api1["zoldify-api<br/>mem_limit 512M"]
        api2["zoldify-api<br/>mem_limit 512M"]
        api3["zoldify-api<br/>mem_limit 512M"]
        worker["zoldify-worker<br/>mem_limit 256M"]

        mysql[("mysql:8<br/>max_connections 200<br/>volume: mysql_data")]
        redis[("redis:7<br/>volume: redis_data")]

        cron["cron trên host<br/>mysqldump hằng ngày"]
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
    cron -->|"backup nén, giữ 14 ngày"| cf

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
    users ||--o{ ledger_accounts : "sở hữu nhiều tài khoản"
    ledger_accounts ||--o{ ledger_entries : "có nhiều bút toán"
    ledger_transactions ||--|{ ledger_entries : "gồm ≥2 bút toán, tổng = 0"
    orders ||--o{ escrows : "sinh ra"
    orders ||--o{ payments : "được trả bởi"
    users ||--o{ withdrawals : "yêu cầu"

    users {
        int id PK
        varchar email UK
        enum role
        decimal balance "❌ XOÁ — nguồn sự thật thứ hai"
    }

    ledger_accounts {
        bigint id PK
        enum owner_type "user | platform | external"
        bigint owner_id FK
        enum purpose "available | escrow_hold | withdrawal_pending | revenue | gateway_clearing | bank_external"
        bigint balance "ĐỒNG, không phải decimal"
        int version
    }

    ledger_transactions {
        bigint id PK
        varchar type
        varchar idempotency_key UK "🔒 lá chắn chống lặp"
        varchar reference_type "chuỗi rời — Money không phụ thuộc Ordering"
        bigint reference_id
        json metadata
    }

    ledger_entries {
        bigint id PK
        bigint transaction_id FK
        bigint account_id FK
        bigint amount "âm = ra, dương = vào"
        bigint balance_after
        timestamp created_at "APPEND-ONLY, không UPDATE/DELETE"
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
    users ||--o{ products : "bán"
    users ||--o{ orders : "đặt"
    users ||--o{ addresses : "có"
    categories ||--o{ products : "phân loại"
    products ||--o{ order_items : "xuất hiện trong"
    orders ||--|{ order_items : "gồm"
    orders ||--o{ escrows : "tách theo người bán"
    users ||--o{ carts : "giữ"
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
    gateway["gateway_clearing<br/><i>tiền từ PayOS</i>"]
    buyerAcc["buyer.available<br/><i>ví người mua</i>"]
    hold["escrow_hold<br/><i>Zoldify giữ hộ</i>"]
    sellerAcc["seller.available<br/><i>ví người bán</i>"]
    revenue["platform.revenue<br/><i>doanh thu Zoldify</i>"]
    pending["withdrawal_pending<br/><i>đang chờ chi</i>"]
    bank["bank_external<br/><i>đã ra khỏi hệ thống</i>"]

    gateway -->|"1 · nạp ví"| buyerAcc
    buyerAcc -->|"2 · đặt hàng"| hold
    hold -->|"3a · giao thành công (95%)"| sellerAcc
    hold -->|"3b · phí nền tảng (5%)"| revenue
    hold -->|"4 · huỷ đơn, hoàn tiền"| buyerAcc
    sellerAcc -->|"5 · admin duyệt rút"| pending
    pending -->|"6 · đã chuyển khoản"| bank

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
    actor B as Người mua
    participant APP as App / Web
    participant API as API (Ordering)
    participant L as LedgerService
    participant DB as MySQL
    participant P as PayOS

    B->>APP: Bấm "Đặt hàng"
    APP->>API: POST /api/v1/orders

    rect rgb(230, 240, 255)
        note over API,DB: MỘT transaction duy nhất
        API->>DB: Kiểm tồn kho, khoá sản phẩm
        API->>DB: INSERT orders + order_items
        API->>L: post(escrow_hold, key=order_create:123)
        L->>DB: buyer.available −500k · escrow_hold +500k
    end

    alt Ví đủ tiền
        API-->>APP: 201 · đã ký quỹ
        APP-->>B: Đặt hàng thành công
    else Ví không đủ
        API->>P: Tạo link thanh toán
        P-->>API: checkout_url
        API-->>APP: 201 · cần thanh toán
        APP->>B: Mở WebView PayOS
        B->>P: Chuyển khoản / quét QR
        P->>API: 🔔 Webhook (xem sơ đồ 9)
        B->>APP: deep link zoldify://payment/return
        APP->>API: GET /orders/123
        note right of APP: Chỉ để hiển thị.<br/>KHÔNG tin tham số<br/>trên URL để cộng tiền.
        API-->>APP: trạng thái thật từ DB
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
    API->>API: Xác minh chữ ký
    alt Chữ ký sai
        API-->>P: 200 (nuốt lặng, ghi log cảnh báo)
    end

    rect rgb(230, 255, 230)
        note over API,DB: MỘT transaction — đây chính là điểm sửa
        API->>L: post(key="payos:1234:link_abc")
        L->>DB: BEGIN
        L->>DB: INSERT ledger_transactions (idempotency_key UNIQUE)

        alt Key đã tồn tại (PayOS gửi lại)
            DB-->>L: ER_DUP_ENTRY
            L->>DB: ROLLBACK
            L-->>API: Trả về giao dịch cũ, không cộng thêm
        else Key mới
            L->>DB: SELECT ... FOR UPDATE (theo thứ tự account_id)
            L->>DB: INSERT entries: gateway −500k · buyer.available +500k
            L->>DB: UPDATE ledger_accounts.balance
            L->>DB: COMMIT
        end
    end

    API-->>P: 200 OK
```

### So sánh trước và sau

```mermaid
flowchart TB
    subgraph before["❌ HIỆN TẠI — payos.service.ts:328"]
        direction TB
        b1["INSERT webhook_log"] --> b2["💥 tiến trình chết ở đây"] --> b3["cộng tiền vào ví"]
        b4["PayOS gửi lại → log đã có → BỎ QUA<br/><b>Tiền người dùng đã trả nhưng không bao giờ vào ví</b>"]
    end

    subgraph after["✅ SAU KHI SỬA"]
        direction TB
        a1["BEGIN"] --> a2["INSERT ledger_transactions"] --> a3["💥 chết ở đây → tự động ROLLBACK"] --> a4["COMMIT"]
        a5["PayOS gửi lại → không có bản ghi nào → xử lý bình thường ✓"]
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
    actor B as Người mua
    participant API as API (Ordering)
    participant G as Guard phân quyền
    participant M as Money
    participant L as LedgerService
    participant N as Notifications

    B->>API: PATCH /orders/123/status → delivered

    rect rgb(255, 235, 235)
        API->>G: Người gọi có quyền không?
        note right of G: ⚠️ HIỆN TẠI KHÔNG CÓ BƯỚC NÀY.<br/>Ai xem được đơn cũng đặt được delivered<br/>→ tự nhả tiền cho chính mình.
        G-->>API: Chỉ người mua của đơn này,<br/>hoặc webhook GHN, hoặc admin
    end

    API->>M: releaseEscrows(orderId=123)

    loop mỗi escrow đang HOLDING
        M->>L: post(key="escrow_release:{id}")
        note right of L: Gọi lại 100 lần cũng chỉ<br/>có hiệu lực đúng 1 lần
        L->>L: escrow_hold −500k<br/>seller.available +475k<br/>platform.revenue +25k
        M->>M: escrow.status = RELEASED
    end

    M->>N: Thông báo cho người bán
    N-->>API: đã gửi push + email
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
    participant S1 as Màn hình A
    participant S2 as Màn hình B
    participant S3 as Màn hình C
    participant H as httpClient
    participant API as API

    par Mở app, 3 request bắn cùng lúc
        S1->>H: GET /products
    and
        S2->>H: GET /orders
    and
        S3->>H: GET /notifications
    end

    H->>API: 3 request kèm access token đã hết hạn
    API-->>H: 401 × 3

    rect rgb(255, 250, 220)
        note over H: SINGLE-FLIGHT: chỉ MỘT lần refresh
        H->>H: Đã có refresh đang chạy chưa?
        H->>API: POST /auth/refresh (đúng 1 lần)
        API-->>H: access token mới
        H->>H: Đánh thức 3 request đang xếp hàng
    end

    H->>API: Thử lại cả 3 với token mới
    API-->>H: 200 × 3
    H-->>S1: dữ liệu
    H-->>S2: dữ liệu
    H-->>S3: dữ liệu
```

Không có single-flight thì 3 request sẽ gọi 3 lần refresh. Backend có `token_version` nên lần refresh sau **vô hiệu hoá** token của lần trước — kết quả là người dùng bị đăng xuất đúng vào lúc mở app. Triệu chứng rất khó lần ra vì nó chỉ xảy ra khi nhiều request đồng thời.

---

## 12. State — Vòng đời đơn hàng

```mermaid
stateDiagram-v2
    [*] --> pending: người mua đặt hàng

    pending --> confirmed: người bán xác nhận
    pending --> cancelled: huỷ trước khi xác nhận

    confirmed --> processing: chuẩn bị hàng
    processing --> shipping: tạo vận đơn GHN
    shipping --> delivered: xác nhận đã nhận

    delivered --> [*]: 💰 GIẢI NGÂN escrow

    confirmed --> refunded: huỷ sau khi xác nhận
    processing --> refunded
    shipping --> refunded: giao thất bại

    refunded --> [*]: 💰 HOÀN TIỀN escrow
    cancelled --> [*]: 💰 HOÀN TIỀN escrow

    note right of delivered
        Ai được phép chuyển sang trạng thái này?
        Hiện tại: BẤT KỲ AI ← lỗ hổng
        Phải là: người mua của đơn
                 hoặc webhook GHN
                 hoặc admin
    end note
```

**Mỗi mũi tên dẫn tới `[*]` đều làm tiền chuyển động.** Đó là lý do phân quyền trên chuyển trạng thái là vấn đề bảo mật tài chính, không phải chuyện UX.

---

## 13. State — Vòng đời escrow

```mermaid
stateDiagram-v2
    [*] --> holding: đặt hàng, tiền vào giữ hộ

    holding --> released: đơn delivered
    holding --> refunded: đơn cancelled / refunded
    holding --> cancelled: đơn hết hạn thanh toán

    released --> [*]
    refunded --> [*]
    cancelled --> [*]

    note left of holding
        Số dư escrow_hold phải LUÔN khớp
        tài khoản ngân hàng thật.
        Job đối soát kiểm mỗi giờ.
    end note

    note right of released
        Trạng thái CUỐI. Không quay lại.
        Muốn đảo thì ghi giao dịch ngược,
        không sửa bản ghi cũ.
    end note
```

---

## 14. Use case tổng quát

Dành cho báo cáo đồ án.

```mermaid
flowchart LR
    buyer(("Người<br/>mua"))
    seller(("Người<br/>bán"))
    admin(("Admin"))
    payos(("PayOS"))
    ghn(("GHN"))

    subgraph sys["Hệ thống Zoldify"]
        uc1["Đăng ký / Đăng nhập"]
        uc2["Tìm kiếm sản phẩm"]
        uc3["Quản lý giỏ hàng"]
        uc4["Đặt hàng"]
        uc5["Nạp tiền vào ví"]
        uc6["Theo dõi đơn hàng"]
        uc7["Xác nhận đã nhận hàng"]
        uc8["Nhắn tin"]
        uc9["Đăng bán sản phẩm"]
        uc10["Quản lý đơn bán"]
        uc11["Tạo vận đơn"]
        uc12["Xem ví và giao dịch"]
        uc13["Yêu cầu rút tiền"]
        uc14["Duyệt rút tiền"]
        uc15["Đối soát sổ cái"]
        uc16["Quản lý người dùng"]
        uc17["Xử lý webhook thanh toán"]
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
    start(["Mở app"]) --> check{"Có token<br/>hợp lệ?"}
    check -->|không| auth
    check -->|có| tabs

    subgraph auth["(auth) — 4 màn"]
        login["đăng nhập"] --- register["đăng ký"]
        forgot["quên mật khẩu"] --- verify["xác thực email"]
    end

    auth --> tabs

    subgraph tabs["(tabs) — 5 màn"]
        home["🏠 trang chủ"]
        search["🔍 tìm kiếm"]
        myorders["📦 đơn mua"]
        chatlist["💬 chat"]
        profile["👤 hồ sơ"]
    end

    home --> product["chi tiết sản phẩm"]
    search --> product
    product --> shop["trang người bán"]
    product --> cart["🛒 giỏ hàng"]
    cart --> checkout["thanh toán"]
    checkout --> payos["WebView PayOS"]
    payos -.->|"deep link"| ret["payment/return"]
    ret --> orderDetail

    myorders --> orderDetail["chi tiết đơn"]
    orderDetail --> tracking["theo dõi GHN"]
    chatlist --> room["phòng chat"]

    profile --> sellerHub

    subgraph sellerHub["seller/ — 9 màn"]
        dash["tổng quan"]
        prods["sản phẩm của tôi"]
        newProd["đăng bán 📷"]
        editProd["sửa tin"]
        sorders["đơn bán"]
        sorderDetail["xử lý đơn"]
        wallet["💰 ví"]
        withdraw["rút tiền"]
        txns["lịch sử giao dịch"]
    end

    profile --> settings["cài đặt · địa chỉ"]

    style sellerHub fill:#fff4e0
    style payos fill:#f6d365
```

Khối màu cam là phần người bán — **đúng một nửa khối lượng công việc của app**, khớp với cảnh báo lúc chốt scope.

---

## 16. Luồng CI/CD

```mermaid
flowchart TB
    dev["Lập trình viên<br/>push nhánh feature"] --> pr["Mở Pull Request"]

    pr --> ci{"CI kiểm tra"}

    ci --> c1["lint + typecheck"]
    ci --> c2["eslint-plugin-boundaries<br/><i>chặn vi phạm ranh giới context</i>"]
    ci --> c3["test<br/><i>bắt buộc phủ module money</i>"]
    ci --> c4["build"]
    ci --> c5["sinh lại openapi.json<br/><i>khác bản đã commit → fail</i>"]

    c1 & c2 & c3 & c4 & c5 --> pass{"Tất cả xanh?"}
    pass -->|không| dev
    pass -->|có| review["Review bởi 1 người khác"]
    review --> merge["Merge vào develop"]

    merge --> main["Merge develop → main"]
    main --> build["Build Docker image → GHCR"]
    build --> deploy["SSH vào VPS<br/>compose pull && up -d"]
    deploy --> migrate["Chạy migration<br/><i>bước riêng, có đường lùi</i>"]
    migrate --> health{"/api/v1/health"}
    health -->|lỗi| rollback["Quay về image trước"]
    health -->|ok| done["✅ Xong"]

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
