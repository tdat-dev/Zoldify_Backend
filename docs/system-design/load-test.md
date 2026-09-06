# Sức chịu tải — đo trên chính hệ này

> Sinh tự động bằng `npm run loadtest` lúc 2026-09-02T09:45:56.514Z.
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
| Máy | 16 nhân · 16GB RAM · win32 |
| Node | v22.16.0 |
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
| healthcheck (không chạm DB) | 1 | **2033** | 0.42 | 0.63 | 3.52 | 4.31 | 84% |
| healthcheck (không chạm DB) | 10 | **3131** | 2.58 | 6.7 | 8.27 | 7.26 | 133% |
| healthcheck (không chạm DB) | 50 | **3233** | 14.72 | 20.69 | 22.89 | 21.99 | 108% |
| healthcheck (không chạm DB) | 100 | **3160** | 31.34 | 38.62 | 48.42 | 43.22 | 118% |
| danh mục (9 dòng, KHÔNG cache) | 1 | **257** | 3.7 | 4.87 | 6.42 | 3.22 | 31% |
| danh mục (9 dòng, KHÔNG cache) | 10 | **964** | 9.6 | 13.8 | 15.56 | 5.64 | 108% |
| danh mục (9 dòng, KHÔNG cache) | 50 | **947** | 52.29 | 59.06 | 65.57 | 11.19 | 107% |
| danh mục (9 dòng, KHÔNG cache) | 100 | **949** | 102.03 | 118.73 | 186.4 | 12.76 | 126% |
| sản phẩm — CÓ cache | 1 | **1553** | 0.56 | 0.85 | 3.31 | 3.23 | 87% |
| sản phẩm — CÓ cache | 10 | **2268** | 3.78 | 7.42 | 8.66 | 7.9 | 111% |
| sản phẩm — CÓ cache | 50 | **2205** | 22.57 | 28.42 | 36.24 | 30.15 | 108% |
| sản phẩm — CÓ cache | 100 | **2204** | 44.99 | 51.18 | 55.7 | 52.76 | 110% |
| chat: danh sách hội thoại | 1 | **135** | 7.1 | 9.44 | 10.33 | 2.75 | 42% |
| chat: danh sách hội thoại | 10 | **304** | 33.01 | 37.71 | 40.47 | 8.79 | 106% |
| chat: danh sách hội thoại | 50 | **301** | 162.87 | 197.37 | 216.07 | 18.42 | 111% |
| chat: danh sách hội thoại | 100 | **308** | 318.92 | 375.26 | 465.97 | 21.71 | 123% |
| đơn của tôi | 1 | **144** | 6.75 | 8.38 | 9.42 | 2.81 | 49% |
| đơn của tôi | 10 | **305** | 32.07 | 39.09 | 41.83 | 13.66 | 103% |
| đơn của tôi | 50 | **276** | 180.78 | 191.02 | 209.36 | 25.66 | 110% |
| đơn của tôi | 100 | **278** | 360.74 | 375.39 | 381.73 | 29.88 | 110% |
| admin: thống kê | 1 | **212** | 4.52 | 6 | 6.66 | 2.18 | 50% |
| admin: thống kê | 10 | **414** | 23.68 | 27.75 | 30.42 | 7.73 | 101% |
| admin: thống kê | 50 | **435** | 113.75 | 128.13 | 142.08 | 15.52 | 100% |
| admin: thống kê | 100 | **432** | 230.93 | 249.71 | 271.97 | 17.32 | 104% |
| sitemap — bảng chỉ mục | 1 | **2022** | 0.42 | 0.64 | 3.38 | 4.28 | 74% |
| sitemap — bảng chỉ mục | 10 | **3075** | 2.62 | 7.16 | 8.28 | 7.66 | 125% |
| sitemap — bảng chỉ mục | 50 | **3131** | 15.06 | 21.92 | 26.79 | 23.17 | 110% |
| sitemap — bảng chỉ mục | 100 | **3114** | 31.33 | 38.9 | 50.97 | 43.12 | 112% |
| sitemap — một file con | 1 | **659** | 1.29 | 2.65 | 5.96 | 5.29 | 66% |
| sitemap — một file con | 10 | **1173** | 8.12 | 12.31 | 14.64 | 12.36 | 104% |
| sitemap — một file con | 50 | **1128** | 42.21 | 61.39 | 79.04 | 55.28 | 105% |
| sitemap — một file con | 100 | **1129** | 84.16 | 116.92 | 132.23 | 107.41 | 105% |
| sản phẩm — CACHE TẮT HẲN | 1 | **126** | 7.67 | 9.52 | 11.68 | 3.58 | 43% |
| sản phẩm — CACHE TẮT HẲN | 10 | **452** | 21.7 | 27.56 | 32.01 | 7.09 | 116% |
| sản phẩm — CACHE TẮT HẲN | 50 | **487** | 100.89 | 115.81 | 133.03 | 12.89 | 115% |
| sản phẩm — CACHE TẮT HẲN | 100 | **497** | 199.5 | 220.2 | 267.04 | 12.98 | 113% |

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
| máy đang rảnh | 0.46 ms |
| 4 request `/sitemap.xml` đang chạy | **1.42 ms** |

**Chậm đi 3.1×.** Vòng lặp sự kiện có lúc trễ tới 10.79 ms.

Ở một hệ Java tỉ lệ này gần bằng 1: healthcheck có luồng riêng, không quan
tâm ai đang bận. Ở đây nó không có luồng riêng — nó xếp hàng sau phần CPU của
request nặng. Đó là toàn bộ khác biệt, và đó là lý do một route nặng ở NestJS
nguy hiểm hơn cùng route đó ở Java: nó không làm chậm chính nó, nó làm chậm
**tất cả mọi người**.

## Kết luận — một tiến trình api chịu được bao nhiêu

| Loại đường | RPS đỉnh (1 tiến trình) |
|---|---:|
| Trần của khung (không chạm DB) | 3233 |
| Danh sách có cache, trúng cache | 2268 |
| Danh sách chạm DB thật | 497 |
| Đường có xác thực + JOIN (chat, đơn) | 308 |
| `sitemap.xml` — bảng chỉ mục | 3131 |
| Route nặng nhất (một file sitemap con) | **1173** |

Bốn điều rút ra:

1. **Cache đang gánh 4.6×** cho đường sản phẩm (2268 so với 497 rps).
   Cache hỏng hoặc Redis chết là tụt thẳng xuống mức dưới, không phải tụt dần.
2. **CPU chạm ~100% ngay từ mức 10 người bấm cùng lúc** ở gần như mọi route.
   Một tiến trình Node chỉ có một luồng JS, nên từ đó trở đi tăng tải chỉ làm
   dài thêm hàng đợi: nhìn cột `p95` tăng gấp đôi mỗi khi số song song gấp đôi,
   trong khi cột `RPS` đứng yên. Muốn hơn thì phải **thêm tiến trình**, không
   phải thêm nhân cho một tiến trình.
3. **Bảng chỉ mục 3131 rps, file con 1173 rps.** Google gọi bảng chỉ mục
   trước, và đó giờ chỉ là một câu `GROUP BY` — nên cú chèn ngang ở dưới đo
   đúng thứ crawler thật gây ra. File con vẫn là route đắt nhất còn lại, nhưng
   chi phí của nó bị chặn ở `KICH_THUOC_LO` sản phẩm mỗi file, nên **không còn
   tăng theo kích thước bảng** — đó mới là điều đổi được. Xem `sql-audit.md`.
4. **Rate limit thật là 10 request/giây mỗi IP.** Nghĩa là trong vận hành bình
   thường sẽ không ai chạm tới các con số trên. Các số này trả lời câu hỏi khác:
   *khi có sự cố, hoặc khi throttler fail-open vì Redis chết, thì trần ở đâu.*
