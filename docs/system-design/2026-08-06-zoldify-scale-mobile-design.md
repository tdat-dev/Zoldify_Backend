# Zoldify — System Design: Scale nền tảng & mở rộng sang Mobile App

**Ngày:** 06/08/2026
**Deadline:** ~21/09/2026 (6 tuần)
**Trạng thái:** Bản thiết kế chờ duyệt

---

## Mục lục

- [0. Tóm tắt cho người bận](#0-tóm-tắt-cho-người-bận)
- [1. Hiện trạng — có bằng chứng](#1-hiện-trạng--có-bằng-chứng)
- [2. Ràng buộc & quyết định đã chốt](#2-ràng-buộc--quyết-định-đã-chốt)
- [3. Phần 1 — Ranh giới module](#3-phần-1--ranh-giới-module)
- [4. Phần 2 — Ledger: lõi tiền](#4-phần-2--ledger-lõi-tiền)
- [5. Phần 3 — Hợp đồng API](#5-phần-3--hợp-đồng-api)
- [6. Phần 4 — Kiến trúc App React Native](#6-phần-4--kiến-trúc-app-react-native)
- [7. Phần 5 — Hạ tầng & triển khai](#7-phần-5--hạ-tầng--triển-khai)
- [8. Phần 6 — Kiểm thử, quan sát, Definition of Done](#8-phần-6--kiểm-thử-quan-sát-definition-of-done)
- [9. Phân rã task A-Z theo tuần & theo người](#9-phân-rã-task-a-z-theo-tuần--theo-người)
- [10. Rủi ro & thứ tự cắt scope](#10-rủi-ro--thứ-tự-cắt-scope)
- [11. Phụ lục](#11-phụ-lục)

---

## 0. Tóm tắt cho người bận

Zoldify là marketplace đồ cũ có **ví, ký quỹ (escrow) và rút tiền** — tức là một sản phẩm fintech-lite, không phải web bán hàng thường. Điều đó đặt ra một thứ tự ưu tiên khác với trực giác:

> **Việc cấp bách nhất không phải là scale, mà là làm cho tiền đúng.** Một hệ thống tính sai số dư mà chạy được 10.000 người dùng đồng thời chỉ là tính sai nhanh hơn.

Ba kết luận của bản thiết kế:

1. **Lõi tiền phải viết lại theo sổ cái kép (double-entry ledger).** Hiện có ba nơi giữ số dư và chúng đã phân kỳ. Không có một transaction DB nào trong toàn bộ luồng tiền.
2. **Kiến trúc là modular monolith, không phải microservices.** Ranh giới module được máy ép tuân thủ (ESLint), tách service để sau. Ranh giới đúng thì tách lúc nào cũng được; ranh giới sai thì microservices chỉ biến lỗi thành lỗi phân tán.
3. **Hợp đồng API (OpenAPI + versioning) là thứ cho phép 6 tuần kịp.** Nó cho phép 3 nhóm (backend / web / mobile) chạy song song thay vì xếp hàng chờ nhau.

Kết quả kỳ vọng sau 6 tuần: backend chạy được **nhiều tiến trình song song** trên một VPS, số dư có thể đối soát tới từng đồng, và một app React Native mua + bán đầy đủ chạy trên Android.

---

## 1. Hiện trạng — có bằng chứng

Toàn bộ phần này rút ra từ việc đọc code, không phải phỏng đoán.

### 1.1 Stack hiện tại

| Tầng | Công nghệ |
|---|---|
| Backend | NestJS 11, TypeORM 0.3.29, MySQL, Socket.IO, Firebase Admin |
| Frontend | Next.js 14 App Router, Tailwind 3, axios, socket.io-client |
| Thanh toán | PayOS (duy nhất — SePay đã gỡ 14/08/2026) |
| Vận chuyển | GHN |
| Quy mô | Backend ~8.500 dòng / 169 file TS · Frontend 75 file |
| Git | Backend: **1 commit, 1 nhánh `main`** |

24 module backend: `addresses` · `admin` · `auth` · `carts` · `categories` · `chat` · `escrows` · `files` · `firebase` · `follows` · `ghn` · `interactions` · `notifications` · `orders` · `payments` · `payos` · `products` · `settings` · `shop` · `sitemap` · `tasks` · `users` · `wallets` · `withdrawals`

### 1.2 🔴 Nhóm lỗi nghiêm trọng — tiền có thể sai số

**L1. Ba nguồn sự thật cho số dư.**

Trong `users/entities/user.entity.ts:52`, chính team đã ghi chú:

```ts
// Số dư tài khoản (legacy, dùng bảng wallets) - DECIMAL(15,2)
balance: number;
```

Nhưng `escrows/escrows.service.ts:68` vẫn cộng tiền vào đúng cột legacy đó:

```ts
await this.userRepository.increment({ id: escrow.seller.id }, 'balance', Number(escrow.amount));
```

| Nơi lưu | `WalletsService` ghi | `EscrowsService` ghi |
|---|:---:|:---:|
| `wallets.balance` | ✅ | ❌ |
| `users.balance` | ✅ | ✅ |
| `wallet_transactions` (sổ giao dịch) | ✅ | ❌ |

Hệ quả: ngay sau lần giải ngân escrow đầu tiên, `users.balance` tăng còn `wallets.balance` đứng yên, và **không có dòng sổ nào ghi lại**. Người bán, admin và sổ giao dịch nhìn thấy ba con số khác nhau, không ai truy được tiền từ đâu ra.

**L2. Không có một transaction DB nào trong toàn bộ luồng tiền.**

Grep `DataSource` / `createQueryRunner` / `manager.transaction` trên toàn `src/`: chỉ khớp `seed.ts` và `data-source.ts`. Nghĩa là mọi thao tác tiền đều là các lệnh ghi rời rạc.

Ví dụ rõ nhất, `wallets/wallets.service.ts:144`:

```ts
async transfer(fromUserId, toUserId, amount, note?) {
  await this.deduct(fromUserId, amount, 'transfer', note);   // ← sập ở đây
  await this.topup(toUserId, amount, 'transfer', note);      // ← dòng này không chạy
}
```

Tiến trình chết giữa hai dòng = tiền trừ của người gửi mà không vào người nhận. Biến mất, không dấu vết.

**L3. Đọc-sửa-ghi số dư không khoá.**

`wallets.service.ts:49-54` đọc `balance` vào biến, cộng trong JS, rồi `save()`. Hai request đồng thời cùng đọc 100.000, cùng ghi 150.000 — một lần nạp bốc hơi (lost update). `escrows.service.ts:56-75` cũng vậy: hai request cùng đọc trạng thái `HOLDING` thì giải ngân hai lần.

**L4. Chống lặp webhook nằm ngoài transaction cộng tiền.**

`payos/payos.service.ts:328-340` — đây là phần **được viết tốt nhất** codebase: có verify chữ ký, có bảng `payos_webhook_log` với khoá duy nhất để chống xử lý lặp. Nhưng bản ghi log được `INSERT` **trước** khi cộng tiền, và hai việc không nằm chung một transaction. Sập ở khoảng giữa → PayOS gửi lại webhook → bị coi là trùng và bỏ qua → **tiền người dùng đã trả nhưng không bao giờ vào ví**.

**L5. Kiểu số sai cho tiền.** `DECIMAL(15,2)` được TypeORM trả về chuỗi rồi ép `Number(...)` khắp nơi. Số tiền lớn sẽ mất chính xác âm thầm, không có lỗi nào được ném ra.

### 1.3 🟡 Nhóm chặn scale ngang — không thể chạy quá 1 tiến trình

| # | Vấn đề | Vị trí | Hệ quả khi chạy 2 node |
|---|---|---|---|
| S1 | `CacheModule.register()` mặc định = cache trong RAM tiến trình | `app.module.ts:40` | Mỗi node một cache, dữ liệu lệch nhau |
| S2 | `ThrottlerModule` lưu bộ đếm trong RAM | `app.module.ts:45` | Rate limit sai gấp N lần số node |
| S3 | Ảnh lưu đĩa local, URL ghép từ `req.get('host')` | `files/files.controller.ts:24` | Ảnh 404 khi khác node; redeploy container là mất sạch |
| S4 | Socket.IO không có Redis adapter | `chat/chat.gateway.ts:21` | Hai người vào hai node là **không nhắn được cho nhau** |
| S5 | Cron `@nestjs/schedule` chạy trong tiến trình API | `tasks/` | Mỗi node chạy một lần → job tiền chạy N lần |
| S6 | `connectionLimit: 50` mỗi tiến trình | `app.module.ts:63` | 3 node = 150 kết nối > `max_connections` mặc định 151 của MySQL → sập |

`chat.gateway.ts:21` còn để `cors: { origin: '*' }` trong khi `main.ts` đã cấu hình CORS chặt cho REST — websocket đang là cửa hậu.

### 1.4 🟡 Nhóm chặn mobile

| # | Vấn đề | Vị trí |
|---|---|---|
| M1 | Không có prefix lẫn version API — route trần `/orders` | `main.ts` (thiếu `setGlobalPrefix`, `enableVersioning`) |
| M2 | `@nestjs/swagger` đã cài nhưng **chưa từng được bật** | `main.ts` thiếu `SwaggerModule.setup()` |
| M3 | Toàn bộ 15 service frontend dùng `data: any` | `src/services/*.ts` |
| M4 | Token lưu `localStorage` — **React Native không có API này** | `src/lib/http.ts:11` |
| M5 | Gặp 401 là xoá token và đá về `/login`; không dùng refresh token dù backend đã có `refresh_token` + `token_version` | `src/lib/http.ts:26-33` |

### 1.5 🟢 Những thứ đang làm tốt (giữ nguyên)

- `main.ts` có helmet, CORS theo danh sách trắng, compression, `trust proxy`, `ValidationPipe` với `whitelist` + `forbidNonWhitelisted`.
- PayOS có verify chữ ký webhook và có ý thức chống lặp (chỉ sai chỗ đặt transaction).
- Đã có migration TypeORM, đã có index hiệu năng và fulltext search.
- `TransformInterceptor` + `HttpExceptionFilter` cho định dạng response nhất quán.

### 1.6 Tài liệu lỗi thời

`Zoldify_Frontend/README.md` và `ARCHITECTURE.md` vẫn đang mô tả **bản PHP thuần tên "UniMarket"** — sai hoàn toàn so với stack Next.js + NestJS hiện tại. Người mới vào đọc sẽ đi nhầm đường ngay ngày đầu. Cần viết lại (đã có task riêng).

---

## 2. Ràng buộc & quyết định đã chốt

| Hạng mục | Chốt |
|---|---|
| Mục tiêu | Đồ án capstone, nhưng kiến trúc không phải đập đi khi thương mại hoá |
| Deadline | **~5,5 tuần, hoàn thành 15/09/2026**, đóng băng tính năng 08/09 |
| Team | **5 sinh viên** (quy định capstone: 3-5) |
| Mục tiêu điểm | **Level 3 (81-100)** — xem đối chiếu rubric ở kế hoạch bàn giao |
| Nền tảng app | **Bắt buộc cả Android và iOS** (Expo Go trên iPhone) |
| Ngôn ngữ báo cáo | **Toàn bộ tiếng Anh**, ≥50 trang, đúng mẫu VTC |
| Hạ tầng | 1 VPS đơn, ngân sách vài trăm nghìn/tháng |
| Mobile | React Native + Expo |
| Scope app | **Mua + bán đầy đủ** (~28 màn hình) |
| Kiến trúc | **Modular monolith**, ranh giới service chỉ trên tài liệu |
| Cấu trúc thư mục | **Có move** theo 6 bounded context, làm trước khi phát task |
| Doanh thu | **Phí % trên giá trị đơn**, tỉ lệ đọc từ bảng `settings` |
| Dữ liệu hiện có | Toàn dữ liệu test → **reset sạch**, không cần backfill |

### Bố trí kho mã

Hiện có 2 repo Git độc lập (`Zoldify_Backend`, `Zoldify_Frontend`). Mobile là **repo thứ ba**: `Zoldify_Mobile`.

Không gộp monorepo (lý do ở §5.3). Ba repo chia sẻ hợp đồng qua `openapi.json` được commit trong repo backend; web và mobile sinh client từ đó bằng `npm run gen:api`.

Nhánh: `main` (ổn định) ← `develop` ← `feature/*`. Backend hiện chỉ có `main` — tạo `develop` ngay sau commit move thư mục.

### Vì sao monolith chứ không microservices

Microservices cho slide đẹp hơn, nhưng với 6 tuần + sinh viên + 1 VPS thì nó buộc phải giải quyết **distributed transaction** giữa payment và order — trong khi hệ thống hiện tại còn chưa có nổi một transaction *đơn lẻ*. Debug xuyên service mà không có distributed tracing sẽ nuốt sạch quỹ thời gian.

Bản thiết kế vẫn **định nghĩa đầy đủ ranh giới service trên tài liệu** để bảo vệ đồ án: đặt tên bounded context, khai báo hợp đồng giữa chúng, và chỉ rõ thứ tự cắt khi cần tách thật.

---

## 3. Phần 1 — Ranh giới module

### 3.1 Sáu bounded context

```
┌─ Identity ──────┐  auth · users · addresses
├─ Catalog ───────┤  products · categories · shop · files · interactions · follows · sitemap
├─ Ordering ──────┤  carts · orders · ghn
├─ Money ⭐ ──────┤  ledger(MỚI) · wallets · escrows · payments · payos · withdrawals
├─ Messaging ─────┤  chat · notifications · firebase · mail
└─ Ops ───────────┘  admin · settings · tasks
```

### 3.2 Luật quan trọng nhất của cả bản thiết kế

> **Một module chỉ được inject repository của chính context mình. Muốn đụng dữ liệu context khác thì gọi service của context đó.**

Áp luật này thì lỗi L1 **không thể viết ra được nữa**: `escrows` mất quyền truy cập `Repository<User>`, buộc phải đi qua `LedgerService`.

Enforce bằng `eslint-plugin-boundaries` chạy trong CI — **máy bắt, không phải người nhớ**. Một luật chỉ nằm trong đầu người thì tuần sau sẽ bị phá.

### 3.3 Cấu trúc thư mục sau khi move

```
src/
├── common/          # decorator, filter, interceptor, enum dùng chung
├── core/
├── identity/        # auth · users · addresses
├── catalog/         # products · categories · shop · files · interactions · follows · sitemap
├── ordering/        # carts · orders · ghn
├── money/           # ledger · wallets · escrows · payments · payos · withdrawals
├── messaging/       # chat · notifications · firebase · mail
├── ops/             # admin · settings · tasks
└── migrations/
```

Alias trong `tsconfig.json` để mọi lần move sau gần như miễn phí:

```jsonc
"paths": {
  "@identity/*":  ["src/identity/*"],
  "@catalog/*":   ["src/catalog/*"],
  "@ordering/*":  ["src/ordering/*"],
  "@money/*":     ["src/money/*"],
  "@messaging/*": ["src/messaging/*"],
  "@ops/*":       ["src/ops/*"],
  "@common/*":    ["src/common/*"]
}
```

### 3.4 Chi phí move — đã đo, không đoán

| Chỉ số | Giá trị |
|---|---|
| File TS backend | 169 |
| Import phải sửa (`from 'src/...'` + `'../...'`) | **256** |
| Import không đụng tới (`'./...'` cùng thư mục) | 234 |
| **Ước lượng** | **1-2 giờ, một người** |

Rẻ vì hai lý do: IDE tự viết lại import khi kéo-thả thư mục, và **TypeScript bắt 100% import gãy lúc `npm run build`**. Đây là refactor được máy kiểm chứng toàn bộ — không có gì tinh vi lọt được.

Các chỗ hay gãy trong NestJS thì Zoldify đều an toàn: `app.module.ts` và `data-source.ts` nạp entity/migration bằng glob `__dirname + '/**/*.entity'`, `nest-cli.json` và Jest `rootDir: 'src'` cũng theo glob — đổi thư mục con không ảnh hưởng.

### 3.5 Thời điểm: NGAY, trước khi phát task

Backend đang có **đúng 1 commit và 1 nhánh**. Chưa ai branch ra làm gì. Chi phí merge conflict lúc này bằng **không**, và sẽ tăng theo cấp số nhân từng tuần khi 5 người cùng mở nhánh trên các file bị move.

**Điều kiện bắt buộc:** commit này chỉ chứa move + sửa import, **không kèm bất kỳ thay đổi logic nào**. Có vậy mới `git revert` sạch được khi có sự cố, và người review đọc diff biết ngay là không đổi hành vi.

### 3.6 Đường cắt service về sau (viết vào báo cáo)

| Thứ tự | Context | Lý do tách |
|---|---|---|
| 1 | **Money** | Ranh giới dữ liệu sạch nhất; cần deploy riêng, audit riêng, quyền truy cập riêng |
| 2 | **Messaging** | Chat là I/O-bound, đặc tính scale khác hẳn phần còn lại |
| 3 | Catalog / Ordering / Identity | Join dữ liệu của nhau liên tục — ở lại với nhau lâu nhất |

---

## 4. Phần 2 — Ledger: lõi tiền

### 4.1 Nguyên tắc

> **Tiền không sinh ra và không mất đi — nó chỉ chuyển giữa các tài khoản. Mọi bút toán phải cộng lại bằng 0.**

Vá lỗi bằng cách "nhớ ghi đủ 3 chỗ" là sai hướng: hôm nay 3 chỗ, tháng sau ai đó thêm chỗ thứ 4. Phải làm cho việc ghi sai **trở thành bất khả thi về mặt cấu trúc**.

### 4.2 Lược đồ

```sql
-- Tài khoản: ví (user 7, AVAILABLE) | tiền giữ hộ (user 7, ESCROW_HOLD) | doanh thu nền tảng
CREATE TABLE ledger_accounts (
  id           BIGINT PRIMARY KEY AUTO_INCREMENT,
  owner_type   ENUM('user','platform','external') NOT NULL,
  owner_id     BIGINT NULL,
  purpose      ENUM('available','escrow_hold','withdrawal_pending',
                    'revenue','gateway_clearing','bank_external') NOT NULL,
  balance      BIGINT NOT NULL DEFAULT 0,   -- đơn vị: ĐỒNG
  version      INT    NOT NULL DEFAULT 0,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_account (owner_type, owner_id, purpose)
);

-- Một sự kiện tiền, nhóm nhiều bút toán
CREATE TABLE ledger_transactions (
  id               BIGINT PRIMARY KEY AUTO_INCREMENT,
  type             VARCHAR(50)  NOT NULL,
  idempotency_key  VARCHAR(191) NOT NULL,
  reference_type   VARCHAR(50)  NULL,
  reference_id     BIGINT       NULL,
  metadata         JSON         NULL,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_idem (idempotency_key),          -- ← lá chắn chống lặp
  KEY idx_ref (reference_type, reference_id)
);

-- APPEND-ONLY. Không UPDATE, không DELETE, mãi mãi.
CREATE TABLE ledger_entries (
  id             BIGINT PRIMARY KEY AUTO_INCREMENT,
  transaction_id BIGINT NOT NULL,
  account_id     BIGINT NOT NULL,
  amount         BIGINT NOT NULL,     -- âm = ra, dương = vào
  balance_after  BIGINT NOT NULL,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_account_time (account_id, created_at),
  KEY idx_tx (transaction_id)
);
```

**Bất biến:** `SUM(entries.amount) = 0` trong mỗi `ledger_transaction`.

### 4.3 Toàn bộ dòng tiền Zoldify

Bảng này mô tả hệ thống chính xác hơn mọi sơ đồ khối — nên đưa thẳng vào báo cáo đồ án.

| Sự kiện | Bút toán (đơn vị: đồng) |
|---|---|
| **Nạp ví** qua PayOS | `gateway_clearing −100.000` · `buyer.available +100.000` |
| **Đặt hàng** trả bằng ví | `buyer.available −500.000` · `escrow_hold +500.000` |
| **Giao thành công** → giải ngân (phí 5%) | `escrow_hold −500.000` · `seller.available +475.000` · `platform.revenue +25.000` |
| **Huỷ / hoàn tiền** | `escrow_hold −500.000` · `buyer.available +500.000` |
| **Duyệt rút tiền** | `seller.available −300.000` · `withdrawal_pending +300.000` |
| **Đã chuyển khoản xong** | `withdrawal_pending −300.000` · `bank_external +300.000` |

Hai điều bảng này làm lộ ra mà code hiện tại đang giấu:

1. **Tiền giữ hộ là một tài khoản thật**, không phải một dòng trạng thái. Bất cứ lúc nào cũng trả lời được câu "Zoldify đang giữ hộ tổng bao nhiêu tiền của người dùng" — và con số đó **bắt buộc phải khớp với số dư tài khoản ngân hàng thật**. Đây là câu hỏi đầu tiên mọi bên kiểm toán sẽ hỏi.
2. Tài khoản `platform.revenue` — code hiện tại giải ngân 100% cho người bán, nền tảng không thu đồng nào. Đã chốt: **phí % trên đơn, tỉ lệ lưu trong bảng `settings`** (key `platform_fee_percent`), không hardcode.

### 4.4 LedgerService — cửa duy nhất

Toàn hệ thống có **đúng một hàm** được phép làm số dư thay đổi:

```ts
async post(tx: {
  idempotencyKey: string;                            // BẮT BUỘC, không có giá trị mặc định
  type: LedgerTxType;
  entries: { accountId: number; amount: bigint }[];  // sum bắt buộc = 0n
  reference?: { type: 'order' | 'escrow' | 'payment' | 'withdrawal'; id: number };
  metadata?: Record<string, unknown>;
}): Promise<LedgerTransaction>
```

Bên trong, cả bốn việc nằm gọn trong **một** `dataSource.transaction()`:

1. `INSERT ledger_transactions` với `idempotency_key` UNIQUE. Trùng key → MySQL ném `ER_DUP_ENTRY` → bắt lỗi, trả về kết quả của lần trước. **Chống lặp và cộng tiền chung một số phận**: hoặc cả hai thành công, hoặc cả hai bị huỷ. Đây chính là chỗ vá lỗi L4.
2. `SELECT ... FOR UPDATE` các account liên quan, **khoá theo thứ tự `account_id` tăng dần** để chống deadlock chéo. Vá lỗi L3.
3. Kiểm `entries.reduce((s,e) => s + e.amount, 0n) === 0n`; kiểm không account người dùng nào âm.
4. `INSERT ledger_entries` + `UPDATE ledger_accounts.balance`.

Khoá idempotency đặt theo quy tắc tất định, không random:

| Nghiệp vụ | Khoá |
|---|---|
| Webhook PayOS | `payos:{orderCode}:{paymentLinkId}` |
| Giải ngân escrow | `escrow_release:{escrowId}` |
| Hoàn tiền escrow | `escrow_refund:{escrowId}` |
| Duyệt rút tiền | `withdrawal_approve:{withdrawalId}` |

Gọi lại bao nhiêu lần cũng chỉ có hiệu lực một lần — kể cả khi mạng chập chờn hay người dùng bấm hai lần.

### 4.5 Ba quyết định kỹ thuật kèm theo

**BIGINT tính bằng đồng, bỏ `DECIMAL(15,2)`.** VND không có xu. `Number(wallet.balance)` rải khắp code là bug chờ nổ — vượt ngưỡng an toàn của `number` trong JS là mất chính xác âm thầm, không ném lỗi nào. Lưu `bigint`, format ở tầng hiển thị.

**Xoá cột `users.balance`.** Còn tồn tại là còn có người ghi vào. Số dư chỉ có một nguồn duy nhất: `ledger_accounts`.

**Job đối soát mỗi giờ.** Kiểm hai điều: `SUM(toàn bộ entries) = 0`, và mỗi `account.balance = SUM(entries của account đó)`. Lệch → cảnh báo ngay. Mọi tổ chức tài chính thật đều chạy job này, và nó là một slide rất ăn điểm.

### 4.6 Lộ trình triển khai

Vì dữ liệu hiện tại là dữ liệu test và đã chốt reset sạch, không cần bước backfill:

| Bước | Việc | Kết quả kiểm chứng |
|---|---|---|
| B1 | Dựng 3 bảng + `LedgerService` + unit test (chưa ai gọi) | Test đồng thời: 100 request release song song chỉ cộng tiền đúng 1 lần |
| B2 | Reset DB, seed lại toàn bộ qua `LedgerService` | Job đối soát trả về 0 sai lệch |
| B3 | Chuyển từng luồng: nạp → thanh toán → escrow → rút | Mỗi luồng có e2e test riêng |
| B4 | Xoá đường ghi cũ, `DROP COLUMN users.balance` | Grep toàn repo không còn `users.balance` |

---

## 5. Phần 3 — Hợp đồng API

Phần này không hào nhoáng nhưng nó là **lý do 6 tuần có thể kịp**.

### 5.1 Vì sao versioning là bắt buộc khi có app

Web deploy phát là 100% người dùng lên bản mới ngay. **App thì không.** Store duyệt mất vài ngày, và người dùng có thể không cập nhật app hàng tháng.

> Kể từ ngày phát hành app đầu tiên, backend vĩnh viễn phải phục vụ đồng thời nhiều phiên bản client mà bạn không kiểm soát được.

Đổi tên một field trong response hôm nay = app của người chưa update **crash** hôm nay, không có đường lùi.

Cấu hình:

```ts
app.setGlobalPrefix('api');
app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
// → /api/v1/orders
```

**Giao kèo `v1`:** một khi app lên store, `v1` đóng băng — chỉ được **thêm field tuỳ chọn**. Cấm đổi tên, cấm xoá, cấm đổi kiểu. Muốn phá vỡ thì mở `/api/v2` và nuôi song song cho tới khi lượng người dùng bản cũ đủ nhỏ.

### 5.2 Quy trình contract-first

```
1. BE viết DTO + @ApiProperty   →  merge SỚM, chưa cần xong logic
              ↓
2. CI xuất openapi.json          →  commit vào repo backend
              ↓
3. Web + Mobile chạy `npm run gen:api`
              ↓
   sinh client + type đầy đủ, dùng được ngay
              ↓
4. Chưa có BE thật? → Prism mock server đọc openapi.json,
   trả dữ liệu giả đúng schema → Mobile code được từ ngày 1
```

Mobile không chờ backend làm xong nghiệp vụ — chỉ chờ backend **chốt hình dạng dữ liệu**, việc mất vài giờ chứ không phải vài tuần. Đây là đòn bẩy lớn nhất của cả kế hoạch.

### 5.3 Cố ý KHÔNG làm monorepo

Gộp 2 repo thành pnpm workspace + Turborepo là đúng sách, nhưng tốn vài ngày cấu hình và cả team phải học lại cách chạy dự án — giữa lúc chỉ có 6 tuần.

Thay vào đó: mỗi repo có script `npm run gen:api` sinh code vào `src/api/generated/`, **commit thẳng vào repo**. CI kiểm tra "sinh lại có khác không → khác thì fail build". Được 90% lợi ích với 10% chi phí. Monorepo để sau deadline.

### 5.4 Tầng HTTP dùng chung web + app

`lib/http.ts` tách làm hai: phần lõi không biết mình chạy ở đâu, phần lưu token cắm adapter theo nền tảng.

```ts
interface TokenStore {                    // web  → localStorage
  get(): Promise<string | null>;          // app  → expo-secure-store (mã hoá,
  set(t: string): Promise<void>;          //        an toàn hơn AsyncStorage)
  clear(): Promise<void>;
}
```

Đồng thời sửa lỗi M5. Hiện tại gặp `401` là xoá token và đá về `/login`, trong khi backend **đã có sẵn** `refresh_token` + `token_version` — cơ chế có, frontend không dùng.

Trên web chỉ hơi phiền. Trên app, access token hết hạn sau 15 phút mà mỗi lần lại văng ra màn hình đăng nhập thì **không ai dùng nổi**.

Sửa: interceptor bắt `401` → gọi refresh → thử lại request cũ, và gom mọi request đồng thời vào **một** lần refresh duy nhất (single-flight). Không có single-flight thì lúc mở app 20 request song song sẽ bắn 20 lệnh refresh, 19 cái trong đó làm hỏng token của cái đầu tiên.

---

## 6. Phần 4 — Kiến trúc App React Native

### 6.1 Stack và lý do chọn

| Hạng mục | Chọn | Lý do |
|---|---|---|
| Nền tảng | **Expo (managed) + EAS Build** | Team dùng Windows, không có macOS → build iOS trên cloud của Expo. Không eject. |
| Điều hướng | **Expo Router** | File-based routing, tư duy y hệt Next.js App Router mà team đã quen |
| Server state | **TanStack Query** | Cache, retry, refetch, invalidate — thay được toàn bộ `useEffect + useState` thủ công |
| Client state | **Zustand** | Chỉ cho auth + UI state. Không dùng Redux: quá nặng cho 6 tuần |
| Giao diện | **NativeWind** | Cú pháp Tailwind y như web → **đòn bẩy lớn nhất**, team không phải học hệ thống style mới |
| Form | react-hook-form + zod | Zod schema sinh được từ OpenAPI |
| Ảnh | expo-image | Cache đĩa tốt hơn `<Image>` mặc định nhiều |
| Token | expo-secure-store | Mã hoá bằng Keychain/Keystore, an toàn hơn AsyncStorage |
| Push | expo-notifications + FCM | Backend **đã có** `firebase-admin` → tái dùng module `notifications` |
| Chat | socket.io-client | Chạy tốt trên RN → tái dùng module `chat` |
| Ảnh đăng bán | expo-image-picker + expo-image-manipulator | **Bắt buộc nén trước khi upload** — ảnh 12MP qua 4G Việt Nam là trải nghiệm tệ nhất của app |
| Crash report | Sentry (free tier) | Lỗi trên máy người dùng thật, không thấy được bằng cách nào khác |

### 6.2 Bản đồ màn hình (~28 màn)

```
app/
├── (auth)/
│   ├── login · register · forgot-password · verify-email          [4]
├── (tabs)/
│   ├── index          — Trang chủ: danh mục, sản phẩm nổi bật
│   ├── search         — Tìm kiếm + bộ lọc
│   ├── orders         — Đơn mua của tôi
│   ├── chat           — Danh sách hội thoại
│   └── profile        — Tài khoản                                  [5]
├── product/[id]                  — Chi tiết sản phẩm
├── shop/[id]                     — Trang người bán
├── cart                          — Giỏ hàng
├── checkout                      — Chọn địa chỉ, vận chuyển, thanh toán
├── payment/return                — Điểm quay về từ PayOS (deep link)
├── order/[id]                    — Chi tiết đơn + trạng thái escrow
├── order/[id]/tracking           — Theo dõi vận chuyển GHN
├── chat/[conversationId]         — Phòng chat
├── notifications                 — Thông báo                       [8]
├── seller/
│   ├── dashboard                 — Tổng quan bán hàng
│   ├── products                  — Sản phẩm của tôi
│   ├── product/new               — Đăng bán (chụp/chọn ảnh)
│   ├── product/[id]/edit         — Sửa tin
│   ├── orders                    — Đơn bán
│   ├── order/[id]                — Xử lý đơn, tạo vận đơn
│   ├── wallet                    — Ví: khả dụng / đang giữ hộ
│   ├── withdraw                  — Yêu cầu rút tiền
│   └── transactions              — Lịch sử giao dịch (từ ledger)    [9]
└── settings/
    ├── profile · addresses                                          [2]
```

Tổng **28 màn**. Nhóm `seller/` là nửa khối lượng công việc — đúng như cảnh báo lúc chọn scope.

### 6.3 Ba quyết định định hình app

**Thanh toán đi qua WebView, không nhúng form thẻ.** PayOS trả về `checkout_url`; app mở bằng `expo-web-browser`, người dùng thanh toán xong thì deep link `zoldify://payment/return` đưa về app. Nhúng form thẻ trong app sẽ vướng chính sách App Store và kéo cả PCI-DSS vào phạm vi — không đáng cho một đồ án, và cũng không đáng cho một startup nhỏ.

**Quan trọng:** deep link chỉ dùng để *điều hướng giao diện*. Nguồn sự thật duy nhất về việc "đã trả tiền chưa" là **webhook PayOS gửi thẳng vào backend**. App quay về màn hình chỉ hiển thị "đang xác nhận" rồi hỏi lại backend — tuyệt đối không được tin tham số trên URL để cộng tiền. Người dùng sửa được URL đó.

**Offline: chỉ đọc, không ghi.** TanStack Query persist cache xuống AsyncStorage → mở app là thấy nội dung lần trước ngay, không phải màn hình trắng. **Không** làm hàng đợi ghi offline (đặt hàng khi mất mạng rồi đồng bộ sau) — nó kéo theo giải quyết xung đột và cả tá trường hợp biên, không đáng trong 6 tuần. Mất mạng thì báo lỗi rõ ràng và cho bấm thử lại.

**Android trước, iOS sau.** Tài khoản Apple Developer tốn 99 USD/năm và duyệt mất thời gian không đoán trước được. Cho đồ án, file APK cài trực tiếp là quá đủ để demo. Cấu trúc code không khác gì nhau, iOS thêm vào bất cứ lúc nào.

### 6.4 Phát hành

| Kênh | Dùng khi |
|---|---|
| **EAS Build** → APK internal | Team test hằng tuần |
| **EAS Update** (OTA) | Sửa lỗi JS/giao diện — **đẩy thẳng, không chờ store duyệt** |
| Google Play Internal Testing | Tuần cuối, nếu kịp |

EAS Update rất hợp deadline gấp: những ngày cuối phát hiện lỗi giao diện thì đẩy bản vá trong vài phút. Chỉ khi đổi native code (thêm thư viện có phần native) mới cần build lại.

---

## 7. Phần 5 — Hạ tầng & triển khai

### 7.1 Kiến trúc chạy trên một VPS

```
                          Internet
                             │
                    ┌────────▼────────┐
                    │  Caddy (TLS tự  │   ← HTTPS tự động, cấu hình 5 dòng
                    │  động, LB)      │
                    └────┬───────┬────┘
                 ┌───────┘       └───────┐
            ┌────▼────┐  ┌────▼────┐  ┌──▼──────┐
            │ api #1  │  │ api #2  │  │ api #3  │   ← Nest, KHÔNG giữ trạng thái
            └────┬────┘  └────┬────┘  └──┬──────┘
                 └───────┬────┴──────────┘
              ┌──────────┼──────────┐
        ┌─────▼────┐ ┌───▼────┐ ┌───▼─────────┐
        │  MySQL 8 │ │ Redis 7│ │ worker × 1  │  ← BullMQ + cron, CHỈ 1 bản
        └──────────┘ └────────┘ └─────────────┘
                             │
                    ┌────────▼────────┐
                    │ Cloudflare R2   │  ← ảnh; egress miễn phí
                    └─────────────────┘
```

**Chọn Caddy thay Nginx** vì nó tự xin và tự gia hạn chứng chỉ Let's Encrypt, cấu hình ngắn bằng 1/10. Với sinh viên và deadline 6 tuần, tiết kiệm này là thật. (Nếu báo cáo cần Nginx cho quen thuộc thì đổi được, tốn thêm ~nửa ngày làm certbot.)

### 7.2 Sáu vấn đề scale và cách vá

| # | Vấn đề | Cách vá |
|---|---|---|
| S1 | Cache trong RAM | `CacheModule` + `@keyv/redis` → Redis |
| S2 | Throttler trong RAM | `@nest-lab/throttler-storage-redis` |
| S3 | Ảnh trên đĩa local | `@aws-sdk/client-s3` → Cloudflare R2; URL từ biến môi trường `CDN_BASE_URL`, **không** ghép từ `req.get('host')` |
| S4 | Socket 1 node | `@socket.io/redis-adapter`; đồng thời sửa `cors: '*'` thành danh sách trắng |
| S5 | Cron chạy nhiều lần | Tách tiến trình `worker` riêng, chỉ chạy 1 bản; API không nạp `ScheduleModule` |
| S6 | 150 kết nối > `max_connections` 151 | Hạ `connectionLimit` từ **50 → 15**; nâng `max_connections` MySQL lên 200 |

S6 là cái bẫy sẽ nổ đúng vào lúc trình diễn nếu không sửa trước: nhân 3 tiến trình là vượt ngưỡng mặc định của MySQL, và triệu chứng là "đột nhiên toàn bộ API trả lỗi", rất khó đoán ra nguyên nhân.

### 7.3 Chứng minh scale ngang được (phần ăn điểm đồ án)

```bash
docker compose up -d --scale api=1
k6 run load/checkout.js     # ghi lại p95, throughput, tỉ lệ lỗi

docker compose up -d --scale api=3
k6 run load/checkout.js     # so sánh
```

Kèm một kịch bản chứng minh tính đúng đắn, thuyết phục hơn mọi biểu đồ: **100 lượt giải ngân escrow đồng thời cho cùng một đơn** → ledger chỉ ghi nhận đúng 1 giao dịch, job đối soát trả về 0 sai lệch. Đây là bằng chứng trực tiếp rằng lỗi L3 đã bị diệt.

### 7.4 CI/CD (GitHub Actions)

**Trên mỗi Pull Request:**
1. `lint` + `typecheck`
2. `eslint-plugin-boundaries` — chặn vi phạm ranh giới context
3. `test` (bắt buộc phủ module `money`)
4. `build`
5. Sinh lại `openapi.json`, khác với bản đã commit → **fail**

**Khi merge vào `main`:**
1. Build Docker image → đẩy lên GHCR
2. SSH vào VPS → `docker compose pull && docker compose up -d`
3. Chạy migration ở bước riêng, có phương án lùi

### 7.5 Sao lưu — bắt buộc vì có tiền

- `mysqldump` hằng ngày → nén → đẩy lên R2, giữ 14 ngày.
- **Diễn tập khôi phục ít nhất một lần** trước khi bảo vệ đồ án. Bản sao lưu chưa từng khôi phục thử thì không phải bản sao lưu, chỉ là một file.

### 7.6 Quan sát — vừa đủ, không hơn

| Có | Cố ý KHÔNG có |
|---|---|
| `/api/v1/health` (kiểm DB + Redis) | Prometheus + Grafana |
| Log JSON bằng pino, có request-id | ELK / Loki |
| UptimeRobot (miễn phí) | Distributed tracing |
| Sentry cho cả backend và app | APM trả phí |
| Cảnh báo từ job đối soát ledger | |

Dựng Prometheus + Grafana ngốn 2-3 ngày và với lượng truy cập của đồ án thì các biểu đồ đó sẽ phẳng lì. Sentry đem lại giá trị lớn hơn nhiều lần với chi phí gần bằng 0 — vì nó bắt được lỗi trên máy người dùng thật, thứ không có cách nào khác nhìn thấy.

---

## 8. Phần 6 — Kiểm thử, quan sát, Definition of Done

### 8.1 Chiến lược test theo mức rủi ro

Không đặt mục tiêu phủ đều — dồn công sức vào nơi sai thì mất tiền.

| Vùng | Mức test | Bắt buộc |
|---|---|---|
| **`money/ledger`** | Unit + integration, gồm test đồng thời | ✅ Cổng chặn merge |
| `money/*` còn lại (escrow, payos, withdrawal) | Integration trên MySQL thật | ✅ |
| `ordering`, `catalog`, `identity` | E2E luồng chính | Nên có |
| Giao diện web | Smoke thủ công theo checklist | Nên có |
| App RN | Smoke thủ công theo checklist + Sentry | Nên có |

**Không** viết unit test cho component UI. Trong 6 tuần, thời gian đó đổi lấy nhiều giá trị hơn ở chỗ khác.

Bốn test bắt buộc phải có của ledger:

1. `sum(entries) ≠ 0` → ném lỗi, không ghi gì.
2. Cùng `idempotencyKey` gọi 2 lần → chỉ 1 giao dịch tồn tại.
3. 100 lượt release đồng thời cùng escrow → đúng 1 lần cộng tiền.
4. Trừ quá số dư → ném lỗi, số dư không đổi.

### 8.2 Definition of Done (áp cho mọi task)

Một task chỉ được coi là xong khi đủ **tất cả**:

- [ ] Code chạy được ở local theo hướng dẫn trong README
- [ ] `npm run lint` và `npm run build` sạch
- [ ] Có test cho nhánh chính (bắt buộc nếu chạm `money/`)
- [ ] Nếu đổi API: đã cập nhật `@ApiProperty`, đã sinh lại `openapi.json`
- [ ] Nếu đổi DB: có migration, **và đã chạy thử lùi migration**
- [ ] Có ít nhất một người khác review
- [ ] Đã cập nhật tài liệu nếu thay đổi cách chạy/cấu hình dự án

---

## 9. Phân rã task A-Z theo tuần & theo người

> ⚠️ **CHƯƠNG NÀY ĐÃ ĐƯỢC THAY THẾ.** Kế hoạch 6 tuần / 6 vai trò bên dưới được lập trước khi có thông báo capstone. Lịch thật, phân vai thật, và phần đối chiếu rubric nằm ở **[`2026-08-06-capstone-delivery-plan.md`](./2026-08-06-capstone-delivery-plan.md)** — 5,5 tuần, 5 vai trò, thêm 4 tính năng Level 3 và hạng mục báo cáo 50 trang.
>
> Giữ lại chương này vì phần mô tả nội dung công việc và tiêu chí nghiệm thu vẫn còn đúng; chỉ có lịch và người là đổi.

### 9.1 Sáu vai trò

| Mã | Vai trò | Người phù hợp | Sở hữu |
|---|---|---|---|
| **A** | Lead / Backend Money | Cứng nhất nhóm | Ledger, escrow, payment, withdrawal, đối soát |
| **B** | Backend Platform | Khá | Move thư mục, Redis, R2, socket, worker, versioning, OpenAPI |
| **C** | Mobile — Buyer | Biết React | Nền app + toàn bộ luồng người mua |
| **D** | Mobile — Seller | Biết React | Luồng người bán, chat, push |
| **E** | Web + QA | Trung bình | Cập nhật web theo v1, admin đối soát, test, tài liệu |
| **F** | DevOps *(nếu đủ 6 người)* | Thích hạ tầng | Docker, CI/CD, backup, monitoring, k6 |

> **Nếu chỉ có 5 người:** gộp F vào B, và chuyển task tài liệu của E sang A.

### 9.2 Tuần 0 — Hai ngày mở khoá (làm TRƯỚC khi phát task)

Đây là nút thắt. Trong lúc này C/D/E **đọc tài liệu và cài môi trường**, chưa code.

| # | Task | Ai | Ước lượng | Tiêu chí nghiệm thu |
|---|---|---|---|---|
| 0.1 | Move 25 module thành 6 context + alias `tsconfig` | A+B cùng máy | 2h | `npm run build` sạch, chỉ có 1 commit thuần move |
| 0.2 | Bật `eslint-plugin-boundaries`, khai báo 6 context | B | 2h | Cố tình vi phạm → lint đỏ |
| 0.3 | Bật `setGlobalPrefix('api')` + `enableVersioning` | B | 1h | Mọi route thành `/api/v1/*` |
| 0.4 | Bật `SwaggerModule` thật, xuất `openapi.json` | B | 2h | Mở được `/api/docs` |
| 0.5 | Thêm `@ApiProperty` cho DTO của **auth, product, order, cart** | A+B | 4h | 4 nhóm này đủ để mobile khởi động |
| 0.6 | Script `gen:api` cho web + mobile, dựng Prism mock | B | 3h | Mobile gọi được mock, có type đầy đủ |
| 0.7 | Dựng `docker-compose.yml` (mysql, redis, api, worker, caddy) | F | 4h | `docker compose up` là chạy |
| 0.8 | Viết lại README + ARCHITECTURE.md (đang mô tả nhầm bản PHP) | E | 3h | Người mới cài được theo hướng dẫn |

**Cổng ra Tuần 0:** `openapi.json` tồn tại và mock server chạy → mọi người được phát task.

### 9.3 Tuần 1 — Nền móng

| Ai | Task | Nghiệm thu |
|---|---|---|
| **A** | 3 bảng ledger + migration + `LedgerService.post()` + 4 test bắt buộc (§8.1) | 100 request đồng thời chỉ cộng 1 lần |
| **B** | Redis cho cache + throttler + socket adapter; hạ `connectionLimit` 50→15 | Chạy `--scale api=3`, chat 2 node vẫn thông |
| **C+D** | Nền app chung: Expo Router, NativeWind, TanStack Query, `TokenStore`, refresh single-flight, đăng nhập/đăng ký | Đăng nhập thật vào BE, token sống qua lần mở lại app |
| **E** | Web đổi sang `/api/v1`, thay `any` bằng type sinh ra | Web chạy nguyên vẹn với prefix mới |
| **F** | CI trên PR (lint + boundaries + test + build + kiểm openapi) | PR sai ranh giới bị chặn tự động |

### 9.4 Tuần 2 — Tiền vào, app hình thành

| Ai | Task | Nghiệm thu |
|---|---|---|
| **A** | Chuyển nạp ví + thanh toán sang ledger; đưa webhook PayOS vào **cùng một transaction** với việc cộng tiền | Giết tiến trình giữa webhook → gửi lại vẫn cộng đúng 1 lần |
| **B** | Upload ảnh sang Cloudflare R2, URL lấy từ env; chuyển ảnh cũ | Xoá thư mục `public/images` mà ảnh vẫn hiển thị |
| **C** | Trang chủ, tìm kiếm + lọc, chi tiết sản phẩm, trang shop | Duyệt được toàn bộ catalog thật |
| **D** | Đăng bán: chọn/chụp ảnh, **nén trước khi upload**, sửa/xoá tin | Đăng tin từ điện thoại trên 4G dưới 10 giây |
| **E** | Trang admin đối soát ledger (số dư hệ thống, tiền đang giữ hộ) | Admin thấy tổng tiền giữ hộ khớp ledger |
| **F** | Deploy staging + backup hằng ngày lên R2 | Khôi phục thử thành công 1 lần |

### 9.5 Tuần 3 — Escrow & thanh toán

| Ai | Task | Nghiệm thu |
|---|---|---|
| **A** | Escrow giải ngân/hoàn tiền qua ledger + **phí nền tảng** đọc từ `settings`; xoá `users.balance` | Grep repo không còn `users.balance`; phí vào `platform.revenue` |
| **B** | Tách tiến trình `worker` (BullMQ + cron), gỡ `ScheduleModule` khỏi API; `/health` | Chạy 3 API mà cron chỉ chạy 1 lần |
| **C** | Giỏ hàng, thanh toán, WebView PayOS, deep link `zoldify://payment/return` | Mua thật một đơn từ app, tiền vào escrow |
| **D** | Đơn bán, xử lý đơn, tạo vận đơn GHN | Người bán xác nhận và tạo vận đơn từ app |
| **E** | E2E luồng: đặt hàng → thanh toán → giao → giải ngân | Test chạy trong CI |
| **F** | CI/CD tự động deploy `main`, migration có đường lùi | Merge là tự lên staging |

### 9.6 Tuần 4 — Ví, rút tiền, realtime

| Ai | Task | Nghiệm thu |
|---|---|---|
| **A** | Rút tiền qua ledger (2 bước: duyệt → đã chuyển khoản); job đối soát mỗi giờ + cảnh báo | Cố tình làm lệch số → job báo trong vòng 1 giờ |
| **B** | Sửa CORS websocket; đóng `openapi.json` v1; rà soát bảo mật | Không còn `origin: '*'` |
| **C** | Chi tiết đơn mua, theo dõi GHN, thông báo, hồ sơ, sổ địa chỉ | Xem được đơn từ lúc đặt tới lúc nhận |
| **D** | Ví người bán (khả dụng / giữ hộ), rút tiền, lịch sử giao dịch, chat, push | Rút tiền từ app; nhận push khi có đơn mới |
| **E** | Smoke checklist web + app; sửa lỗi giao diện | Checklist chạy hết, không lỗi chặn |
| **F** | Sentry cho BE + app; k6 so 1 node vs 3 node | Có số liệu p95 để đưa vào báo cáo |

### 9.7 Tuần 5 — Ghép nối & làm cứng

| Ai | Task |
|---|---|
| **A** | Sửa lỗi lõi tiền; viết chương ledger cho báo cáo |
| **B** | Tinh chỉnh index + truy vấn theo số liệu k6 |
| **C+D** | Trạng thái rỗng, trạng thái lỗi, loading, xử lý mất mạng; EAS Build ra APK |
| **E** | Hồi quy toàn bộ; ghi lại kịch bản demo |
| **F** | Diễn tập deploy production + khôi phục backup |

**Cổng ra Tuần 5:** APK cài được trên máy thật, mua và bán trọn vẹn một vòng.

### 9.8 Tuần 6 — Đóng băng & bảo vệ

| Ai | Task |
|---|---|
| **Cả nhóm** | **Đóng băng tính năng từ thứ Hai.** Chỉ sửa lỗi. |
| **A** | Diễn tập demo luồng tiền; chuẩn bị trả lời câu hỏi kiến trúc |
| **B+F** | Deploy production; theo dõi |
| **C+D** | Sửa lỗi qua EAS Update (OTA, không cần build lại) |
| **E** | Hoàn thiện báo cáo, sơ đồ, tài liệu |
| — | **2 ngày cuối để trống làm dự phòng.** Luôn có việc phát sinh. |

### 9.9 Phụ thuộc — ai chặn ai

```
Tuần 0 (move + openapi + mock)
   │  ← chặn TẤT CẢ. Không xong thì không ai bắt đầu được.
   ├──────────────┬──────────────┬───────────────┐
   ▼              ▼              ▼               ▼
A: Ledger    B: Redis/R2    C+D: nền app     E: web v1
   │              │              │
   ▼              ▼              ▼
A: nạp/thanh   B: worker    C: mua  D: bán
toán qua ledger                │        │
   │                           ▼        ▼
   ▼                     C: checkout ──┐
A: escrow + phí ─────────────────────► │  ← D chờ A xong escrow
   │                                   │     mới làm được ví
   ▼                                   ▼
A: rút tiền + đối soát ──────────► D: ví + rút tiền
```

**Đường găng: A.** Nếu A chậm thì D bị chặn ở tuần 4. Giảm rủi ro bằng cách A làm ledger **trước tiên và không làm gì khác** trong tuần 1, và A không nhận thêm task giao diện suốt cả 6 tuần.

---

## 10. Rủi ro & thứ tự cắt scope

### 10.1 Đánh giá thẳng thắn

6 tuần cho 28 màn hình + viết lại lõi tiền + hạ tầng scale là **căng**. Kế hoạch này kịp nếu và chỉ nếu:

- Tuần 0 xong đúng trong 2 ngày (nếu trượt sang cả tuần, mọi thứ đổ theo),
- C và D thực sự code song song được nhờ mock server,
- không ai thêm tính năng mới sau Tuần 3.

### 10.2 Thứ tự cắt khi chậm tiến độ

Cắt theo đúng thứ tự này, từ trên xuống:

| Ưu tiên cắt | Bỏ gì | Mất gì |
|---|---|---|
| 1 | k6 và biểu đồ so sánh tải | Ít số liệu cho báo cáo, không ảnh hưởng sản phẩm |
| 2 | iOS — chỉ làm Android | Không mất gì cho đồ án |
| 3 | Offline cache | App cần mạng mới mở được |
| 4 | Gộp màn `seller/transactions` vào `seller/wallet` | Bớt 1 màn |
| 5 | Gộp `seller/dashboard` vào tab hồ sơ | Bớt 1 màn |
| 6 | Chat trên app (tạm đẩy về web) | Bớt 2 màn, nhưng mất điểm trải nghiệm |

**Tuyệt đối không cắt:** ledger, transaction, idempotency, job đối soát. Đó là toàn bộ lý do tồn tại của kế hoạch này. Một app đẹp mà cộng sai tiền thì tệ hơn hẳn một app xấu mà cộng đúng.

### 10.3 Các rủi ro khác

| Rủi ro | Xác suất | Giảm thiểu |
|---|---|---|
| Move thư mục làm hỏng gì đó | Thấp | TypeScript bắt hết; commit riêng nên revert được ngay |
| Webhook PayOS không về được máy dev | **Cao** | Dùng ngrok từ ngày đầu; ghi lại payload mẫu để test lại offline |
| Deep link về app không chạy trên một số máy Android | Trung bình | Luôn có màn hình "Tôi đã thanh toán → kiểm tra lại", không phụ thuộc hoàn toàn deep link |
| VPS hết RAM khi chạy 3 API + MySQL + Redis | Trung bình | Đặt `mem_limit` cho từng container; chỉnh `innodb_buffer_pool_size` |
| Một thành viên biến mất giữa chừng | Trung bình | Ranh giới context rõ nên bàn giao được; không ai giữ độc quyền một vùng kiến thức |

---

## 11. Phụ lục

### 11.1 Thư viện cần thêm

**Backend**
```
@keyv/redis  ioredis  @nest-lab/throttler-storage-redis
@socket.io/redis-adapter  @aws-sdk/client-s3  bullmq
nestjs-pino  pino-http  @sentry/node
-D eslint-plugin-boundaries  @stoplight/prism-cli
```

**Frontend web**
```
@tanstack/react-query
-D openapi-typescript  orval
```

**Mobile**
```
expo  expo-router  nativewind  @tanstack/react-query  zustand
expo-secure-store  expo-image  expo-image-picker  expo-image-manipulator
expo-notifications  expo-web-browser  socket.io-client
react-hook-form  zod  @sentry/react-native
```

### 11.2 Biến môi trường mới

```bash
# Redis
REDIS_HOST=redis
REDIS_PORT=6379

# Cloudflare R2
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=zoldify-media
CDN_BASE_URL=https://cdn.zoldify.vn      # KHÔNG bao giờ ghép từ req.get('host')

# Ledger
PLATFORM_FEE_PERCENT=5                    # giá trị khởi tạo, sau đọc từ bảng settings

# Mobile
EXPO_PUBLIC_API_URL=https://api.zoldify.vn/api/v1
APP_DEEP_LINK_SCHEME=zoldify
```

### 11.3 Các quyết định kiến trúc cần ghi thành ADR

1. Modular monolith thay vì microservices — và điều kiện nào thì tách
2. Sổ cái kép thay vì cột số dư
3. BIGINT đơn vị đồng thay vì DECIMAL
4. Contract-first với OpenAPI, không dùng monorepo
5. Expo managed workflow thay vì bare React Native
6. Cloudflare R2 thay vì tự vận hành MinIO
7. Caddy thay vì Nginx

### 11.4 Những gì cố ý KHÔNG làm

Ghi lại để về sau không ai tưởng là bỏ sót:

| Không làm | Lý do |
|---|---|
| Microservices | Ranh giới module đúng thì tách lúc nào cũng được |
| Monorepo (pnpm/Turborepo) | Vài ngày cấu hình, cả team học lại — để sau deadline |
| Prometheus + Grafana | 2-3 ngày, mà biểu đồ sẽ phẳng lì ở quy mô đồ án |
| Kubernetes | 1 VPS thì Docker Compose là đúng công cụ |
| Ghi offline trên app | Kéo theo giải quyết xung đột và hàng loạt ca biên |
| Unit test cho component UI | Thời gian đó đổi lấy giá trị lớn hơn ở chỗ khác |
| Elasticsearch | MySQL fulltext đã đủ ở quy mô này |
| Nhúng form thẻ trong app | Vướng chính sách store và kéo PCI-DSS vào phạm vi |
