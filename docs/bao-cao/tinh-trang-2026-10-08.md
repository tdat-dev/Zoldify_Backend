# Tình trạng công việc — 08/10/2026

> **Mục đích của file này**: mở cuộc trò chuyện mới mà không phải nạp lại cả
> lịch sử. Đọc file này + `CLAUDE.md` + `docs/BAN-GIAO.md` là đủ để tiếp tục.
>
> Nhánh đang làm: **`feat/task-26b-ton-kho-realtime`** — 14 commit sau
> `merge/staging-07-10` (nhánh đó đi trước `origin/staging` 44 commit, nên tổng
> cộng 58). **Chưa push, chưa mở PR.** Cây làm việc sạch, không file nào
> untracked.

---

## 1. Việc #26b — tồn kho real-time: XONG

Đây là ô rubric Level 3 cuối cùng còn trống. Nghiệm thu bằng chính bài kiểm đã
viết ở bước 3, không phải bằng một bài kiểm viết sau.

| Commit | Nội dung |
|---|---|
| `4794ee1` | 5 ca cho sự kiện tồn kho — chạy và xác nhận ĐỎ trước khi viết mã |
| `18db2d6` | `StockEventsService` + `StockGateway` — 5 ca từ đỏ sang xanh |
| `f791bb4` | Đấu dây: api nhận cả hai nửa, worker chỉ nửa PHÁT |
| `8306369` | Đấu dây ba chỗ đổi kho: đặt hàng · huỷ đơn · `updateStock` |
| `f3a4106` | Cổng đầu-cuối `npm run check:stock` |
| `4ffbd2e` | Vá 6 chỗ tự `new` service còn lại — `check:cache` đang đỏ vì nó |

### Ba file mã chính

- `src/catalog/stock/stock-events.service.ts` — bên PHÁT. `phat()` **không bao
  giờ throw**; `redis` null thì về sớm kèm một cảnh báo duy nhất. Xuất
  `REDIS_PHAT`, `KENH_TON_KHO`, `interface TinTonKho`.
- `src/catalog/stock/stock.gateway.ts` — bên NHẬN. Namespace `/stock`, phòng
  `product_<id>`. `nhanTuRedis()` để public cho dễ kiểm, và không bao giờ throw.
- `src/catalog/stock/stock.module.ts` — cấp `REDIS_NHAN` là **kết nối riêng**.
  Chỉ `AppModule` import nó; worker không có socket server.

### Vì sao phải hai kết nối Redis

Một kết nối đã vào chế độ subscribe thì chỉ còn nhận được lệnh
subscribe/unsubscribe. Dùng chung một kết nối sẽ nổ *"Connection in subscriber
mode, only subscriber commands may be used"*. Bên phát đặt
`enableOfflineQueue:false` + `maxRetriesPerRequest:1`; bên nhận **cố ý không** —
ioredis tự kết nối lại và tự gửi lại SUBSCRIBE.

### Ba chỗ gọi `phat()`, và chỗ đặt nó quan trọng

- `orders.service.ts` dòng 599 — lúc đặt hàng, trong vòng `for` đọc lại kho.
- `orders.service.ts` dòng 1784 — `applyCancellation`, phát **sau khi
  transaction đã đóng**. Đây là chỗ duy nhất worker cũng chạy.
- `products.service.ts` dòng 714 — trong `updateStock`, đặt **sau**
  `findOneOrFail` đọc lại dòng, nên nó phát `moi.stock` (con số thật sau UPDATE)
  chứ không phải `stock` mà người gọi muốn — khoá lạc quan có thể đã từ chối nó.

---

## 2. Lượt nghiệm thu cuối — bản ghi tại `5fe4efa`

```
DB_PORT=3307 DB_PASSWORD=testpw npm run nghiem-thu
```

**16 PASS · 1 FAIL · 1 BỎ QUA · cây làm việc sạch PASS.** Kết luận của file là
**HỎNG** vì còn một cái đỏ thật — đúng như nó phải vậy, không chỉnh gì để nó
xanh giả. Bản ghi committed ở `7f2f829`; số đo đầy đủ nằm trong `nghiem-thu.md`.

Đáng chú ý: `check:stock` **xanh 22 mục**, `test` 51/51 suite · 332/332 bài,
`lint:check` nợ 521 đúng mốc 521, `openapi:check` 107 route · 66 schema.

### Hai thứ còn lại, không cái nào thuộc #26b

| Cổng | Trạng thái | Vì sao |
|---|---|---|
| `check:drift` | ❌ FAIL | 7 dòng lệch: migration `push_tokens` của Đạt + `addresses.is_default`. Lược đồ là phần của Đạt. Đã ghi trong `docs/bao-cao/soat-ban-hoa-cho-dat.md`, **đang chờ Đạt trả lời** `CreatePushTokens` đã chạy trên api-staging chưa |
| `check:core` | ⊘ BỎ QUA | Thiếu môi trường, không thiếu mã. Cổng đòi ≥ 500k đơn (`scripts/selfcheck.ts:91-93`); con số đó thuộc `zoldify_bulk_test`, không phải `zoldify_dev`. Cách dựng: `docs/BAN-GIAO.md` mục 6, `seed:bulk` |

---

## 3. Bốn thứ đã ĐO trong đợt này — đừng suy lại từ đầu

### 3.1. ts-jest KHÔNG báo TS2554, ts-node thì BÁO

Thiếu đối số constructor mới, **cùng một dòng mã, hai công cụ trả lời khác
nhau**: `npm test` xanh còn `check:cache` đỏ. Đo 07/10: 4 spec chạy xanh với
`this.stockEvents === undefined`. `npm run build` mù cả hai vì
`tsconfig.build.json` loại trừ **cả** `scripts/` **lẫn** `*.spec.ts`.

Chỉ một lệnh thấy hết: `npx tsc --noEmit -p tsconfig.json`.

Dùng chính nó để chứng minh không gây thiệt hại kèm theo: **12 lỗi tại HEAD cũ →
6 lỗi**, và `comm` hai chiều cho thấy đúng 6 đích đã vá, **0 lỗi mới**.

### 3.2. Mười chỗ tự `new` service cần stub

```ts
const khoPhat = { phat: () => Promise.resolve() } as never;
```

`resolve` chứ không `reject`: cả ba chỗ gọi đều `await` nó, và chúng nằm ngay
sau khi transaction đã commit. **`stockEvents` là đối số CUỐI** trong cả hai
constructor (`orders.service.ts` thứ 14, `products.service.ts` thứ 6) — lần đầu
tôi chèn sai vị trí và chỉ bắt được nhờ đọc diff trước khi build.

### 3.3. Ca đối chứng tìm ra BA lỗ xanh giả do chính tôi viết

Bước 3 của `CLAUDE.md` không phải hình thức. Comment mã ra để xem bài kiểm có
chuyển đỏ không đã lộ:

1. `selfcheck-stock.ts` — mục "database khớp" so với **hằng số**, nên PASS trong
   khi đang in `phát=undefined`.
2. `selfcheck-stock.ts` — bộ đếm chỗ gọi khớp cả **mã đã comment**. Phải bóc
   comment trước khi đếm.
3. `canDbBulk()` trong `nghiem-thu.ts` — chưa chứng minh được là nó đọc DB thật.

Lỗ 3 chứng minh xong bằng **bốn ca, bốn kết quả khác nhau**:

| Ca | Kết quả |
|---|---|
| DB không có bảng `orders` | `chưa có bảng orders` |
| `zoldify_dev` (1 đơn) | `chỉ có 1 đơn` |
| bảng dựng tay 3 dòng | `chỉ có 3 đơn` |
| view 1.000.000 dòng | **KHÔNG bỏ qua** — cổng chạy thật (FAIL exit 2) |

Ca thứ tư đáng kể nhất: nó chứng minh hàm **còn biết trả về `null`**. Một điều
kiện chỉ biết nói "bỏ qua" thì bằng xoá cổng đi.

### 3.4. `check:stock` đã chứng minh được là CHUYỂN ĐỎ ĐƯỢC

Theo hai đường độc lập. Nó dựng app thật, mở hai socket client thật, gọi
`PATCH /api/v1/products/:id/stock` bằng token người bán thật, rồi khẳng định
socket nhận đúng con số — qua Redis thật. Có ca đối chứng phân biệt được "bên
phát hỏng" với "bên nhận hỏng": client ở phòng khác không nhận gì, rồi một lệnh
`publish` trực tiếp vào phòng của nó chứng minh nó vẫn sống.

---

## 4. Bẫy môi trường trên máy này

- **`.env` trỏ tới MySQL không gọi được.** Đừng sửa `.env` — đó là cấu hình máy.
  Mọi lượt chạy dùng biến môi trường đè: `DB_PORT=3307 DB_PASSWORD=testpw`.
- **Docker Desktop chết hai lần giữa đợt.** Lần hai mất hẳn tiến trình và 12
  cổng báo BỎ QUA. Khởi động lại rồi **đợi `mysqladmin ping` thật**, đừng
  `sleep` một con số cố định. Không kết luận gì từ lượt chạy đã suy biến.
- **Máy không có Python.** Script tạm thì viết `.mjs` chạy bằng node.
- **Mọi file trong repo là CRLF.** Script vá file phải chuẩn hoá CRLF→LF trong
  bộ nhớ, sửa, rồi ghi lại đúng kiểu xuống dòng ban đầu. Đã dính hai lần.
- **`$?` sau pipe là mã thoát của lệnh CUỐI.** `npm run check:stock | tail` báo
  `EXIT=0` cho một cổng đang đỏ. Đo lại bằng `>/dev/null 2>&1; echo $?`.
- `node -e` làm méo backtick. Cần backtick trong template literal thì ghi bằng
  công cụ ghi file, hoặc `String.fromCharCode(96)`. Và đường dẫn kiểu
  `/c/Users/...` truyền vào script node sẽ thành `C:\c\Users\...`.

---

## 5. Việc tiếp theo — chọn theo HẠN, không theo mức dễ

Bảng đầy đủ: `docs/BAN-GIAO.md` mục 9. Đang nổi lên:

| Việc | Ghi chú |
|---|---|
| **Báo cáo ≥50 trang (tiếng Anh) · slide · `TestCaseTemplate.xlsx`** | **Cả ba đang ở số 0.** Dàn ý có sẵn: `docs/bao-cao/dan-y-bao-cao-50-trang.md`. Đây là thứ duy nhất không cổng nào gác được, mà lại là thứ chấm điểm |
| Task **6** — nhiều tiến trình api + `caddy` + `mem_limit` | **quá hạn 16/08**. CPU bão hoà từ 10 người bấm cùng lúc — thứ duy nhất đẩy trần lên |
| Task **15** — gợi ý sản phẩm | điểm Level 3 |
| B6 — bài kiểm cho `firebase`, `ghn` | giao được cho OpenCode |
| B3 — 3 câu SQL CAO còn lại | |
| B4 — vì sao `sql:audit` không bao giờ xong | |
| M-02 — 73 lỗ npm (44 cao, 2 nghiêm trọng) | |
| Task **35** — trang admin đối soát ledger | |

### Cần Đạt quyết trước khi gộp vào `staging`

1. **13 mục trong `docs/bao-cao/soat-ban-hoa-cho-dat.md`**, nhất là hai quyết
   định ngược nhau và câu hỏi `check:drift` ở mục 2 trên.
2. Promote `staging` → production — chưa từng xảy ra, xung đột đúng 2 file auth.
3. ERD thiếu bảng `push_tokens`.

---

## 6. Luật đang có hiệu lực — đọc trước khi gõ

- **`git push` cần Cường cho phép từng lần.** Đợt này chưa push lần nào.
- `src/money/` và bảo mật là của **Đạt (vai A)**. Viết bài kiểm thì được, sửa
  mã thì không.
- Bánh cóc lint **chỉ được giảm**. Không bao giờ nâng `BASELINE` cho nợ của
  chính mình.
- **Không bao giờ** `rm -rf .git`, `git init`, `reset --hard`, `gc --prune` —
  lịch sử cục bộ đã mất một lần (05/10) và không khôi phục được.
- Không xoá tài liệu cũ; đánh dấu là đã bị thay thế.
- `review_for_claude.md` untracked, **không đẩy lên**.
- `nghiem-thu.md` do máy ghi — **không sửa tay**. Chính file đó nói sửa tay là
  mất giá trị làm bằng chứng.
