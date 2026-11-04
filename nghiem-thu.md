# Nghiệm thu

**Kết luận: CHƯA ĐỦ**

File này do `npm run nghiem-thu` ghi ra. Đừng sửa tay — sửa thì nó mất giá trị làm bằng chứng, và lượt chạy sau ghi đè.

- Lúc: 20:46:49 4/11/2026
- Nhánh: `fix/theo-doi-dat-trang-thai`
- HEAD: `3edaaf5` — docs: sinh lại openapi.json cho PUT và DELETE /follows/:sellerId

| Cổng | Kết quả | Mã thoát | Số đo | Giây |
|---|---|---|---|---|
| `npm run build` | ✅ PASS | 0 | — | 24.5 |
| `npm run lint:check` | ✅ PASS | 0 | nợ 456 (415 lỗi + 41 cảnh báo) · mốc 519 | 59.7 |
| `npm run openapi:check` | ✅ PASS | 0 | 110 route · 69 schema | 30.6 |
| `npm test` | ✅ PASS | 0 | 135 passed, 135 total · 878 passed, 878 total | 243.4 |
| `npm run check:compose` | ✅ PASS | 0 | 35 mục PASS | 5.2 |
| `npm run check:boot` | ✅ PASS | 0 | 19 mục PASS | 40.4 |
| `npm run check:audit` | ✅ PASS | 0 | 21 mục PASS | 37.1 |
| `npm run check:ci` | ✅ PASS | 0 | 31 mục PASS | 4.8 |
| `npm run check:backup` | ✅ PASS | 0 | 25 mục PASS | 5.2 |
| `npm run check:redis` | ✅ PASS | 0 | 19 mục PASS | 6.1 |
| `npm run check:worker` | ✅ PASS | 0 | 29 mục PASS | 42.8 |
| `npm run check:core` | ⊘ BỎ QUA | — | zoldify_race chỉ có 0 đơn, cổng này đòi ≥ 500k — nó thuộc zoldify_bulk_test (xem docs/BAN-GIAO.md mục 6: seed:bulk) | — |
| `npm run check:index` | ✅ PASS | 0 | 35 mục PASS | 22.6 |
| `npm run check:constraints` | ✅ PASS | 0 | 13 mục PASS | 28.3 |
| `npm run check:drift` | ✅ PASS | 0 | — | 31 |
| `npm run check:race` | ✅ PASS | 0 | 9 mục PASS | 40.6 |
| `npm run check:cache` | ✅ PASS | 0 | 7 mục PASS | 33.7 |
| `npm run check:stock` | ✅ PASS | 0 | 22 mục PASS | 54.5 |
| cây làm việc sạch | ✅ PASS | — | không có file chưa commit | — |

## Cổng bị bỏ qua

"Bỏ qua" KHÔNG phải "đạt" — những cổng này chưa chứng minh gì cả.

- `npm run check:core` — zoldify_race chỉ có 0 đơn, cổng này đòi ≥ 500k — nó thuộc zoldify_bulk_test (xem docs/BAN-GIAO.md mục 6: seed:bulk)

