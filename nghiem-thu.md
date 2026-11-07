# Nghiệm thu

**Kết luận: CHƯA ĐỦ**

File này do `npm run nghiem-thu` ghi ra. Đừng sửa tay — sửa thì nó mất giá trị làm bằng chứng, và lượt chạy sau ghi đè.

- Lúc: 18:42:18 7/11/2026
- Nhánh: `fix/test-chap-chon`
- HEAD: `b6ab62d` — fix: nghiem-thu giữ tên bài đỏ và nội dung lỗi của jest

| Cổng | Kết quả | Mã thoát | Số đo | Giây |
|---|---|---|---|---|
| `npm run build` | ✅ PASS | 0 | — | 33.3 |
| `npm run lint:check` | ✅ PASS | 0 | nợ 462 (421 lỗi + 41 cảnh báo) · mốc 519 | 73.9 |
| `npm run openapi:check` | ✅ PASS | 0 | 111 route · 69 schema | 52.5 |
| `npm test` | ✅ PASS | 0 | 142 passed, 142 total · 969 passed, 969 total | 432.9 |
| `npm run check:compose` | ✅ PASS | 0 | 36 mục PASS | 8.2 |
| `npm run check:boot` | ✅ PASS | 0 | 19 mục PASS | 101.7 |
| `npm run check:audit` | ✅ PASS | 0 | 21 mục PASS | 106.7 |
| `npm run check:ci` | ✅ PASS | 0 | 34 mục PASS | 16 |
| `npm run check:backup` | ✅ PASS | 0 | 25 mục PASS | 11.8 |
| `npm run check:redis` | ✅ PASS | 0 | 19 mục PASS | 11.1 |
| `npm run check:worker` | ✅ PASS | 0 | 29 mục PASS | 62.3 |
| `npm run check:core` | ⊘ BỎ QUA | — | zoldify_race chỉ có 1 đơn, cổng này đòi ≥ 500k — nó thuộc zoldify_bulk_test (xem docs/BAN-GIAO.md mục 6: seed:bulk) | — |
| `npm run check:index` | ✅ PASS | 0 | 38 mục PASS | 39.5 |
| `npm run check:constraints` | ✅ PASS | 0 | 13 mục PASS | 45.2 |
| `npm run check:drift` | ✅ PASS | 0 | — | 54.5 |
| `npm run check:race` | ✅ PASS | 0 | 9 mục PASS | 55.2 |
| `npm run check:cache` | ✅ PASS | 0 | 7 mục PASS | 50.2 |
| `npm run check:stock` | ✅ PASS | 0 | 22 mục PASS | 60.4 |
| cây làm việc sạch | ✅ PASS | — | không có file chưa commit | — |

## Cổng bị bỏ qua

"Bỏ qua" KHÔNG phải "đạt" — những cổng này chưa chứng minh gì cả.

- `npm run check:core` — zoldify_race chỉ có 1 đơn, cổng này đòi ≥ 500k — nó thuộc zoldify_bulk_test (xem docs/BAN-GIAO.md mục 6: seed:bulk)

