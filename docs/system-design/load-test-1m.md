# Sức chịu tải: đo trên chính hệ này

> Sinh tự động bằng `npm run loadtest` lúc 2026-11-02T06:45:52.815Z.
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
| Tỉ lệ lỗi | 0.00%: bài đo tự huỷ nếu vượt 1% |

⚠️ Server và bộ tạo tải chạy **cùng một máy**. Số tuyệt đối vì thế bi quan hơn
thực tế đôi chút; thứ đáng tin là **so sánh giữa các route** và **hình dạng
đường cong khi tăng tải**, không phải con số RPS tuyệt đối.

## Kết quả

| Route | song song | RPS | p50 | p95 | p99 | 5xx | lag p99 | CPU |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| danh mục | 1 | **174** | 5.45 | 7.44 | 9.6 | 0 | 4.14 | 52% |
| danh mục | 20 | **579** | 29.01 | 67.02 | 106.93 | 0 | 30.62 | 111% |
| danh mục | 50 | **702** | 60.54 | 130.86 | 169.59 | 0 | 47.15 | 90% |
| danh sách SP (xoay trang + kiểu sắp) | 1 | **91** | 6.08 | 25.41 | 37.54 | 0 | 10.05 | 86% |
| danh sách SP (xoay trang + kiểu sắp) | 20 | **283** | 62.68 | 120.73 | 199.62 | 0 | 87.03 | 90% |
| danh sách SP (xoay trang + kiểu sắp) | 50 | **310** | 158.76 | 224.38 | 248.69 | 0 | 165.28 | 96% |
| tìm kiếm (xoay 10 từ khoá) | 1 | **85** | 5.38 | 7.63 | 282 | 0 | 16.42 | 36% |
| tìm kiếm (xoay 10 từ khoá) | 20 | **340** | 53.91 | 102.4 | 124.47 | 0 | 58.88 | 83% |
| tìm kiếm (xoay 10 từ khoá) | 50 | **524** | 93.43 | 140.24 | 168.04 | 0 | 77.46 | 121% |
| SP theo danh mục (9 danh mục x 5 trang) | 1 | **168** | 5.19 | 14.19 | 22.44 | 0 | 5.41 | 67% |
| SP theo danh mục (9 danh mục x 5 trang) | 20 | **298** | 61.83 | 99.85 | 141.67 | 0 | 71.43 | 90% |
| SP theo danh mục (9 danh mục x 5 trang) | 50 | **461** | 108.33 | 165.35 | 178.56 | 0 | 126.81 | 101% |
| chi tiết SP (id ngẫu nhiên trong 1M) | 1 | **116** | 8.29 | 11.55 | 13.46 | 0 | 2.94 | 64% |
| chi tiết SP (id ngẫu nhiên trong 1M) | 20 | **318** | 73.16 | 113.58 | 125.03 | 0 | 22.54 | 100% |
| chi tiết SP (id ngẫu nhiên trong 1M) | 50 | **422** | 82.24 | 257.89 | 296.95 | 0 | 54.79 | 97% |
| chi tiết SP có ~9.950 đánh giá | 1 | **250** | 3.94 | 5.25 | 7.17 | 0 | 2.6 | 56% |
| chi tiết SP có ~9.950 đánh giá | 20 | **624** | 29.47 | 50.84 | 64.7 | 0 | 19.86 | 90% |
| chi tiết SP có ~9.950 đánh giá | 50 | **577** | 78.02 | 152.21 | 205.44 | 0 | 61.8 | 79% |
| đơn bán của người bán nặng | 1 | **27** | 32.59 | 48.34 | 68.63 | 0 | 16.61 | 31% |
| đơn bán của người bán nặng | 20 | **63** | 308.82 | 424.89 | 464 | 0 | 103.02 | 74% |
| đơn bán của người bán nặng | 50 | **64** | 735.19 | 981.22 | 1014.17 | 0 | 137.76 | 71% |
| đơn mua của người mua nặng | 1 | **35** | 27.15 | 40.87 | 46.71 | 0 | 15.14 | 38% |
| đơn mua của người mua nặng | 20 | **83** | 240.55 | 336.66 | 368.31 | 0 | 71.7 | 92% |
| đơn mua của người mua nặng | 50 | **68** | 713.64 | 969.58 | 1021.3 | 0 | 127.34 | 79% |
| chat: hội thoại người bán nặng | 1 | **40** | 24.37 | 32.92 | 35.12 | 0 | 7.38 | 51% |
| chat: hội thoại người bán nặng | 20 | **54** | 347.6 | 538.87 | 605.34 | 0 | 107.87 | 72% |
| chat: hội thoại người bán nặng | 50 | **56** | 880.88 | 1048.28 | 1079.99 | 0 | 115.15 | 73% |
| chat: hội thoại người mua nặng | 1 | **39** | 25.21 | 31.24 | 42.01 | 0 | 7.43 | 51% |
| chat: hội thoại người mua nặng | 20 | **77** | 239.64 | 386.43 | 533.62 | 0 | 85.33 | 82% |
| chat: hội thoại người mua nặng | 50 | **75** | 581.85 | 1131.11 | 1146.04 | 0 | 64.91 | 147% |
| admin: thống kê | 1 | **129** | 6.3 | 8.44 | 10.24 | 0 | 15.52 | 51% |
| admin: thống kê | 20 | **298** | 64.96 | 93.55 | 100.98 | 0 | 39.55 | 90% |
| admin: thống kê | 50 | **353** | 134.46 | 201.57 | 251.48 | 0 | 84.08 | 97% |
| admin: thống kê đơn | 1 | **0** | 5055.99 | 5055.99 | 5055.99 | 0 | 16.61 | 0% |
| admin: thống kê đơn | 20 | **227** | 72.43 | 167.05 | 309.16 | 0 | 83.62 | 105% |
| admin: thống kê đơn | 50 | **235** | 187.34 | 404.24 | 459.06 | 0 | 183.76 | 76% |

`RPS` = request/giây · `p95` = 95% request xong trong ngần này ms ·
`lag p99` = vòng lặp sự kiện bị trễ · `CPU` = phần trăm của MỘT luồng.

## Bài chèn ngang: con số quan trọng nhất

Bắn một healthcheck rỗng (không chạm DB) trong hai hoàn cảnh:

| Hoàn cảnh | healthcheck mất |
|---|---:|
| máy đang rảnh | 1.84 ms |
| 4 request `/sitemap.xml` đang chạy | **6.86 ms** |

**Chậm đi 3.7×.** Vòng lặp sự kiện có lúc trễ tới 95.88 ms.

Ở một hệ Java tỉ lệ này gần bằng 1: healthcheck có luồng riêng, không quan
tâm ai đang bận. Ở đây nó không có luồng riêng: nó xếp hàng sau phần CPU của
request nặng. Đó là toàn bộ khác biệt, và đó là lý do một route nặng ở NestJS
nguy hiểm hơn cùng route đó ở Java: nó không làm chậm chính nó, nó làm chậm
**tất cả mọi người**.

Database: `zoldify_1mall` (scripts/seed-1m.sql). Redis: bật. Cache: bật. Bài chèn ngang dùng danh sách SP xoay trang thay cho sitemap.
