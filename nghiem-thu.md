# Nghiệm thu

**Kết luận: CHƯA ĐỦ**

File này do `npm run nghiem-thu` ghi ra. Đừng sửa tay — sửa thì nó mất giá trị làm bằng chứng, và lượt chạy sau ghi đè.

- Lúc: 23:46:45 26/10/2026
- Nhánh: `fix/validation-van-hanh`
- HEAD: `b236641` — style: prettier cho spec unref Redis (nợ lint về lại 481)

| Cổng | Kết quả | Mã thoát | Số đo | Giây |
|---|---|---|---|---|
| `npm run build` | ✅ PASS | 0 | — | 23.1 |
| `npm run lint:check` | ✅ PASS | 0 | nợ 481 (454 lỗi + 27 cảnh báo) · mốc 519 | 40.8 |
| `npm run openapi:check` | ✅ PASS | 0 | 108 route · 68 schema | 29.2 |
| `npm test` | ✅ PASS | 0 | 92 passed, 92 total · 603 passed, 603 total | 161.2 |
| `npm run check:compose` | ✅ PASS | 0 | 23 mục PASS | 5.7 |
| `npm run check:boot` | ✅ PASS | 0 | 19 mục PASS | 39.8 |
| `npm run check:audit` | ✅ PASS | 0 | 21 mục PASS | 41 |
| `npm run check:ci` | ✅ PASS | 0 | 31 mục PASS | 5.2 |
| `npm run check:backup` | ✅ PASS | 0 | 25 mục PASS | 5.7 |
| `npm run check:redis` | ✅ PASS | 0 | 19 mục PASS | 7.1 |
| `npm run check:worker` | ✅ PASS | 0 | 29 mục PASS | 43.1 |
| `npm run check:core` | ⊘ BỎ QUA | — | zoldify_race chỉ có 0 đơn, cổng này đòi ≥ 500k — nó thuộc zoldify_bulk_test (xem docs/BAN-GIAO.md mục 6: seed:bulk) | — |
| `npm run check:index` | ✅ PASS | 0 | 15 mục PASS | 29.2 |
| `npm run check:constraints` | ✅ PASS | 0 | 13 mục PASS | 23.1 |
| `npm run check:drift` | ✅ PASS | 0 | — | 24.9 |
| `npm run check:race` | ✅ PASS | 0 | 9 mục PASS | 39.6 |
| `npm run check:cache` | ✅ PASS | 0 | 7 mục PASS | 33.5 |
| `npm run check:stock` | ✅ PASS | 0 | 22 mục PASS | 48.7 |
| cây làm việc sạch | ✅ PASS | — | không có file chưa commit | — |

## Cổng bị bỏ qua

"Bỏ qua" KHÔNG phải "đạt" — những cổng này chưa chứng minh gì cả.

- `npm run check:core` — zoldify_race chỉ có 0 đơn, cổng này đòi ≥ 500k — nó thuộc zoldify_bulk_test (xem docs/BAN-GIAO.md mục 6: seed:bulk)

