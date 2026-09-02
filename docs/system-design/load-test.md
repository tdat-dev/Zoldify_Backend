# Sức chịu tải — đo trên chính hệ này

> Sinh tự động bằng `npm run loadtest` lúc 2026-09-02T04:07:33.318Z.
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
| healthcheck (không chạm DB) | 1 | **1946** | 0.43 | 0.73 | 3.49 | 4.33 | 76% |
| healthcheck (không chạm DB) | 10 | **3083** | 2.65 | 6.91 | 8.38 | 7.45 | 127% |
| healthcheck (không chạm DB) | 50 | **3127** | 15.19 | 21.73 | 26.94 | 25.69 | 118% |
| healthcheck (không chạm DB) | 100 | **3101** | 31.71 | 39.28 | 47.02 | 41.48 | 121% |
| danh mục (9 dòng, KHÔNG cache) | 1 | **263** | 3.59 | 4.96 | 6.3 | 3.28 | 38% |
| danh mục (9 dòng, KHÔNG cache) | 10 | **966** | 9.63 | 13.94 | 15.59 | 5.64 | 102% |
| danh mục (9 dòng, KHÔNG cache) | 50 | **951** | 51.25 | 62.94 | 71.07 | 12.45 | 113% |
| danh mục (9 dòng, KHÔNG cache) | 100 | **907** | 107.31 | 116.99 | 198.14 | 13.81 | 118% |
| sản phẩm — CÓ cache | 1 | **1545** | 0.55 | 0.96 | 3.34 | 3.27 | 76% |
| sản phẩm — CÓ cache | 10 | **2225** | 3.83 | 7.48 | 9.06 | 7.85 | 115% |
| sản phẩm — CÓ cache | 50 | **2220** | 22.61 | 27.44 | 31.19 | 29.15 | 106% |
| sản phẩm — CÓ cache | 100 | **2168** | 45.07 | 54.78 | 79.34 | 63.6 | 117% |
| chat: danh sách hội thoại | 1 | **134** | 7.07 | 9.72 | 11.24 | 2.65 | 46% |
| chat: danh sách hội thoại | 10 | **304** | 32.55 | 38.18 | 43.68 | 9.36 | 106% |
| chat: danh sách hội thoại | 50 | **304** | 161.88 | 185.53 | 203.57 | 17.89 | 111% |
| chat: danh sách hội thoại | 100 | **304** | 321.43 | 436.96 | 444.46 | 20.97 | 122% |
| đơn của tôi | 1 | **143** | 6.74 | 8.61 | 9.27 | 3 | 57% |
| đơn của tôi | 10 | **309** | 31.95 | 36.75 | 39.57 | 12.75 | 98% |
| đơn của tôi | 50 | **271** | 182.2 | 209.52 | 235.63 | 27.69 | 106% |
| đơn của tôi | 100 | **275** | 364.03 | 399.11 | 402.62 | 30.54 | 110% |
| admin: thống kê | 1 | **215** | 4.46 | 5.9 | 6.92 | 2.1 | 60% |
| admin: thống kê | 10 | **411** | 23.98 | 28.87 | 33.36 | 7.76 | 99% |
| admin: thống kê | 50 | **439** | 112.58 | 125.1 | 139.62 | 15.96 | 103% |
| admin: thống kê | 100 | **431** | 231.74 | 252.88 | 262.62 | 17.32 | 102% |
| sitemap — nạp TOÀN BỘ sản phẩm | 1 | **60** | 16.19 | 20.86 | 40.61 | 12.62 | 77% |
| sitemap — nạp TOÀN BỘ sản phẩm | 10 | **75** | 130.18 | 137.4 | 262.69 | 70.78 | 128% |
| sitemap — nạp TOÀN BỘ sản phẩm | 50 | **73** | 685.44 | 764.04 | 786.67 | 151.39 | 122% |
| sitemap — nạp TOÀN BỘ sản phẩm | 100 | **68** | 1448.21 | 1648.38 | 1730.99 | 181.01 | 141% |
| sản phẩm — CACHE TẮT HẲN | 1 | **125** | 7.64 | 10.42 | 12.48 | 3.86 | 37% |
| sản phẩm — CACHE TẮT HẲN | 10 | **440** | 22.07 | 29.4 | 35.37 | 7.68 | 117% |
| sản phẩm — CACHE TẮT HẲN | 50 | **488** | 99.69 | 123.56 | 148.63 | 13.28 | 120% |
| sản phẩm — CACHE TẮT HẲN | 100 | **490** | 200.54 | 241.73 | 266.91 | 13.39 | 106% |

`RPS` = request/giây · `p95` = 95% request xong trong ngần này ms ·
`lag p99` = vòng lặp sự kiện bị trễ · `CPU` = phần trăm của MỘT luồng.

- **healthcheck (không chạm DB)** — trần lý thuyết của khung
- **sản phẩm — CÓ cache** — cache in-memory đang bật, lần nào cũng trúng
- **sitemap — nạp TOÀN BỘ sản phẩm** — route nặng nhất; xem cột lag
- **sản phẩm — CACHE TẮT HẲN** — server riêng, kho cache luôn trượt → mỗi request chạm DB

## Bài chèn ngang — con số quan trọng nhất

Bắn một healthcheck rỗng (không chạm DB) trong hai hoàn cảnh:

| Hoàn cảnh | healthcheck mất |
|---|---:|
| máy đang rảnh | 0.45 ms |
| 4 request `/sitemap.xml` đang chạy | **11.7 ms** |

**Chậm đi 26×.** Vòng lặp sự kiện có lúc trễ tới 52.46 ms.

Ở một hệ Java tỉ lệ này gần bằng 1: healthcheck có luồng riêng, không quan
tâm ai đang bận. Ở đây nó không có luồng riêng — nó xếp hàng sau phần CPU của
request nặng. Đó là toàn bộ khác biệt, và đó là lý do một route nặng ở NestJS
nguy hiểm hơn cùng route đó ở Java: nó không làm chậm chính nó, nó làm chậm
**tất cả mọi người**.

## Kết luận — một tiến trình api chịu được bao nhiêu

| Loại đường | RPS đỉnh (1 tiến trình) |
|---|---:|
| Trần của khung (không chạm DB) | 3127 |
| Danh sách có cache, trúng cache | 2225 |
| Danh sách chạm DB thật | 490 |
| Đường có xác thực + JOIN (chat, đơn) | 309 |
| Route nặng nhất (`sitemap.xml`) | **75** |

Bốn điều rút ra:

1. **Cache đang gánh 4.5×** cho đường sản phẩm (2225 so với 490 rps).
   Cache hỏng hoặc Redis chết là tụt thẳng xuống mức dưới, không phải tụt dần.
2. **CPU chạm ~100% ngay từ mức 10 người bấm cùng lúc** ở gần như mọi route.
   Một tiến trình Node chỉ có một luồng JS, nên từ đó trở đi tăng tải chỉ làm
   dài thêm hàng đợi: nhìn cột `p95` tăng gấp đôi mỗi khi số song song gấp đôi,
   trong khi cột `RPS` đứng yên. Muốn hơn thì phải **thêm tiến trình**, không
   phải thêm nhân cho một tiến trình.
3. **`sitemap.xml` là chỗ yếu nhất**: 75 rps, và quan trọng hơn là nó
   làm mọi request khác chậm đi (xem bài chèn ngang). Nó nạp toàn bộ bảng sản
   phẩm — hôm nay 2.000 dòng; ở 200.000 dòng thì nó không còn là route chậm,
   nó là sự cố. Đây cũng là chỗ `sql-audit.md` đã đánh dấu mức CAO.
4. **Rate limit thật là 10 request/giây mỗi IP.** Nghĩa là trong vận hành bình
   thường sẽ không ai chạm tới các con số trên. Các số này trả lời câu hỏi khác:
   *khi có sự cố, hoặc khi throttler fail-open vì Redis chết, thì trần ở đâu.*
