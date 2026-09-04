# Sức chịu tải — đo trên chính hệ này

> Sinh tự động bằng `npm run loadtest` lúc 2026-09-04T10:01:10.911Z.
> **Đừng sửa tay** — chạy lại lệnh trên là ghi đè.

## Vì sao bài đo này khác bài đo của một hệ Java

Trong Tomcat/Spring, mỗi request có một luồng riêng: một request nặng thì
chỉ luồng của nó chậm. NestJS chạy trên Node — **một luồng duy nhất** xử lý
mọi request. Chờ MySQL thì không sao, đó là I/O nên Node nhả luồng. Nhưng
phần tự mình làm thì không nhả được:

- TypeORM dựng 2.000 đối tượng entity từ 2.000 dòng
- `JSON.stringify` mảng 2.000 phần tử đó
- class-transformer duyệt từng field để lọc `@Exclude`

Ba việc đó là CPU thuần. Trong lúc chúng chạy, **mọi request khác xếp hàng**
— kể cả một healthcheck rỗng. Nên bảng dưới có cột `lag` (vòng lặp sự kiện
bị trễ bao lâu) và `cpu` — hai con số Java không cần nhìn tới.

## Điều kiện đo

| | |
|---|---|
| Máy | 16 nhân · 15GB RAM · linux |
| Node | v24.20.0 |
| Rate limit | **tắt** — để đo ngưỡng của máy, không phải ngưỡng cấu hình |
| Redis | không dùng — đo CPU tiến trình api, bớt một chặng mạng cho khỏi mờ |
| Bộ tạo tải | chạy ở **tiến trình khác**, nếu không chính nó làm nghẽn phép đo |
| Mỗi lượt | 5 giây, vòng kín (giữ đủ N request đang bay) |
| Tỉ lệ lỗi | 0.00% — bài đo tự huỷ nếu vượt 1% |

⚠️ Server và bộ tạo tải chạy **cùng một máy**. Số tuyệt đối vì thế bi quan hơn
thực tế đôi chút; thứ đáng tin là **so sánh giữa các route** và **hình dạng
đường cong khi tăng tải**, không phải con số RPS tuyệt đối.

## Kết quả

| Route | song song | RPS | p50 | p95 | p99 | lag p99 | CPU |
|---|---:|---:|---:|---:|---:|---:|---:|
| healthcheck (không chạm DB) | 1 | **636** | 1.48 | 2.17 | 2.77 | 1.8 | 30% |
| healthcheck (không chạm DB) | 10 | **6568** | 1.25 | 2.4 | 7.31 | 3.76 | 120% |
| healthcheck (không chạm DB) | 50 | **7140** | 5.55 | 13 | 17.87 | 13.56 | 117% |
| healthcheck (không chạm DB) | 100 | **7459** | 11.46 | 22.21 | 30.31 | 20.69 | 128% |
| danh mục (9 dòng, KHÔNG cache) | 1 | **265** | 3.7 | 4.49 | 5.49 | 1.84 | 22% |
| danh mục (9 dòng, KHÔNG cache) | 10 | **1728** | 5.56 | 8.01 | 9.86 | 2.33 | 104% |
| danh mục (9 dòng, KHÔNG cache) | 50 | **1767** | 27.93 | 33.06 | 35.84 | 6.01 | 106% |
| danh mục (9 dòng, KHÔNG cache) | 100 | **1784** | 55.58 | 62.61 | 67.31 | 6.54 | 106% |
| sản phẩm — CÓ cache | 1 | **652** | 1.5 | 1.78 | 2.07 | 1.75 | 23% |
| sản phẩm — CÓ cache | 10 | **4541** | 1.98 | 3.4 | 7 | 4.73 | 110% |
| sản phẩm — CÓ cache | 50 | **4236** | 10.1 | 20.17 | 25.45 | 19.09 | 120% |
| sản phẩm — CÓ cache | 100 | **4403** | 20.54 | 38.08 | 46.36 | 31.51 | 110% |
| chat: danh sách hội thoại | 1 | **196** | 4.91 | 6.25 | 7.65 | 1.89 | 43% |
| chat: danh sách hội thoại | 10 | **602** | 16.43 | 21.45 | 24.1 | 4.29 | 105% |
| chat: danh sách hội thoại | 50 | **605** | 81.7 | 94.65 | 117.03 | 8.44 | 105% |
| chat: danh sách hội thoại | 100 | **588** | 163.38 | 217.3 | 226.07 | 10.17 | 106% |
| đơn của tôi | 1 | **205** | 4.73 | 6.19 | 7.23 | 1.86 | 49% |
| đơn của tôi | 10 | **501** | 19.4 | 27.11 | 32.29 | 6.26 | 102% |
| đơn của tôi | 50 | **525** | 92.59 | 109.33 | 116.04 | 13.66 | 102% |
| đơn của tôi | 100 | **510** | 189.69 | 243.74 | 253.73 | 20.14 | 104% |
| admin: thống kê | 1 | **202** | 4.73 | 7.18 | 9.08 | 2.22 | 44% |
| admin: thống kê | 10 | **944** | 10.28 | 14.58 | 18.18 | 4.42 | 103% |
| admin: thống kê | 50 | **979** | 49.8 | 59.52 | 92.43 | 6.54 | 115% |
| admin: thống kê | 100 | **1012** | 98.71 | 107.51 | 111.29 | 6.65 | 105% |
| sitemap — bảng chỉ mục | 1 | **716** | 1.39 | 1.58 | 1.78 | 1.59 | 17% |
| sitemap — bảng chỉ mục | 10 | **6116** | 1.38 | 2.84 | 7.38 | 3.81 | 110% |
| sitemap — bảng chỉ mục | 50 | **7140** | 5.7 | 12.27 | 17.1 | 12.44 | 121% |
| sitemap — bảng chỉ mục | 100 | **6911** | 12.66 | 24.08 | 30.75 | 21.43 | 111% |
| sitemap — một file con | 1 | **422** | 2.16 | 3.62 | 5.48 | 2.36 | 157% |
| sitemap — một file con | 10 | **967** | 10.03 | 17.51 | 24.64 | 11.39 | 302% |
| sitemap — một file con | 50 | **1032** | 45.98 | 79.21 | 107.29 | 60.95 | 314% |
| sitemap — một file con | 100 | **1022** | 91.32 | 154.23 | 201.01 | 115.87 | 315% |
| sản phẩm — CACHE TẮT HẲN | 1 | **142** | 6.9 | 8.41 | 9.81 | 1.88 | 31% |
| sản phẩm — CACHE TẮT HẲN | 10 | **608** | 15.8 | 24.01 | 29.47 | 6 | 133% |
| sản phẩm — CACHE TẮT HẲN | 50 | **651** | 72.7 | 106.64 | 121.08 | 12.26 | 143% |
| sản phẩm — CACHE TẮT HẲN | 100 | **621** | 158.58 | 204.19 | 240.05 | 13.21 | 142% |

`RPS` = request/giây · `p95` = 95% request xong trong ngần này ms ·
`lag p99` = vòng lặp sự kiện bị trễ · `CPU` = phần trăm của MỘT luồng.

- **healthcheck (không chạm DB)** — trần lý thuyết của khung
- **sản phẩm — CÓ cache** — cache in-memory đang bật, lần nào cũng trúng
- **sitemap — bảng chỉ mục** — thứ Google gọi đầu tiên; giờ chỉ là một câu GROUP BY + vài chục dòng XML
- **sitemap — một file con** — phần nặng còn lại, nhưng đã chặn ở KICH_THUOC_LO và có cache
- **sản phẩm — CACHE TẮT HẲN** — server riêng, kho cache luôn trượt → mỗi request chạm DB

## Bài chèn ngang — con số quan trọng nhất

Bắn một healthcheck rỗng (không chạm DB) trong hai hoàn cảnh:

| Hoàn cảnh | healthcheck mất |
|---|---:|
| máy đang rảnh | 1.38 ms |
| 4 request `/sitemap.xml` đang chạy | **1.78 ms** |

**Chậm đi 1.3×.** Vòng lặp sự kiện có lúc trễ tới 9.1 ms.

Ở một hệ Java tỉ lệ này gần bằng 1: healthcheck có luồng riêng, không quan
tâm ai đang bận. Ở đây nó không có luồng riêng — nó xếp hàng sau phần CPU của
request nặng. Đó là toàn bộ khác biệt, và đó là lý do một route nặng ở NestJS
nguy hiểm hơn cùng route đó ở Java: nó không làm chậm chính nó, nó làm chậm
**tất cả mọi người**.

## Kết luận — một tiến trình api chịu được bao nhiêu

| Loại đường | RPS đỉnh (1 tiến trình) |
|---|---:|
| Trần của khung (không chạm DB) | 7459 |
| Danh sách có cache, trúng cache | 4541 |
| Danh sách chạm DB thật | 651 |
| Đường có xác thực + JOIN (chat, đơn) | 605 |
| `sitemap.xml` — bảng chỉ mục | 7140 |
| Route nặng nhất (một file sitemap con) | **1032** |

Bốn điều rút ra:

1. **Cache đang gánh 7×** cho đường sản phẩm (4541 so với 651 rps).
   Cache hỏng hoặc Redis chết là tụt thẳng xuống mức dưới, không phải tụt dần.
2. **CPU chạm ~100% ngay từ mức 10 người bấm cùng lúc** ở gần như mọi route.
   Một tiến trình Node chỉ có một luồng JS, nên từ đó trở đi tăng tải chỉ làm
   dài thêm hàng đợi: nhìn cột `p95` tăng gấp đôi mỗi khi số song song gấp đôi,
   trong khi cột `RPS` đứng yên. Muốn hơn thì phải **thêm tiến trình**, không
   phải thêm nhân cho một tiến trình.
3. **Bảng chỉ mục 7140 rps, file con 1032 rps.** Google gọi bảng chỉ mục
   trước, và đó giờ chỉ là một câu `GROUP BY` — nên cú chèn ngang ở dưới đo
   đúng thứ crawler thật gây ra. File con vẫn là route đắt nhất còn lại, nhưng
   chi phí của nó bị chặn ở `KICH_THUOC_LO` sản phẩm mỗi file, nên **không còn
   tăng theo kích thước bảng** — đó mới là điều đổi được. Xem `sql-audit.md`.
4. **Rate limit thật là 10 request/giây mỗi IP.** Nghĩa là trong vận hành bình
   thường sẽ không ai chạm tới các con số trên. Các số này trả lời câu hỏi khác:
   *khi có sự cố, hoặc khi throttler fail-open vì Redis chết, thì trần ở đâu.*
