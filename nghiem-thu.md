# Nghiệm thu

**Kết luận: CHƯA ĐỦ**

File này do `npm run nghiem-thu` ghi ra. Đừng sửa tay — sửa thì nó mất giá trị làm bằng chứng, và lượt chạy sau ghi đè.

- Lúc: 18:00:35 28/10/2026
- Nhánh: `perf/1m-tong-hop`
- HEAD: `784d955` — feat(jobs): lịch dọn thông báo cũ mỗi đêm 3:41 trên hàng đợi chính

| Cổng | Kết quả | Mã thoát | Số đo | Giây |
|---|---|---|---|---|
| `npm run build` | ✅ PASS | 0 | — | 35.2 |
| `npm run lint:check` | ✅ PASS | 0 | nợ 458 (431 lỗi + 27 cảnh báo) · mốc 519 | 84.3 |
| `npm run openapi:check` | ✅ PASS | 0 | 108 route · 69 schema | 72.7 |
| `npm test` | ✅ PASS | 0 | 123 passed, 123 total · 777 passed, 777 total | 274.8 |
| `npm run check:compose` | ✅ PASS | 0 | 35 mục PASS | 5.4 |
| `npm run check:boot` | ✅ PASS | 0 | 19 mục PASS | 71.3 |
| `npm run check:audit` | ✅ PASS | 0 | 21 mục PASS | 100.2 |
| `npm run check:ci` | ✅ PASS | 0 | 31 mục PASS | 33 |
| `npm run check:backup` | ✅ PASS | 0 | 25 mục PASS | 51.2 |
| `npm run check:redis` | ✅ PASS | 0 | 19 mục PASS | 23.6 |
| `npm run check:worker` | ✅ PASS | 0 | 29 mục PASS | 125 |
| `npm run check:core` | ⊘ BỎ QUA | — | zoldify_1mall chỉ có 2 đơn, cổng này đòi ≥ 500k — nó thuộc zoldify_bulk_test (xem docs/BAN-GIAO.md mục 6: seed:bulk) | — |
| `npm run check:index` | ✅ PASS | 0 | 28 mục PASS | 35.3 |
| `npm run check:constraints` | ✅ PASS | 0 | 13 mục PASS | 61 |
| `npm run check:drift` | ✅ PASS | 0 | — | 32.3 |
| `npm run check:race` | ✅ PASS | 0 | 9 mục PASS | 47.5 |
| `npm run check:cache` | ✅ PASS | 0 | 7 mục PASS | 48.4 |
| `npm run check:stock` | ✅ PASS | 0 | 22 mục PASS | 74.8 |
| cây làm việc sạch | ✅ PASS | — | không có file chưa commit | — |

## Cổng bị bỏ qua

"Bỏ qua" KHÔNG phải "đạt" — những cổng này chưa chứng minh gì cả.

- `npm run check:core` — zoldify_1mall chỉ có 2 đơn, cổng này đòi ≥ 500k — nó thuộc zoldify_bulk_test (xem docs/BAN-GIAO.md mục 6: seed:bulk)

