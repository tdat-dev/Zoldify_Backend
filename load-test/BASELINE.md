# Baseline đo tải — TRƯỚC khi tối ưu

Mốc để các Epic sau so sánh. Đo bằng `load-test/baseline.js` (k6).

## Môi trường đo
- Máy dev cục bộ (Windows), MySQL qua XAMPP, server chạy `npm run start:dev`
  (một tiến trình Node, chưa cluster/PM2), k6 chạy cùng máy.
- Dữ liệu: 500k products, 1tr orders (xem `scripts/seed-bulk.ts`).
- Ngày đo: 2026-08-19.

## Kịch bản
- Ramp 0 → **1000 VU** trong 30s, giữ 1 phút, hạ 15s.
- Mỗi vòng: `GET /products` (30% kèm tìm kiếm `q=San pham`) + `GET /orders` (có token).

## Kết quả 1000 VU — HỆ THỐNG SẬP

| Chỉ số | Giá trị |
|--------|---------|
| **Tỉ lệ request lỗi (timeout)** | **99.55%** (48,093 / 48,309) |
| Request thành công | 0.44% (215) |
| p95 (mọi request, gồm cả timeout 60s) | ~2.1s |
| p95 của request THÀNH CÔNG | **33.2s** (avg 9.3s, max 59.8s) |
| Throughput | ~420 req/s gửi đi, gần như toàn bộ timeout |
| /orders (16ms ở 10 VU) | cũng timeout — server bão hoà hoàn toàn |

**Kết luận:** với 1000 user đồng thời, một tiến trình Node + pool 50 kết nối
không trụ nổi; gần như mọi request timeout sau 60s.

## So sánh tham chiếu (10 VU, smoke)
- /orders p95 = 16ms (nhanh — buyer chỉ 3 đơn).
- /products p95 = 20s (chậm — do tìm kiếm; xem caveat).

## Caveat khi đọc số
1. **`q=San pham` khớp gần như toàn bộ 500k products** (seed đặt tên giống nhau)
   → FULLTEXT + sort cực nặng, kéo p95 /products lên. Cần đổi từ khoá tìm kiếm
   chọn lọc hơn hoặc giảm tỉ lệ search để có số "thuần phân trang".
2. **/orders chưa lộ bug findAll nạp-hết-bảng**: buyer seed chỉ 3 đơn. Epic 1 cần
   kịch bản user nhiều đơn (hoặc admin xem toàn bộ) để đo đúng.
3. Đây là máy dev một tiến trình — production sẽ cluster nhiều instance + Redis.
   Nhưng vẫn là mốc hợp lệ để đo *mức cải thiện tương đối* qua từng Epic.

## Mục tiêu sau tối ưu (Epic 1→3)
- Tỉ lệ lỗi ở 1000 VU: **99.55% → < 1%**.
- p95 /products & /orders: **về dưới ~500ms** ở tải mục tiêu.
```
# chạy lại để đo sau mỗi Epic:
npm run loadtest                       # 1000 VU mặc định
k6 run -e VUS=200 -e RAMP=5s -e HOLD=10s load-test/baseline.js   # thử nhẹ
```
