# Sức chịu tải: đo trên chính hệ này

> Sinh tự động bằng `npm run loadtest` lúc 2026-11-02T04:24:27.552Z.
> **Đừng sửa tay**: chạy lại lệnh trên là ghi đè.

## Vì sao bài đo này khác bài đo của một hệ Java

Trong Tomcat/Spring, mỗi request có một luồng riêng: một request nặng thì
chỉ luồng của nó chậm. NestJS chạy trên Node: **một luồng duy nhất** xử lý
mọi request. Chờ MySQL thì không sao, đó là I/O nên Node nhả luồng. Nhưng
phần tự mình làm thì không nhả được:

- TypeORM dựng 2.000 đối tượng entity từ 2.000 dòng
- `JSON.stringify` mảng 2.000 phần tử đó
- class-transformer duyệt từng field để lọc `@Exclude`

Ba việc đó là CPU thuần. Trong lúc chúng chạy, **mọi request khác xếp hàng**
, kể cả một healthcheck rỗng. Nên bảng dưới có cột `lag` (vòng lặp sự kiện
bị trễ bao lâu) và `cpu`: hai con số Java không cần nhìn tới.

## Điều kiện đo

| | |
|---|---|
| Máy | 12 nhân · 34GB RAM · win32 |
| Node | v24.6.0 |
| Rate limit | **tắt**: để đo ngưỡng của máy, không phải ngưỡng cấu hình |
| Redis | không dùng: đo CPU tiến trình api, bớt một chặng mạng cho khỏi mờ |
| Bộ tạo tải | chạy ở **tiến trình khác**, nếu không chính nó làm nghẽn phép đo |
| Mỗi lượt | 5 giây, vòng kín (giữ đủ N request đang bay) |
| Tỉ lệ lỗi | 0.53%: bài đo tự huỷ nếu vượt 1% |

⚠️ Server và bộ tạo tải chạy **cùng một máy**. Số tuyệt đối vì thế bi quan hơn
thực tế đôi chút; thứ đáng tin là **so sánh giữa các route** và **hình dạng
đường cong khi tăng tải**, không phải con số RPS tuyệt đối.

## Kết quả

| Route | song song | RPS | p50 | p95 | p99 | 5xx | lag p99 | CPU |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| danh mục | 1 | **264** | 3.53 | 5.41 | 8.11 | 0 | 2.66 | 89% |
| danh mục | 20 | **994** | 19.05 | 31.73 | 40.44 | 0 | 11.98 | 114% |
| danh mục | 50 | **1429** | 32.47 | 52.86 | 67.3 | 0 | 17.79 | 118% |
| danh sách SP (xoay trang + kiểu sắp) | 1 | **105** | 4.18 | 27.29 | 78.81 | 0 | 15.7 | 51% |
| danh sách SP (xoay trang + kiểu sắp) | 20 | **491** | 38.39 | 58.41 | 67.44 | 0 | 44.96 | 102% |
| danh sách SP (xoay trang + kiểu sắp) | 50 | **494** | 91.15 | 144.29 | 172.34 | 0 | 108.59 | 119% |
| tìm kiếm (xoay 10 từ khoá) | 1 | **0** | 4191.58 | 4585.74 | 4585.74 | 0 | 16.62 | 0% |
| tìm kiếm (xoay 10 từ khoá) | 20 | **3** | 5801.28 | 12911.53 | 13528.68 | 10 | 18.6 | 13% |
| tìm kiếm (xoay 10 từ khoá) | 50 | **6** | 41.03 | 52484.84 | 72634.24 | 50 | 31.95 | 2% |
| SP theo danh mục (9 danh mục x 5 trang) | 1 | **202** | 4.13 | 6.85 | 14.72 | 0 | 9.7 | 72% |
| SP theo danh mục (9 danh mục x 5 trang) | 20 | **406** | 47.51 | 70.34 | 88.02 | 0 | 53.74 | 123% |
| SP theo danh mục (9 danh mục x 5 trang) | 50 | **456** | 95.77 | 204.58 | 322.94 | 0 | 140.9 | 94% |
| chi tiết SP (id ngẫu nhiên trong 1M) | 1 | **110** | 8.67 | 12.74 | 15.56 | 0 | 3.01 | 59% |
| chi tiết SP (id ngẫu nhiên trong 1M) | 20 | **355** | 60.3 | 101.4 | 158.21 | 0 | 20.5 | 128% |
| chi tiết SP (id ngẫu nhiên trong 1M) | 50 | **503** | 68.61 | 207.58 | 234.12 | 0 | 37.13 | 108% |
| chi tiết SP có ~9.950 đánh giá | 1 | **275** | 3.52 | 4.86 | 5.96 | 0 | 2.43 | 65% |
| chi tiết SP có ~9.950 đánh giá | 20 | **826** | 22.59 | 37.91 | 52.17 | 0 | 15.93 | 99% |
| chi tiết SP có ~9.950 đánh giá | 50 | **1095** | 44.22 | 64.55 | 79.88 | 0 | 23.09 | 129% |
| đơn bán của người bán nặng | 1 | **0** | 5466.91 | 5466.91 | 5466.91 | 1 | 17.5 | 1% |
| đơn bán của người bán nặng | 20 | **2** | 5559.04 | 11004.85 | 11004.85 | 20 | 22.02 | 12% |
| đơn bán của người bán nặng | 50 | **4** | 11648.95 | 12019.59 | 12138.64 | 0 | 31.57 | 5% |
| đơn mua của người mua nặng | 1 | **49** | 19.13 | 29.3 | 38.69 | 0 | 11.59 | 38% |
| đơn mua của người mua nặng | 20 | **93** | 213.67 | 255.45 | 280.04 | 0 | 49.87 | 99% |
| đơn mua của người mua nặng | 50 | **95** | 532.21 | 607.1 | 631.22 | 0 | 64.26 | 101% |
| chat: hội thoại người bán nặng | 1 | **1** | 768 | 2054.67 | 2054.67 | 0 | 16.7 | 2% |
| chat: hội thoại người bán nặng | 20 | **6** | 2939.29 | 5449.99 | 5633.49 | 0 | 18.04 | 10% |
| chat: hội thoại người bán nặng | 50 | **6** | 8330.89 | 8975.24 | 9045.95 | 0 | 18.78 | 8% |
| chat: hội thoại người mua nặng | 1 | **2** | 571.22 | 846.51 | 846.51 | 0 | 16.62 | 1% |
| chat: hội thoại người mua nặng | 20 | **5** | 2783.92 | 5357.65 | 5385.7 | 0 | 32 | 6% |
| chat: hội thoại người mua nặng | 50 | **6** | 7577.6 | 8796.69 | 8869.6 | 0 | 33.62 | 6% |
| admin: thống kê | 1 | **158** | 4.35 | 7.22 | 9.65 | 0 | 15.75 | 46% |
| admin: thống kê | 20 | **511** | 33.64 | 71.19 | 97.85 | 0 | 31.11 | 123% |
| admin: thống kê | 50 | **558** | 84.57 | 133.71 | 155.71 | 0 | 42.27 | 101% |
| admin: thống kê đơn | 1 | **177** | 4 | 6.54 | 8.84 | 0 | 15.7 | 46% |
| admin: thống kê đơn | 20 | **444** | 41.47 | 76.16 | 92.7 | 0 | 32.26 | 125% |
| admin: thống kê đơn | 50 | **385** | 128.79 | 186.39 | 212.6 | 0 | 67.96 | 98% |

`RPS` = request/giây · `p95` = 95% request xong trong ngần này ms ·
`lag p99` = vòng lặp sự kiện bị trễ · `CPU` = phần trăm của MỘT luồng.

## Bài chèn ngang: con số quan trọng nhất

Bắn một healthcheck rỗng (không chạm DB) trong hai hoàn cảnh:

| Hoàn cảnh | healthcheck mất |
|---|---:|
| máy đang rảnh | 1.02 ms |
| 4 request `/sitemap.xml` đang chạy | **5.01 ms** |

**Chậm đi 4.9×.** Vòng lặp sự kiện có lúc trễ tới 32.36 ms.

Ở một hệ Java tỉ lệ này gần bằng 1: healthcheck có luồng riêng, không quan
tâm ai đang bận. Ở đây nó không có luồng riêng: nó xếp hàng sau phần CPU của
request nặng. Đó là toàn bộ khác biệt, và đó là lý do một route nặng ở NestJS
nguy hiểm hơn cùng route đó ở Java: nó không làm chậm chính nó, nó làm chậm
**tất cả mọi người**.

Database: `zoldify_1mall` (scripts/seed-1m.sql). Redis: bật. Cache: bật. Bài chèn ngang dùng danh sách SP xoay trang thay cho sitemap.
