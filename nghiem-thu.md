# Nghiệm thu

**Kết luận: CHƯA ĐỦ**

File này do `npm run nghiem-thu` ghi ra. Đừng sửa tay — sửa thì nó mất giá trị làm bằng chứng, và lượt chạy sau ghi đè.

- Lúc: 00:37:12 6/11/2026
- Nhánh: `fix/loc-gia-1m`
- HEAD: `4ab1fa7` — perf(san-pham): index phủ cho câu đếm theo khoảng giá

| Cổng | Kết quả | Mã thoát | Số đo | Giây |
|---|---|---|---|---|
| `npm run build` | ✅ PASS | 0 | — | 34.9 |
| `npm run lint:check` | ✅ PASS | 0 | nợ 451 (410 lỗi + 41 cảnh báo) · mốc 519 | 64.4 |
| `npm run openapi:check` | ✅ PASS | 0 | 110 route · 69 schema | 28.2 |
| `npm test` | ✅ PASS | 0 | 138 passed, 138 total · 921 passed, 921 total | 285.1 |
| `npm run check:compose` | ✅ PASS | 0 | 36 mục PASS | 6 |
| `npm run check:boot` | ✅ PASS | 0 | 19 mục PASS | 68.5 |
| `npm run check:audit` | ✅ PASS | 0 | 21 mục PASS | 71.6 |
| `npm run check:ci` | ✅ PASS | 0 | 31 mục PASS | 10.3 |
| `npm run check:backup` | ✅ PASS | 0 | 25 mục PASS | 7.8 |
| `npm run check:redis` | ✅ PASS | 0 | 19 mục PASS | 11.8 |
| `npm run check:worker` | ✅ PASS | 0 | 29 mục PASS | 70.1 |
| `npm run check:core` | ⊘ BỎ QUA | — | zoldify_race chỉ có 0 đơn, cổng này đòi ≥ 500k — nó thuộc zoldify_bulk_test (xem docs/BAN-GIAO.md mục 6: seed:bulk) | — |
| `npm run check:index` | ✅ PASS | 0 | 38 mục PASS | 40.8 |
| `npm run check:constraints` | ✅ PASS | 0 | 13 mục PASS | 43.9 |
| `npm run check:drift` | ✅ PASS | 0 | — | 34.8 |
| `npm run check:race` | ✅ PASS | 0 | 9 mục PASS | 57 |
| `npm run check:cache` | ✅ PASS | 0 | 7 mục PASS | 80.6 |
| `npm run check:stock` | ✅ PASS | 0 | 22 mục PASS | 86.5 |
| cây làm việc sạch | ✅ PASS | — | không có file chưa commit | — |

## Cổng bị bỏ qua

"Bỏ qua" KHÔNG phải "đạt" — những cổng này chưa chứng minh gì cả.

- `npm run check:core` — zoldify_race chỉ có 0 đơn, cổng này đòi ≥ 500k — nó thuộc zoldify_bulk_test (xem docs/BAN-GIAO.md mục 6: seed:bulk)

