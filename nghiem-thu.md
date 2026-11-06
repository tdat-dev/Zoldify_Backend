# Nghiệm thu

**Kết luận: CHƯA ĐỦ**

File này do `npm run nghiem-thu` ghi ra. Đừng sửa tay — sửa thì nó mất giá trị làm bằng chứng, và lượt chạy sau ghi đè.

- Lúc: 17:03:36 6/11/2026
- Nhánh: `fix/van-don-don-tra-truoc`
- HEAD: `98d43e7` — fix: fix(don-hang): tạo vận đơn cho đơn trả trước ở bước chuẩn bị hàng

| Cổng | Kết quả | Mã thoát | Số đo | Giây |
|---|---|---|---|---|
| `npm run build` | ✅ PASS | 0 | — | 30.2 |
| `npm run lint:check` | ✅ PASS | 0 | nợ 451 (410 lỗi + 41 cảnh báo) · mốc 519 | 68.9 |
| `npm run openapi:check` | ✅ PASS | 0 | 110 route · 69 schema | 36 |
| `npm test` | ✅ PASS | 0 | 138 passed, 138 total · 925 passed, 925 total | 299.1 |
| `npm run check:compose` | ✅ PASS | 0 | 36 mục PASS | 6.6 |
| `npm run check:boot` | ✅ PASS | 0 | 19 mục PASS | 102.1 |
| `npm run check:audit` | ✅ PASS | 0 | 21 mục PASS | 65.5 |
| `npm run check:ci` | ✅ PASS | 0 | 31 mục PASS | 8.6 |
| `npm run check:backup` | ✅ PASS | 0 | 25 mục PASS | 6.5 |
| `npm run check:redis` | ✅ PASS | 0 | 19 mục PASS | 7.3 |
| `npm run check:worker` | ✅ PASS | 0 | 29 mục PASS | 86.8 |
| `npm run check:core` | ⊘ BỎ QUA | — | zoldify_race chỉ có 2 đơn, cổng này đòi ≥ 500k — nó thuộc zoldify_bulk_test (xem docs/BAN-GIAO.md mục 6: seed:bulk) | — |
| `npm run check:index` | ✅ PASS | 0 | 38 mục PASS | 53.2 |
| `npm run check:constraints` | ✅ PASS | 0 | 13 mục PASS | 38.3 |
| `npm run check:drift` | ✅ PASS | 0 | — | 47.3 |
| `npm run check:race` | ✅ PASS | 0 | 9 mục PASS | 67.9 |
| `npm run check:cache` | ✅ PASS | 0 | 7 mục PASS | 44.3 |
| `npm run check:stock` | ✅ PASS | 0 | 22 mục PASS | 49.6 |
| cây làm việc sạch | ✅ PASS | — | không có file chưa commit | — |

## Cổng bị bỏ qua

"Bỏ qua" KHÔNG phải "đạt" — những cổng này chưa chứng minh gì cả.

- `npm run check:core` — zoldify_race chỉ có 2 đơn, cổng này đòi ≥ 500k — nó thuộc zoldify_bulk_test (xem docs/BAN-GIAO.md mục 6: seed:bulk)

