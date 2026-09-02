# Sức chịu tải — đo trên chính hệ này

> Sinh tự động bằng `npm run loadtest` lúc 2026-09-02T08:01:36.592Z.
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
| healthcheck (không chạm DB) | 1 | **1911** | 0.43 | 0.73 | 3.8 | 4.59 | 76% |
| healthcheck (không chạm DB) | 10 | **2707** | 2.85 | 7.79 | 10.23 | 8.86 | 120% |
| healthcheck (không chạm DB) | 50 | **2597** | 18.58 | 26.96 | 33.89 | 30.34 | 113% |
| healthcheck (không chạm DB) | 100 | **2742** | 35.32 | 48.58 | 61.39 | 60.03 | 111% |
| danh mục (9 dòng, KHÔNG cache) | 1 | **148** | 6.46 | 10.82 | 12.52 | 6.15 | 43% |
| danh mục (9 dòng, KHÔNG cache) | 10 | **672** | 12.78 | 27.3 | 32.35 | 9.74 | 105% |
| danh mục (9 dòng, KHÔNG cache) | 50 | **875** | 56.08 | 67.37 | 70.06 | 12.65 | 105% |
| danh mục (9 dòng, KHÔNG cache) | 100 | **833** | 117.6 | 143.64 | 151.81 | 14.57 | 106% |
| sản phẩm — CÓ cache | 1 | **1365** | 0.6 | 1.11 | 4.6 | 4.44 | 96% |
| sản phẩm — CÓ cache | 10 | **1885** | 4.41 | 9.1 | 11.44 | 9.71 | 108% |
| sản phẩm — CÓ cache | 50 | **1654** | 27.86 | 49.09 | 59.28 | 56.46 | 108% |
| sản phẩm — CÓ cache | 100 | **1130** | 85.1 | 114.22 | 139.13 | 117.83 | 108% |
| chat: danh sách hội thoại | 1 | **72** | 14.13 | 18.05 | 19.82 | 4.85 | 50% |
| chat: danh sách hội thoại | 10 | **168** | 58.78 | 73.17 | 77.15 | 16.71 | 109% |
| chat: danh sách hội thoại | 50 | **163** | 302.77 | 341.72 | 353.76 | 36.9 | 106% |
| chat: danh sách hội thoại | 100 | **165** | 596.37 | 773.18 | 794.85 | 42.96 | 108% |
| đơn của tôi | 1 | **79** | 12.42 | 17.05 | 20.27 | 5.93 | 46% |
| đơn của tôi | 10 | **171** | 57.22 | 76.62 | 82.03 | 24.61 | 101% |
| đơn của tôi | 50 | **148** | 336.94 | 379.18 | 408.63 | 62.1 | 107% |
| đơn của tôi | 100 | **149** | 664.6 | 766.56 | 796.23 | 65.7 | 101% |
| admin: thống kê | 1 | **112** | 9.05 | 12.57 | 14.48 | 4.69 | 54% |
| admin: thống kê | 10 | **217** | 45.75 | 57.02 | 61.08 | 15.19 | 99% |
| admin: thống kê | 50 | **224** | 219.73 | 262.1 | 284.56 | 35.91 | 100% |
| admin: thống kê | 100 | **212** | 470.81 | 523.22 | 610.64 | 34.6 | 102% |
| sitemap — bảng chỉ mục | 1 | **861** | 1.01 | 2.34 | 5.69 | 5.88 | 68% |
| sitemap — bảng chỉ mục | 10 | **1372** | 6.48 | 13.55 | 17.18 | 15.62 | 118% |
| sitemap — bảng chỉ mục | 50 | **1465** | 32.9 | 48.23 | 57.47 | 50.59 | 109% |
| sitemap — bảng chỉ mục | 100 | **1500** | 64.92 | 88.92 | 96.46 | 90.57 | 101% |
| sitemap — một file con | 1 | **269** | 2.77 | 9.24 | 24.39 | 15.21 | 48% |
| sitemap — một file con | 10 | **650** | 14.76 | 23.14 | 26.92 | 16.15 | 101% |
| sitemap — một file con | 50 | **611** | 78.06 | 111.8 | 144.24 | 91.62 | 98% |
| sitemap — một file con | 100 | **640** | 151.11 | 207.77 | 221.24 | 182.45 | 102% |
| sản phẩm — CACHE TẮT HẲN | 1 | **67** | 15.08 | 18.7 | 19.94 | 7.38 | 46% |
| sản phẩm — CACHE TẮT HẲN | 10 | **207** | 47.76 | 60.44 | 71.45 | 16.45 | 113% |
| sản phẩm — CACHE TẮT HẲN | 50 | **252** | 194.69 | 238.95 | 249.21 | 26.57 | 108% |
| sản phẩm — CACHE TẮT HẲN | 100 | **257** | 388.23 | 450.19 | 487.26 | 26.74 | 111% |

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
| máy đang rảnh | 1.18 ms |
| 4 request `/sitemap.xml` đang chạy | **3.03 ms** |

**Chậm đi 2.6×.** Vòng lặp sự kiện có lúc trễ tới 22.61 ms.

Ở một hệ Java tỉ lệ này gần bằng 1: healthcheck có luồng riêng, không quan
tâm ai đang bận. Ở đây nó không có luồng riêng — nó xếp hàng sau phần CPU của
request nặng. Đó là toàn bộ khác biệt, và đó là lý do một route nặng ở NestJS
nguy hiểm hơn cùng route đó ở Java: nó không làm chậm chính nó, nó làm chậm
**tất cả mọi người**.

## Kết luận — một tiến trình api chịu được bao nhiêu

| Loại đường | RPS đỉnh (1 tiến trình) |
|---|---:|
| Trần của khung (không chạm DB) | 2742 |
| Danh sách có cache, trúng cache | 1885 |
| Danh sách chạm DB thật | 257 |
| Đường có xác thực + JOIN (chat, đơn) | 171 |
| `sitemap.xml` — bảng chỉ mục | 1500 |
| Route nặng nhất (một file sitemap con) | **650** |

Bốn điều rút ra:

1. **Cache đang gánh 7.3×** cho đường sản phẩm (1885 so với 257 rps).
   Cache hỏng hoặc Redis chết là tụt thẳng xuống mức dưới, không phải tụt dần.
2. **CPU chạm ~100% ngay từ mức 10 người bấm cùng lúc** ở gần như mọi route.
   Một tiến trình Node chỉ có một luồng JS, nên từ đó trở đi tăng tải chỉ làm
   dài thêm hàng đợi: nhìn cột `p95` tăng gấp đôi mỗi khi số song song gấp đôi,
   trong khi cột `RPS` đứng yên. Muốn hơn thì phải **thêm tiến trình**, không
   phải thêm nhân cho một tiến trình.
3. **Bảng chỉ mục 1500 rps, file con 650 rps.** Google gọi bảng chỉ mục
   trước, và đó giờ chỉ là một câu `GROUP BY` — nên cú chèn ngang ở dưới đo
   đúng thứ crawler thật gây ra. File con vẫn là route đắt nhất còn lại, nhưng
   chi phí của nó bị chặn ở `KICH_THUOC_LO` sản phẩm mỗi file, nên **không còn
   tăng theo kích thước bảng** — đó mới là điều đổi được. Xem `sql-audit.md`.
4. **Rate limit thật là 10 request/giây mỗi IP.** Nghĩa là trong vận hành bình
   thường sẽ không ai chạm tới các con số trên. Các số này trả lời câu hỏi khác:
   *khi có sự cố, hoặc khi throttler fail-open vì Redis chết, thì trần ở đâu.*
