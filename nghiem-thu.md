# Nghiệm thu

**Kết luận: CHƯA ĐỦ**

File này do `npm run nghiem-thu` ghi ra. Đừng sửa tay — sửa thì nó mất giá trị làm bằng chứng, và lượt chạy sau ghi đè.

- Lúc: 16:19:15 28/10/2026
- Nhánh: `perf/1m-index-cau-hinh`
- HEAD: `0728321` — style: gỡ 5 lỗi lint mới (any không an toàn ở migration 1788500000000, prettier ở spec)

| Cổng | Kết quả | Mã thoát | Số đo | Giây |
|---|---|---|---|---|
| `npm run build` | ✅ PASS | 0 | — | 23.9 |
| `npm run lint:check` | ✅ PASS | 0 | nợ 473 (446 lỗi + 27 cảnh báo) · mốc 519 | 52.9 |
| `npm run openapi:check` | ✅ PASS | 0 | 108 route · 69 schema | 31 |
| `npm test` | ✅ PASS | 0 | 109 passed, 109 total · 710 passed, 710 total | 352.3 |
| `npm run check:compose` | ✅ PASS | 0 | 35 mục PASS | 8.2 |
| `npm run check:boot` | ✅ PASS | 0 | 19 mục PASS | 126.4 |
| `npm run check:audit` | ✅ PASS | 0 | 21 mục PASS | 136.1 |
| `npm run check:ci` | ✅ PASS | 0 | 31 mục PASS | 7.3 |
| `npm run check:backup` | ✅ PASS | 0 | 25 mục PASS | 9 |
| `npm run check:redis` | ✅ PASS | 0 | 19 mục PASS | 10 |
| `npm run check:worker` | ✅ PASS | 0 | 29 mục PASS | 98.7 |
| `npm run check:core` | ⊘ BỎ QUA | — | zoldify_1mb chỉ có 2 đơn, cổng này đòi ≥ 500k — nó thuộc zoldify_bulk_test (xem docs/BAN-GIAO.md mục 6: seed:bulk) | — |
| `npm run check:index` | ✅ PASS | 0 | 28 mục PASS | 64.3 |
| `npm run check:constraints` | ✅ PASS | 0 | 13 mục PASS | 44.1 |
| `npm run check:drift` | ✅ PASS | 0 | — | 30.3 |
| `npm run check:race` | ✅ PASS | 0 | 9 mục PASS | 46.7 |
| `npm run check:cache` | ✅ PASS | 0 | 7 mục PASS | 41.9 |
| `npm run check:stock` | ✅ PASS | 0 | 22 mục PASS | 109.8 |
| cây làm việc sạch | ✅ PASS | — | không có file chưa commit | — |

## Cổng bị bỏ qua

"Bỏ qua" KHÔNG phải "đạt" — những cổng này chưa chứng minh gì cả.

- `npm run check:core` — zoldify_1mb chỉ có 2 đơn, cổng này đòi ≥ 500k — nó thuộc zoldify_bulk_test (xem docs/BAN-GIAO.md mục 6: seed:bulk)

