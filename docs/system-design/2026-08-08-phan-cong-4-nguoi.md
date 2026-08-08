# Zoldify — Chia việc cho nhóm 4 người

> Thay cho §7 của `2026-08-06-capstone-delivery-plan.md`, vốn viết cho **5 vai trò**.
> Nhóm có **4 người**, nên phải gộp vai và cắt bớt phạm vi — mục 1 nói thẳng cắt bao nhiêu.
>
> Bảng tuần ở mục 5 được viết đúng theo cột của **chương V "Task Assignment"** trong mẫu
> báo cáo (STT · tên task · mô tả · ngày bắt đầu · ngày kết thúc · thành viên · tự đánh giá).
> Chép sang Word là xong chương đó, không phải viết lại.

## Điền tên trước khi phát

| Mã | Tên thật | Vai trò |
|---|---|---|
| **A** | Đặng Tiến Đạt | Lead · Money · Bảo mật backend |
| **B** | _(điền)_ | Platform · DevOps · Backend nghiệp vụ |
| **C** | _(điền)_ | Mobile — nền app + người mua |
| **D** | _(điền)_ | Mobile — người bán + Web + QA |

---

## 1. Ngân sách: thiếu khoảng 30%, phải cắt trước chứ không cắt lúc cháy

| | Ngày công |
|---|---|
| Khối lượng theo kế hoạch gốc | ≈ 75 |
| 4 người × 5,5 tuần × 5 ngày, trên giấy | 110 |
| Thực tế còn học môn khác — lấy 45-50% | **≈ 50-55** |
| **Thiếu** | **≈ 20-25 ngày công** |

Kế hoạch cũ tính cho 5 người và đã "vừa khít". Bớt một người là **thiếu gần một phần
ba**. Không có cách nào làm đủ 75 ngày công bằng 52 ngày, nên phải cắt ngay từ hôm nay
— cắt sớm thì còn chọn được cắt gì, cắt muộn thì thứ rơi ra là thứ đang làm dở.

### Cắt ngay từ đầu (≈ 21 ngày công)

| Cắt gì | Tiết kiệm | Vì sao chịu được |
|---|---|---|
| Chứng minh scale ngang: 3 bản sao API + đo tải k6 | 2 | Không có trong rubric. Vẫn **giữ** phần stateless hoá vì nó là dòng "caching" trong rubric |
| App người bán rút còn 5 màn lõi (đăng bán · sửa/xoá · đơn bán · ví chỉ xem · chat) | 5 | Người bán vẫn có đường làm việc trên web. Bảo vệ chỉ cần **một** luồng bán chạy được trên app |
| Offline cache cho app | 1 | Không có trong rubric, và dễ sinh lỗi trạng thái cũ đúng lúc demo |
| Màn admin mới trên app | 2 | Admin đã có sẵn trên web, dùng web mà demo |
| Bộ e2e đầy đủ → 1 kịch bản e2e luồng tiền + smoke checklist tay | 3 | Thầy hỏi "có unit test không" — trả lời bằng 6 test ledger trên MySQL thật, mạnh hơn một đống e2e nông |
| Bảng đặc tả use case: 17 → 10 use case chính, 7 cái phụ ghi gọn | 3 | Vẫn thừa số trang, và chương này vốn là chương ngốn thời gian nhất |
| Sửa/hoàn thiện giao diện web ngoài luồng chính (7 đợt redesign) | 5 | Web đang chạy được. Đẹp thêm không đổi điểm nào |

**Còn lại ≈ 54 ngày công cho ≈ 52 ngày có thật.** Vẫn sát, nhưng sát khác với thiếu.

### Ba thứ KHÔNG được cắt, dù chậm cỡ nào

1. **Lõi tiền chạy đúng** — đây là thứ phân biệt Zoldify với một trang bán hàng bài tập.
2. **Website chạy trên domain thật có SSL, app gọi được API đó** — mục 3 thông báo capstone.
3. **Báo cáo ≥ 50 trang toàn tiếng Anh đúng mẫu** — mục 8: không đạt thì không được bảo vệ.

---

## 2. Bốn vai trò

### A — Lead · Money · Bảo mật backend  ·  *đường găng*

Sở hữu toàn bộ thứ gì đụng tới tiền: ledger, escrow, thanh toán, rút tiền, đối soát.
Cộng thêm các lỗ hổng phân quyền ở backend.

**A không nhận một task giao diện nào trong suốt 5 tuần.** Lý do: mọi việc của C và D
ở tuần 3-4 đều chờ escrow và ví chạy đúng. Người ở trên đường găng mà bị kéo đi làm
việc khác thì cả nhóm đứng.

Đã xong: `LedgerService.post()` + 3 bảng + 6 test trên MySQL thật.

### B — Platform · DevOps · Backend nghiệp vụ

Hai nhóm việc rất khác nhau nhưng cùng một người vì cùng đụng backend không phải tiền:

- **Hạ tầng**: Redis, R2, tách worker, Docker Compose, CI/CD, domain + SSL, backup.
- **Nghiệp vụ**: GHN, gợi ý sản phẩm, tồn kho real-time (hai cái sau là điểm Level 3).

**Việc gấp nhất của B là domain + DNS, làm trong 48 giờ tới**, vì DNS lan truyền mất
24-48 tiếng và mọi thứ deploy đều chờ nó.

### C — Mobile: nền app + luồng người mua

Dựng nền chung (Expo Router, NativeWind, TanStack Query, TokenStore, refresh token)
rồi làm hết luồng mua: trang chủ, tìm kiếm, chi tiết sản phẩm, giỏ, thanh toán, đơn mua.

**C cũng là người giữ iPhone và kiểm iOS.** Kiểm ngay tuần 1 bằng Expo Go, không đợi
tuần 5 — phát hiện sớm mới còn đường lùi.

### D — Mobile người bán · Web · QA

Vai nặng nhất về bề rộng, nhẹ nhất về độ sâu. Sau khi C dựng xong nền app ở tuần 1,
D nhánh ra làm phần người bán, đồng thời giữ cho web không chết trong lúc backend đổi
sang `/api/v1`.

D cũng là người chạy smoke checklist trước mỗi lần deploy.

---

## 3. Vì sao bốn người không giẫm chân nhau: hợp đồng trước, code sau

Đây là câu trả lời cho *"làm sao chia việc khi chưa có khung"*. Không phải chia theo
tệp — chia theo **hợp đồng**.

```
                    openapi.json  (một tệp, A và B sinh ra)
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
   Prism mock         Web client        Mobile client
   :4200              gen từ schema     gen từ schema
        │                 │                 │
     C và D code từ ngày đầu, không chờ backend chạy xong
```

Ba luật giữ cho việc này không vỡ:

1. **`openapi.json` là hợp đồng, không phải tài liệu.** Nó nằm trong git. CI kiểm
   `openapi:check` — ai đổi API mà quên sinh lại thì CI đỏ.
2. **Sửa hợp đồng phải báo trước.** Đổi trường trong DTO là đổi cả web lẫn app. Nhắn
   nhóm trước khi merge, đừng để người khác phát hiện bằng lỗi lúc chạy.
3. **C và D code với Prism mock, không chờ MySQL.** `npm run mock` dựng server giả từ
   chính `openapi.json`. Backend chậm một tuần cũng không chặn app.

**Ranh giới trong backend do máy canh.** `eslint-plugin-boundaries` chặn `ordering`
gọi thẳng repository của `money`. Nếu B lỡ tay import `LedgerAccount` vào
`orders.service.ts`, CI sẽ đỏ chứ không cần ai đi review bắt lỗi. Mốc hiện tại là
**29 vi phạm cũ**, chỉ được giảm, không được tăng.

---

## 4. Việc trong 48 giờ tới

Mọi thứ ở đây chặn phần còn lại. Xong sớm ngày nào lãi ngày đó.

| Ai | Việc | Vì sao gấp |
|---|---|---|
| **A** | Mời thầy + 3 bạn vào Trello, họp kickoff, chốt quy ước Git | Backend hiện có commit của **đúng một người**. Điểm hợp tác chấm theo biểu đồ hoạt động từng thành viên |
| **A** | Chặn `PATCH /orders/:id/status` theo vai trò (2 giờ) | Lỗ hổng: ai xem được đơn cũng tự nhả tiền cho mình |
| **B** | Trỏ DNS `zoldify.com` về VPS | Lan truyền 24-48h, deploy chờ cái này |
| **B** | Dựng `.github/workflows/ci.yml`: lint · boundaries · test · build · `openapi:check` · `diagrams:check` | Chưa có CI nào. Không có CI thì không ai biết mình vừa làm hỏng cái gì |
| **C** | Cài Expo Go lên iPhone, chạy thử app hiện tại, thử push notification | Nếu iOS có vấn đề thì phải biết **hôm nay**, không phải tuần 5 |
| **D** | Đọc 25 sơ đồ, đối chiếu với web đang chạy, ghi lại chỗ nào sơ đồ sai | Sơ đồ sai đi vào báo cáo thì sửa rất muộn |
| **Cả nhóm** | Mỗi người tự tạo nhánh và đẩy một commit thật | Chứng minh quy ước Git chạy được, trước khi có việc gấp |

### Quy ước Git chốt luôn, không bàn lại

```
main       ← chỉ nhận merge từ develop, là thứ đang chạy production
develop    ← nhánh tích hợp
feat/<mã>-<mô-tả-ngắn>     ví dụ feat/A-ledger-escrow-release
fix/<mã>-<mô-tả-ngắn>
```

- Mỗi PR phải có **một người khác** duyệt. Không tự merge PR của mình.
- Commit message tiếng Việt cũng được, nhưng phải nói **làm gì**, không phải "update", "fix bug".
- **Mọi người phải có commit mỗi tuần.** Đây là điểm chấm, không phải lời khuyên.

---

## 5. Bảng tuần — chép thẳng vào chương V báo cáo

Cột "Tự đánh giá" để trống, mỗi người tự điền lúc viết báo cáo.

### Tuần 1 · 10/08 – 16/08 · nền móng

| # | Task | Mô tả | Bắt đầu | Kết thúc | Ai |
|---|---|---|---|---|---|
| 1 | Role check trên đổi trạng thái đơn | Chỉ người mua của đơn hoặc admin được đặt `delivered`; thêm bảng chuyển trạng thái hợp lệ | 10/08 | 11/08 | A |
| 2 | Khoá tồn kho khi đặt hàng | `SELECT ... FOR UPDATE` trong `orders.create`, chặn kho về âm | 11/08 | 12/08 | A |
| 3 | Nạp ví qua ledger | Chuyển topup sang `LedgerService.post()` | 12/08 | 14/08 | A |
| 4 | CI backend | lint · boundaries · test · build · openapi:check · diagrams:check | 10/08 | 11/08 | B |
| 5 | Redis hoá cache, throttler, socket | Bỏ trạng thái trong RAM tiến trình; hạ `connectionLimit` 50→15 | 11/08 | 14/08 | B |
| 6 | Docker Compose | mysql · redis · api · worker · caddy, có `mem_limit` | 14/08 | 16/08 | B |
| 7 | Nền app dùng chung | Expo Router · NativeWind · TanStack Query · TokenStore · refresh single-flight | 10/08 | 14/08 | C+D |
| 8 | Đăng nhập / đăng ký / quên mật khẩu trên app | Theo AD-01 | 14/08 | 16/08 | C |
| 9 | Kiểm iOS bằng Expo Go | Chạy app trên iPhone thật, thử push, ghi lại cái gì không chạy | 10/08 | 11/08 | C |
| 10 | Web sang `/api/v1` | Đổi base URL, thay `any` bằng type sinh từ OpenAPI | 14/08 | 16/08 | D |

### Tuần 2 · 17/08 – 23/08 · tiền vào, app hình thành

| # | Task | Mô tả | Bắt đầu | Kết thúc | Ai |
|---|---|---|---|---|---|
| 11 | Webhook PayOS vào một transaction | Bỏ `payos_webhook_log`, dùng `idempotency_key`; theo AD-02 ô W3-W8 | 17/08 | 20/08 | A |
| 12 | Thanh toán đơn qua ledger | `gateway_clearing → escrow_hold` | 20/08 | 23/08 | A |
| 13 | Upload ảnh sang R2 | URL lấy từ `CDN_BASE_URL`, bỏ ghép từ `req.get('host')` | 17/08 | 19/08 | B |
| 14 | Tách tiến trình worker | BullMQ + cron ra khỏi API, nếu không cron tiền chạy N lần | 19/08 | 21/08 | B |
| 15 | Gợi ý sản phẩm | SQL trên bảng `interactions` đã có, không cần ML — **điểm Level 3** | 21/08 | 23/08 | B |
| 16 | Trang chủ + tìm kiếm + lọc trên app | | 17/08 | 20/08 | C |
| 17 | Chi tiết sản phẩm + trang shop trên app | | 20/08 | 23/08 | C |
| 18 | Đăng bán trên app | Chụp ảnh + **nén trước khi upload** — ảnh 12MP qua 4G là trải nghiệm tệ nhất | 17/08 | 20/08 | D |
| 19 | Google OAuth trên web | Rubric ghi đích danh "OAuth" — **điểm Level 3** | 20/08 | 23/08 | D |
| 20 | Viết chương I + II báo cáo | Dùng AD-01..04 đã có | 21/08 | 23/08 | D |

### Tuần 3 · 24/08 – 30/08 · escrow, deploy thật

| # | Task | Mô tả | Bắt đầu | Kết thúc | Ai |
|---|---|---|---|---|---|
| 21 | Escrow giải ngân + hoàn tiền qua ledger | Cộng phí sàn đọc từ `settings`; theo AD-03 | 24/08 | 27/08 | A |
| 22 | Xoá cột `users.balance` | Bỏ nguồn sự thật thứ hai về số dư | 27/08 | 28/08 | A |
| 23 | Cron tự giải ngân sau 3 ngày | AD-03 ô T4 — chống tiền kẹt vĩnh viễn | 28/08 | 30/08 | A |
| 24 | **Deploy production + SSL + CD** | Domain thật, Caddy tự lo TLS, backup mysqldump hằng ngày | 24/08 | 27/08 | B |
| 25 | Diễn tập khôi phục backup | Backup chưa từng restore thử thì không phải backup | 27/08 | 28/08 | B |
| 26 | Webhook GHN + tồn kho real-time | AD-03 ô T3 · **điểm Level 3** | 28/08 | 30/08 | B |
| 27 | Giỏ hàng + thanh toán + WebView PayOS trên app | Deep link `zoldify://payment/return` chỉ để điều hướng | 24/08 | 28/08 | C |
| 28 | Nút "Đã nhận hàng" trên app | AD-03 ô T2 — hiện **không nơi nào** gửi `delivered` | 28/08 | 29/08 | C |
| 29 | Đơn bán + xử lý đơn trên app | | 24/08 | 28/08 | D |
| 30 | Nút "Đã nhận hàng" trên web | AD-03 ô T2 | 28/08 | 29/08 | D |

**Cổng ra tuần 3:** website chạy trên `zoldify.com` có SSL, app gọi được API đó. Nếu
tuần 3 chưa qua cổng này thì dừng làm tính năng, dồn cả nhóm vào deploy.

### Tuần 4 · 31/08 – 06/09 · ví, rút tiền, AI

| # | Task | Mô tả | Bắt đầu | Kết thúc | Ai |
|---|---|---|---|---|---|
| 31 | Rút tiền 2 bước qua ledger | Theo AD-04 | 31/08 | 03/09 | A |
| 32 | Job đối soát mỗi giờ | `SUM(entries) = 0` và mỗi account khớp tổng entry của nó → cảnh báo khi lệch | 03/09 | 04/09 | A |
| 33 | Viết chương về nghiệp vụ tiền | Dùng AD-02..04 + CD-02 | 04/09 | 06/09 | A |
| 34 | Rà bảo mật + đóng băng `openapi.json` v1 | CORS websocket, rate limit, thang lỗi | 31/08 | 02/09 | B |
| 35 | Trang admin đối soát ledger | Tổng đang giữ hộ · số dư hệ thống · kết quả job đối soát | 02/09 | 06/09 | B |
| 36 | Chi tiết đơn + theo dõi GHN + thông báo trên app | | 31/08 | 04/09 | C |
| 37 | Hồ sơ + sổ địa chỉ trên app | | 04/09 | 06/09 | C |
| 38 | Ví người bán (chỉ xem) + chat + push trên app | Tách rõ khả dụng và đang giữ hộ | 31/08 | 04/09 | D |
| 39 | AI chat support | **Điểm sáng tạo** — rẻ nhất trong các mục Level 3 | 04/09 | 06/09 | D |
| 40 | Đa ngôn ngữ VI/EN | `next-intl` cho web, `i18n-js` cho app | 31/08 | 02/09 | D |

### Tuần 5 · 07/09 – 13/09 · đóng băng và viết

**Đóng băng tính năng từ 08/09. Từ đó chỉ sửa lỗi.**

| # | Task | Mô tả | Bắt đầu | Kết thúc | Ai |
|---|---|---|---|---|---|
| 41 | Sửa lỗi lõi tiền + hỗ trợ phản biện | | 07/09 | 13/09 | A |
| 42 | **Ghép báo cáo ≥ 50 trang, toàn tiếng Anh, đúng định dạng** | A4 · Arial 12pt · lề · header/footer · bìa xanh · in một mặt | 09/09 | 13/09 | A |
| 43 | Bảng test case theo `TestCaseTemplate.xlsx` | | 07/09 | 09/09 | B |
| 44 | Chương VI Installation Instructions | Dùng sơ đồ deployment #4 | 09/09 | 11/09 | B |
| 45 | EAS Build ra APK + kiểm lại trên iPhone | | 07/09 | 09/09 | C |
| 46 | Trạng thái rỗng / lỗi / loading cho mọi màn app | Thứ lộ ra ngay khi demo mà mạng chậm | 09/09 | 11/09 | C |
| 47 | Bảng đặc tả 10 use case chính | Chương nặng nhất, riêng nó ~15 trang | 07/09 | 11/09 | D |
| 48 | Dựng 14 slide, chèn ảnh sơ đồ từ `diagrams:export` | Slide 13 đặt sơ đồ dòng tiền | 11/09 | 13/09 | D |
| 49 | Tổng duyệt thử buổi bảo vệ | Chạy hết kịch bản demo trên máy thật, bấm giờ | 13/09 | 13/09 | Cả nhóm |

**14/09 – 15/09 không xếp việc.** Luôn có phát sinh.

---

## 6. Ai viết chương nào

Không có người chuyên viết tài liệu — 4 người thì không đủ. Nên **mỗi người viết chương
về phần mình làm**, một người ghép. Cách này cũng cho chất lượng tốt hơn: người viết
đúng là người biết vì sao lại làm thế.

| Chương | Ai viết | Nguồn sẵn có |
|---|---|---|
| I. Project Introduction | D | Design doc §1-2 · sơ đồ C4 #1 |
| II. Analyze System Requirements | D (đặc tả) · A (activity) | Sơ đồ #14 · **AD-01..04** |
| III. Design Details | A (class, sequence) · B (ERD, bảng cột) | **CD-01..03** · sơ đồ #5,6,8-11 |
| IV. Test | B | 6 test ledger · `TestCaseTemplate.xlsx` |
| V. Task Assignment | A | **Mục 5 của chính tài liệu này** |
| VI. Installation Instructions | B | Sơ đồ #4 · Docker Compose |
| Appendix | D | Design doc §10-11 |
| **Ghép + dịch + định dạng** | **A** | |

Ai viết xong chương nào thì đẩy lên git chương đó, đừng gửi file Word qua Zalo. Mất
bản là mất thật, và điểm hợp tác chấm theo biểu đồ hoạt động git.

---

## 7. Thứ tự cắt khi chậm tiến độ

Cắt từ trên xuống. Không cắt nhảy cóc, không tranh luận lại lúc đang cháy.

1. AI chat support
2. Đa ngôn ngữ trên **app** (giữ trên web)
3. Gợi ý sản phẩm
4. Tồn kho real-time
5. Ví người bán trên app → chỉ còn trên web
6. Chat trên app → chỉ còn trên web
7. Google OAuth

**Dưới vạch này thì không cắt nữa** — cắt tiếp là rơi xuống Level 2:

- Lõi tiền chạy đúng
- Deploy thật có domain và SSL
- App chạy trên cả Android và iOS
- Báo cáo ≥ 50 trang tiếng Anh đúng mẫu

---

## 8. Báo cáo thứ Bảy hằng tuần

Mục 6 thông báo capstone: không báo cáo thì không được bảo vệ. Mẫu ngắn, gửi vào nhóm
Zalo có thầy:

```
Zoldify — Tuần <n> (<ngày> – <ngày>)

Đã xong:
- A: ...
- B: ...
- C: ...
- D: ...

Đang làm dở: ...
Vướng: ...
Tuần tới: ...
Link demo: https://zoldify.com
```

A gửi. Mỗi người nhắn phần mình cho A trước tối thứ Sáu.
