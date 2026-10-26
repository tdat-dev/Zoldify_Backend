# Nghiệm thu

**Kết luận: CHƯA ĐỦ**

File này do `npm run nghiem-thu` ghi ra. Đừng sửa tay — sửa thì nó mất giá trị làm bằng chứng, và lượt chạy sau ghi đè.

- Lúc: 15:32:52 26/10/2026
- Nhánh: `fix/dot-sua-25-10`
- HEAD: `2b2ab8f` — chore: ghim LF cho openapi.json để nghiem-thu không báo cây bẩn trên Windows

| Cổng | Kết quả | Mã thoát | Số đo | Giây |
|---|---|---|---|---|
| `npm run build` | ✅ PASS | 0 | — | 17.5 |
| `npm run lint:check` | ✅ PASS | 0 | nợ 503 (474 lỗi + 29 cảnh báo) · mốc 519 | 38 |
| `npm run openapi:check` | ✅ PASS | 0 | 106 route · 67 schema | 25.4 |
| `npm test` | ✅ PASS | 0 | 80 passed, 80 total · 507 passed, 507 total | 104.1 |
| `npm run check:compose` | ✅ PASS | 0 | 23 mục PASS | 3.8 |
| `npm run check:boot` | ✅ PASS | 0 | 19 mục PASS | 33.1 |
| `npm run check:audit` | ✅ PASS | 0 | 21 mục PASS | 41.7 |
| `npm run check:ci` | ✅ PASS | 0 | 31 mục PASS | 6.2 |
| `npm run check:backup` | ✅ PASS | 0 | 25 mục PASS | 11.4 |
| `npm run check:redis` | ✅ PASS | 0 | 19 mục PASS | 13.3 |
| `npm run check:worker` | ✅ PASS | 0 | 29 mục PASS | 51.7 |
| `npm run check:core` | ⊘ BỎ QUA | — | zoldify_race chỉ có 0 đơn, cổng này đòi ≥ 500k — nó thuộc zoldify_bulk_test (xem docs/BAN-GIAO.md mục 6: seed:bulk) | — |
| `npm run check:index` | ✅ PASS | 0 | 15 mục PASS | 20.8 |
| `npm run check:constraints` | ✅ PASS | 0 | 13 mục PASS | 21.3 |
| `npm run check:drift` | ✅ PASS | 0 | — | 21.1 |
| `npm run check:race` | ✅ PASS | 0 | 9 mục PASS | 32.2 |
| `npm run check:cache` | ✅ PASS | 0 | 7 mục PASS | 26.2 |
| `npm run check:stock` | ✅ PASS | 0 | 22 mục PASS | 42.9 |
| cây làm việc sạch | ✅ PASS | — | không có file chưa commit | — |

## Cổng bị bỏ qua

"Bỏ qua" KHÔNG phải "đạt" — những cổng này chưa chứng minh gì cả.

- `npm run check:core` — zoldify_race chỉ có 0 đơn, cổng này đòi ≥ 500k — nó thuộc zoldify_bulk_test (xem docs/BAN-GIAO.md mục 6: seed:bulk)

