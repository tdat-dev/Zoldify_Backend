# Báo cáo Task #5 — bỏ trạng thái trong RAM tiến trình

**Người thực hiện:** Cường · **Ngày:** 2026-08-27 · **Nhánh:** `feat/task-5-redis-state` → PR vào `staging`
**Trạng thái:** XONG phần trạng thái dùng chung (throttler · socket · presence). `connectionLimit` 50→15 nằm ở PR trước. Giới hạn ở mục 7.

## 1. Mục tiêu & bối cảnh

Bảng phân công, task #5, hạn **14/08** — quá hạn 13 ngày:

> Redis hoá cache, throttler, socket · Bỏ trạng thái trong RAM tiến trình; hạ `connectionLimit` 50→15

Cache đã Redis hoá từ Epic 4. Phần còn lại là ba chỗ vẫn giữ trạng thái trong RAM, và
chúng có chung một tính chất khiến chúng nguy hiểm hơn vẻ ngoài:

> **Cả ba đều đúng khi chạy một bản api.** Trên máy dev đúng. Trên CI một tiến trình
> đúng. Chúng chỉ sai khi có bản api thứ hai — và theo sơ đồ deployment, đó chính là
> production (`zoldify-api x3`).

| Chỗ | Hỏng thế nào | Có kêu không |
|---|---|---|
| `ThrottlerModule.forRoot` không khai `storage` | Mỗi bản đếm riêng. Đặt 10 req/s, chạy 3 bản → giới hạn thật là **30** | **Không.** Rate limit vẫn trông như đang hoạt động |
| `server.emit(...)` không có adapter chung | Tin nhắn chỉ tới client nối vào đúng bản đó. Hai người chat, mỗi người một bản, không ai thấy tin của ai | **Không.** Chỉ là im lặng — người dùng nghĩ đối phương không trả lời |
| `onlineUsers` Map (`chat.gateway.ts:26`) | Mỗi bản thấy một danh sách online khác nhau, không bản nào đúng | **Không** |

Không cái nào ném ngoại lệ. Không cái nào ghi log. Đó là lý do chúng sống được tới tuần 4.

## 2. Pre-mortem — Rủi ro & lỗi ẩn dự đoán (TRƯỚC khi sửa)

| # | Mức | Rủi ro | Cách chặn | Kết cục |
|---|---|---|---|---|
| R1 | **CAO** | **Redis chết làm sập cả API.** `ThrottlerGuard` gọi `storage.increment()` ở **mọi** request; storage ném lỗi là mọi request 500. Cắm Redis vào throttler mà không chặn chỗ này thì Redis biến từ thứ phụ trợ thành **điểm hỏng đơn của cả sàn** — tình hình *tệ đi* so với trước khi làm task. | Lớp bọc `ThrottlerStorageFailOpen`: lỗi Redis → cho request đi qua, log có tiết chế. | Đã chặn, **đo được** ở mục 6 |
| R2 | **CAO** | ioredis 6 chưa từng được thử với `@nest-lab/throttler-storage-redis`. | Ghim `ioredis@^5.11.1`. Bằng chứng: ngày phát hành. | Đã ghim; bài test canh |
| R3 | **CAO** | Thay Map bằng **SET trong Redis** thì rò rỉ: bản api bị `kill -9` / hết RAM / bị thay lúc deploy sẽ không kịp `SREM`, userId ở lại "online" vĩnh viễn. Rác tích theo từng lần deploy. | Không dùng SET. `fetchSockets()` hỏi các tiến trình **đang sống** qua adapter — bản api chết thì socket biến mất cùng nó. | Đã tránh |
| R4 | TB | Adapter cần **hai** kết nối Redis. Một client đang `subscribe` không chạy được lệnh khác — dùng chung là hỏng câm. | `sub = pub.duplicate()`. | Đã làm |
| R5 | TB | CI chưa có Redis → bài test mới đỏ. | Thêm `services.redis` + `TEST_REDIS_URL`; bài test tự kiểm điều đó. | Đã làm |
| R6 | TB | **Giới hạn sẽ siết lại thật.** Hiện 3 bản đếm riêng → giới hạn lỏng gấp 3. Sau thay đổi nó đúng bằng con số đã đặt. | Không đổi con số trong PR này. Ghi rõ để nếu 429 tăng thì biết vì sao. | Xem mục 7 |
| R7 | THẤP | Máy dev không có Redis phải vẫn chạy được. | `REDIS_URL` trống → giữ nguyên in-memory, y hệt cách cache đang làm. | Đã làm |

Ngoài phạm vi nhưng ghi lại: `chat.gateway.ts:20` để `cors: { origin: '*' }` — thuộc task #34.

## 3. Test viết TRƯỚC (đỏ → xanh)

`scripts/selfcheck-redis-state.ts` · `npm run check:redis` · 19 mục.

Chạy lần đầu khi chưa sửa gì: **7 FAIL**.

Điểm quan trọng nhất của thiết kế bài test: **đọc file là không đủ.** Đọc file chỉ chứng
minh mã *có gọi* Redis; nó không chứng minh hai tiến trình thật sự nhìn thấy nhau. Nên
bài test:

- Dựng **hai server socket.io thật** trên cổng 3901 và 3902, mỗi cái một cặp pub/sub riêng.
- Nối một client vào **server B**, rồi phát sự kiện từ **server A**.
- Dựng **hai instance throttler storage** riêng biệt, tăng cùng một khoá, đòi cái thứ hai
  phải thấy số của cái thứ nhất.

Kết quả đáng chú ý ở lần chạy đầu: **phần chạy thật đã xanh ngay**, trong khi phần đọc
file đỏ. Nghĩa là cơ chế (adapter + storage dùng chung Redis) hoạt động thật — trước khi
cắm vào ứng dụng một dòng nào. Việc còn lại chỉ là nối dây, và bài test biết chính xác
dây nào chưa nối.

### Ba lần bài test tự sai

1. **PASS giả.** Kiểm "ThrottlerModule.forRootAsync" ban đầu chỉ tìm chuỗi `forRootAsync`
   trong cả file và báo xanh — trong khi `ThrottlerModule` vẫn là `forRoot` tĩnh. Chuỗi ấy
   có thật, nhưng là của `TypeOrmModule` và `MailerModule`. **Một PASS giả tệ hơn một
   FAIL:** FAIL thì có người đi sửa, PASS giả thì không ai nhìn lại nữa.
2. **Âm tính giả.** Kiểm `createAdapter` dùng `git grep`, mà lệnh đó chỉ tìm trong file đã
   được git theo dõi. File vừa viết xong chưa `git add` thì nó báo "không tìm thấy" — đỏ
   trong khi mã đúng. Kiểu này nguy hiểm theo hướng ngược: nó làm người ta đi sửa một thứ
   không hỏng.
3. **Bỏ sót chính rủi ro nghiêm trọng nhất.** Pre-mortem đã nêu R1, nhưng bản test viết
   trước **không kiểm nó** — bài test có thể xanh trọn vẹn trong khi Redis chết vẫn làm
   sập API. Đã thêm mục 7 chạy thật. *Dự đoán được rủi ro chưa đủ; phải mã hoá nó thành
   phép đo.*

## 4. Đã làm

Bảy commit, mỗi commit một việc:

| Commit | Việc |
|---|---|
| `265aa8d` | Thêm `ioredis@^5.11.1`, `@socket.io/redis-adapter`, `@nest-lab/throttler-storage-redis` |
| `cf0ea4a` | Bài test viết trước — đỏ 7 mục |
| `7e1c931` | Throttler đếm chung qua Redis + `ThrottlerStorageFailOpen` |
| `5656e81` | `RedisIoAdapter` cho Socket.IO + nối vào `main.ts` |
| `0e835ae` | Bài test: quét hệ thống tệp thay vì `git grep` |
| `4507f95` | Bỏ Map `onlineUsers`, presence hỏi cả cụm |
| `d7a6c5e` | `ci.yml`: service redis + cổng `check:redis` |

### Vì sao ghim ioredis ở dòng 5.x

Không phải thận trọng chung chung — có ngày tháng:

```
@nest-lab/throttler-storage-redis@1.2.0   phát hành 2026-02-03
ioredis@5.11.1                            phát hành 2026-06-04
ioredis@6.0.0                             phát hành 2026-07-31
```

Gói storage khai peer `ioredis: >=5.0.0`, nhưng nó ra đời **năm tháng trước** ioredis 6.
Cái dải `>=5.0.0` ấy là một lời hứa được viết trước khi bản 6 tồn tại, không phải kết quả
của một lần thử thật.

### Vì sao presence dùng `fetchSockets()` chứ không phải một SET trong Redis

SET là cách rõ ràng nhất và cũng là cách rò rỉ. Muốn SET đúng thì phải `SREM` lúc socket
đóng — nhưng `kill -9`, OOM, hay container bị thay lúc deploy đều không kịp `SREM` gì cả.
Những userId đó ở lại "online" vĩnh viễn và không có gì tự dọn.

`fetchSockets()` hỏi các tiến trình **đang sống**. Bản api chết thì socket của nó biến mất
cùng nó — không có gì để rò rỉ, không cần dọn, không cần TTL.

Đánh đổi: mỗi lần hỏi là một vòng request/response qua Redis. Chấp nhận được vì nó chỉ
chạy lúc kết nối, lúc ngắt, và khi client xin ảnh chụp — **không nằm trên đường đi của
mỗi tin nhắn**.

### Một lỗi logic sửa kèm

`handleDisconnect` trước đây kết luận "thật sự offline" bằng cách đếm socket của **riêng
tiến trình này**. Một người mở web trên máy tính và app trên điện thoại là hai socket, và
load balancer rất có thể đẩy chúng vào hai bản khác nhau. Đóng tab web thì bản đang xử lý
thấy hết socket và báo offline — trong khi điện thoại vẫn đang nối. Bạn bè thấy họ offline
dù họ vẫn ở đó.

## 5. Kết quả các cổng (chạy cục bộ)

| Cổng | Kết quả |
|---|---|
| `lint:check` | ✅ nợ lint không tăng |
| `boundaries:check` | ✅ 28/28 |
| `build` | ✅ |
| `openapi:check` | ✅ không lệch |
| `npm test` | ✅ 8 suite / 52 test |
| `check:ci` | ✅ |
| `check:redis` | ✅ **19/19** |

## 6. Nghiệm thu thật

Redis thật (`redis:7` trong Docker, cổng 6380), hai server socket.io thật, hai storage thật:

```
— 5. CHẠY THẬT: hai server socket.io có thấy nhau —
  ✓ client nối vào server B (cổng 3902)
  ✓ tin phát từ server A tới được client đang nối server B
  ✓ fetchSockets() từ A thấy socket đang nối ở B — presence đúng toàn cụm

— 6. CHẠY THẬT: hai storage throttler dùng chung bộ đếm —
  ✓ storage #1 đếm lần đầu = 1
  ✓ storage #2 thấy số của #1 — hai bản api dùng CHUNG bộ đếm

— 7. CHẠY THẬT: Redis chết thì request vẫn đi qua —
[throttler] Redis không dùng được (Redis giả vờ chết) — CHO REQUEST ĐI QUA,
            rate limit tạm ngưng cho tới khi Redis trở lại.
  ✓ storage ném lỗi → lớp bọc cho request đi qua, không ném lên guard
```

Mục 7 là mục đáng giá nhất: nó chứng minh **chốt fail-open hoạt động**, chứ không chỉ
tồn tại trong mã.

### Vì sao fail-open chọn cho request đi qua, không chặn

Rate limit là hàng rào **chống lạm dụng**, không phải hàng rào **an toàn**. Redis chết mà
chặn hết thì một sự cố hạ tầng thành một sự cố ngừng dịch vụ toàn phần. Rủi ro đổi lại là
trong lúc Redis chết thì không có giới hạn — chấp nhận được, và có log.

Hai tuỳ chọn của client quyết định app sống hay chết:

- `enableOfflineQueue: false` — mặc định ioredis **xếp hàng** lệnh khi mất kết nối và chờ.
  Với throttler nghĩa là mọi request treo. Tắt đi thì lệnh hỏng ngay và fail-open cho đi
  tiếp. **Hỏng nhanh tốt hơn treo lâu.**
- `.on('error')` — client ioredis không có listener này sẽ ném lỗi chưa bắt và **giết cả
  tiến trình Node**.

Log tiết chế 30 giây/lần: Redis chết thì lỗi xảy ra ở mọi request; với ~700 req/s (số đo
ở Epic 4) là 700 dòng log mỗi giây, đủ để lấp mất chính dòng log nói tại sao mọi thứ hỏng.

## 7. Giới hạn (nói thẳng)

- **Giới hạn tốc độ sẽ siết lại thật.** Hiện 3 bản api đếm riêng nên giới hạn thực tế lỏng
  gấp 3. Sau PR này nó đúng bằng con số đã đặt (10/s · 50/10s · 300/60s). Nếu 429 tăng sau
  khi deploy thì **đó là hệ quả đã biết trước, không phải lỗi mới**. Cố ý không đổi con số
  trong PR này — đổi ngưỡng là một quyết định khác, không trộn vào PR hạ tầng.
- **Chưa chạy thật với hai bản api của chính Zoldify.** Bài test dựng hai server socket.io
  thật nhưng không dựng hai NestJS app. Cách nghiệm thu đầy đủ là `docker compose up
  --scale api=2` rồi chat qua lại — cần task #6 (compose có worker/caddy) mới làm gọn được.
- **`fetchSockets()` gọi ở mỗi lần ngắt kết nối.** Ở 1000 CCU với người dùng vào ra liên
  tục, đó là một vòng Redis mỗi lần. Chưa đo dưới tải; nếu thành nút thắt thì hướng xử lý
  là gộp (debounce) sự kiện presence, không phải quay lại giữ Map trong RAM.
- **Cache vẫn dùng `@keyv/redis`, throttler và socket dùng `ioredis`** — hai client Redis
  khác nhau trong cùng một tiến trình. Không sai, nhưng là hai bộ cấu hình phải nhớ. Gộp
  về một là việc dọn dẹp riêng.
- **Redis giờ là phụ thuộc thật của production**, không còn là "cache cho nhanh". Mất Redis
  thì: cache về MySQL (chậm hơn), rate limit tạm ngưng (fail-open), socket về chế độ một
  tiến trình (người dùng ở hai bản api không thấy nhau). Không cái nào làm sập API, nhưng
  cả ba đều là suy giảm thật — cần một cảnh báo khi Redis mất, hiện **chưa có**.

## 8. Ghi chú cho trưởng nhóm

- `docker-compose.yml` cần `REDIS_URL` cho service `api` — **đã có sẵn** từ Epic 4
  (`REDIS_URL: redis://redis:6379`), nên không phải sửa gì thêm để bật những thứ trong PR này.
- Sơ đồ deployment ghi `zoldify-api x3`. Sau PR này, chạy 3 bản mới thật sự đúng — trước
  đó chat và rate limit đều sai âm thầm.
