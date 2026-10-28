# Nghiệm thu

**Kết luận: CHƯA ĐỦ**

File này do `npm run nghiem-thu` ghi ra. Đừng sửa tay — sửa thì nó mất giá trị làm bằng chứng, và lượt chạy sau ghi đè.

- Lúc: 16:38:10 28/10/2026
- Nhánh: `perf/1m-truy-van`
- HEAD: `2759233` — docs: sửa tên collation trong ghi chú tìm từ ngắn (utf8mb4_unicode_ci của compose)

| Cổng | Kết quả | Mã thoát | Số đo | Giây |
|---|---|---|---|---|
| `npm run build` | ✅ PASS | 0 | — | 23 |
| `npm run lint:check` | ✅ PASS | 0 | nợ 496 (469 lỗi + 27 cảnh báo) · mốc 519 | 45.3 |
| `npm run openapi:check` | ✅ PASS | 0 | 108 route · 69 schema | 29.3 |
| `npm test` | ✅ PASS | 0 | 116 passed, 116 total · 736 passed, 736 total | 161.3 |
| `npm run check:compose` | ✅ PASS | 0 | 23 mục PASS | 4.3 |
| `npm run check:boot` | ✅ PASS | 0 | 19 mục PASS | 35.5 |
| `npm run check:audit` | ✅ PASS | 0 | 21 mục PASS | 34.9 |
| `npm run check:ci` | ✅ PASS | 0 | 31 mục PASS | 4.2 |
| `npm run check:backup` | ✅ PASS | 0 | 25 mục PASS | 4.8 |
| `npm run check:redis` | ✅ PASS | 0 | 19 mục PASS | 6.4 |
| `npm run check:worker` | ✅ PASS | 0 | 29 mục PASS | 37.9 |
| `npm run check:core` | ⊘ BỎ QUA | — | zoldify_1mc chỉ có 4 đơn, cổng này đòi ≥ 500k — nó thuộc zoldify_bulk_test (xem docs/BAN-GIAO.md mục 6: seed:bulk) | — |
| `npm run check:index` | ✅ PASS | 0 | 15 mục PASS | 23.7 |
| `npm run check:constraints` | ✅ PASS | 0 | 13 mục PASS | 30.8 |
| `npm run check:drift` | ✅ PASS | 0 | — | 54.3 |
| `npm run check:race` | ✅ PASS | 0 | 9 mục PASS | 75 |
| `npm run check:cache` | ✅ PASS | 0 | 7 mục PASS | 51.8 |
| `npm run check:stock` | ✅ PASS | 0 | 22 mục PASS | 59.7 |
| cây làm việc sạch | ✅ PASS | — | không có file chưa commit | — |

## Cổng bị bỏ qua

"Bỏ qua" KHÔNG phải "đạt" — những cổng này chưa chứng minh gì cả.

- `npm run check:core` — zoldify_1mc chỉ có 4 đơn, cổng này đòi ≥ 500k — nó thuộc zoldify_bulk_test (xem docs/BAN-GIAO.md mục 6: seed:bulk)

