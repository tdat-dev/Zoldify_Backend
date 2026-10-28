# Nghiệm thu

**Kết luận: CHƯA ĐỦ**

File này do `npm run nghiem-thu` ghi ra. Đừng sửa tay — sửa thì nó mất giá trị làm bằng chứng, và lượt chạy sau ghi đè.

- Lúc: 15:54:02 28/10/2026
- Nhánh: `fix/1m-duong-sap`
- HEAD: `ab10879` — style: bỏ dấu gạch dài trong comment và log mới thêm

| Cổng | Kết quả | Mã thoát | Số đo | Giây |
|---|---|---|---|---|
| `npm run build` | ✅ PASS | 0 | — | 39.9 |
| `npm run lint:check` | ✅ PASS | 0 | nợ 473 (446 lỗi + 27 cảnh báo) · mốc 519 | 58.3 |
| `npm run openapi:check` | ✅ PASS | 0 | 108 route · 69 schema | 42.9 |
| `npm test` | ✅ PASS | 0 | 111 passed, 111 total · 709 passed, 709 total | 228.6 |
| `npm run check:compose` | ✅ PASS | 0 | 23 mục PASS | 8 |
| `npm run check:boot` | ✅ PASS | 0 | 19 mục PASS | 56.5 |
| `npm run check:audit` | ✅ PASS | 0 | 21 mục PASS | 48.2 |
| `npm run check:ci` | ✅ PASS | 0 | 31 mục PASS | 5.3 |
| `npm run check:backup` | ✅ PASS | 0 | 25 mục PASS | 5.9 |
| `npm run check:redis` | ✅ PASS | 0 | 19 mục PASS | 7.7 |
| `npm run check:worker` | ✅ PASS | 0 | 29 mục PASS | 48.8 |
| `npm run check:core` | ⊘ BỎ QUA | — | zoldify_1ma chỉ có 4 đơn, cổng này đòi ≥ 500k — nó thuộc zoldify_bulk_test (xem docs/BAN-GIAO.md mục 6: seed:bulk) | — |
| `npm run check:index` | ✅ PASS | 0 | 15 mục PASS | 31.8 |
| `npm run check:constraints` | ✅ PASS | 0 | 13 mục PASS | 29.4 |
| `npm run check:drift` | ✅ PASS | 0 | — | 33.8 |
| `npm run check:race` | ✅ PASS | 0 | 9 mục PASS | 39.7 |
| `npm run check:cache` | ✅ PASS | 0 | 7 mục PASS | 33.8 |
| `npm run check:stock` | ✅ PASS | 0 | 22 mục PASS | 50.8 |
| cây làm việc sạch | ✅ PASS | — | không có file chưa commit | — |

## Cổng bị bỏ qua

"Bỏ qua" KHÔNG phải "đạt" — những cổng này chưa chứng minh gì cả.

- `npm run check:core` — zoldify_1ma chỉ có 4 đơn, cổng này đòi ≥ 500k — nó thuộc zoldify_bulk_test (xem docs/BAN-GIAO.md mục 6: seed:bulk)

