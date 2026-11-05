# Nghiệm thu

**Kết luận: CHƯA ĐỦ**

File này do `npm run nghiem-thu` ghi ra. Đừng sửa tay — sửa thì nó mất giá trị làm bằng chứng, và lượt chạy sau ghi đè.

- Lúc: 23:18:33 5/11/2026
- Nhánh: `fix/lich-su-vi-ky-quy-1m`
- HEAD: `367fa04` — perf(vi): đếm lịch sử ví không nối sang ledger_transactions khi không lọc loại

| Cổng | Kết quả | Mã thoát | Số đo | Giây |
|---|---|---|---|---|
| `npm run build` | ✅ PASS | 0 | — | 27.2 |
| `npm run lint:check` | ✅ PASS | 0 | nợ 451 (410 lỗi + 41 cảnh báo) · mốc 519 | 48.1 |
| `npm run openapi:check` | ✅ PASS | 0 | 110 route · 69 schema | 30 |
| `npm test` | ✅ PASS | 0 | 138 passed, 138 total · 921 passed, 921 total | 373.9 |
| `npm run check:compose` | ✅ PASS | 0 | 36 mục PASS | 4.4 |
| `npm run check:boot` | ✅ PASS | 0 | 19 mục PASS | 90.1 |
| `npm run check:audit` | ✅ PASS | 0 | 21 mục PASS | 47.5 |
| `npm run check:ci` | ✅ PASS | 0 | 31 mục PASS | 5.9 |
| `npm run check:backup` | ✅ PASS | 0 | 25 mục PASS | 7.2 |
| `npm run check:redis` | ✅ PASS | 0 | 19 mục PASS | 13.1 |
| `npm run check:worker` | ✅ PASS | 0 | 29 mục PASS | 84.4 |
| `npm run check:core` | ⊘ BỎ QUA | — | zoldify_race chỉ có 0 đơn, cổng này đòi ≥ 500k — nó thuộc zoldify_bulk_test (xem docs/BAN-GIAO.md mục 6: seed:bulk) | — |
| `npm run check:index` | ✅ PASS | 0 | 37 mục PASS | 34.8 |
| `npm run check:constraints` | ✅ PASS | 0 | 13 mục PASS | 25.5 |
| `npm run check:drift` | ✅ PASS | 0 | — | 23 |
| `npm run check:race` | ✅ PASS | 0 | 9 mục PASS | 39.9 |
| `npm run check:cache` | ✅ PASS | 0 | 7 mục PASS | 35.6 |
| `npm run check:stock` | ✅ PASS | 0 | 22 mục PASS | 102.3 |
| cây làm việc sạch | ✅ PASS | — | không có file chưa commit | — |

## Cổng bị bỏ qua

"Bỏ qua" KHÔNG phải "đạt" — những cổng này chưa chứng minh gì cả.

- `npm run check:core` — zoldify_race chỉ có 0 đơn, cổng này đòi ≥ 500k — nó thuộc zoldify_bulk_test (xem docs/BAN-GIAO.md mục 6: seed:bulk)

