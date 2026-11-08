# Nghiệm thu

**Kết luận: CHƯA ĐỦ**

File này do `npm run nghiem-thu` ghi ra. Đừng sửa tay — sửa thì nó mất giá trị làm bằng chứng, và lượt chạy sau ghi đè.

- Lúc: 23:30:00 8/11/2026
- Nhánh: `feat/do-ben-san-pham`
- HEAD: `d8687e8` — feat: script seed:do-ben điền thẻ độ bền mẫu, có đường lùi so từng dòng

| Cổng | Kết quả | Mã thoát | Số đo | Giây |
|---|---|---|---|---|
| `npm run build` | ✅ PASS | 0 | — | 44.4 |
| `npm run lint:check` | ✅ PASS | 0 | nợ 468 (427 lỗi + 41 cảnh báo) · mốc 519 | 90.6 |
| `npm run openapi:check` | ✅ PASS | 0 | 113 route · 70 schema | 42.8 |
| `npm test` | ✅ PASS | 0 | 146 passed, 146 total · 1015 passed, 1015 total | 381.2 |
| `npm run check:compose` | ✅ PASS | 0 | 36 mục PASS | 3.1 |
| `npm run check:boot` | ✅ PASS | 0 | 19 mục PASS | 38.3 |
| `npm run check:audit` | ✅ PASS | 0 | 21 mục PASS | 41.6 |
| `npm run check:ci` | ✅ PASS | 0 | 34 mục PASS | 5.5 |
| `npm run check:backup` | ✅ PASS | 0 | 25 mục PASS | 5 |
| `npm run check:redis` | ✅ PASS | 0 | 19 mục PASS | 6.8 |
| `npm run check:worker` | ✅ PASS | 0 | 29 mục PASS | 32.1 |
| `npm run check:core` | ⊘ BỎ QUA | — | zoldify_race chỉ có 0 đơn, cổng này đòi ≥ 500k — nó thuộc zoldify_bulk_test (xem docs/BAN-GIAO.md mục 6: seed:bulk) | — |
| `npm run check:index` | ✅ PASS | 0 | 38 mục PASS | 20.2 |
| `npm run check:constraints` | ✅ PASS | 0 | 13 mục PASS | 23.6 |
| `npm run check:drift` | ✅ PASS | 0 | — | 29.6 |
| `npm run check:race` | ✅ PASS | 0 | 9 mục PASS | 36.5 |
| `npm run check:cache` | ✅ PASS | 0 | 7 mục PASS | 35.3 |
| `npm run check:stock` | ✅ PASS | 0 | 22 mục PASS | 57.1 |
| cây làm việc sạch | ✅ PASS | — | không có file chưa commit | — |

## Cổng bị bỏ qua

"Bỏ qua" KHÔNG phải "đạt" — những cổng này chưa chứng minh gì cả.

- `npm run check:core` — zoldify_race chỉ có 0 đơn, cổng này đòi ≥ 500k — nó thuộc zoldify_bulk_test (xem docs/BAN-GIAO.md mục 6: seed:bulk)

