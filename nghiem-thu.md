# Nghiệm thu

**Kết luận: CHƯA ĐỦ**

File này do `npm run nghiem-thu` ghi ra. Đừng sửa tay — sửa thì nó mất giá trị làm bằng chứng, và lượt chạy sau ghi đè.

- Lúc: 17:00:29 28/10/2026
- Nhánh: `perf/1m-truy-van`
- HEAD: `af693b4` — style: gỡ nợ lint của đợt 1M (kiểu hoá bộ lọc sản phẩm, where người dùng/đánh giá)

| Cổng | Kết quả | Mã thoát | Số đo | Giây |
|---|---|---|---|---|
| `npm run build` | ✅ PASS | 0 | — | 26.1 |
| `npm run lint:check` | ✅ PASS | 0 | nợ 458 (431 lỗi + 27 cảnh báo) · mốc 519 | 72 |
| `npm run openapi:check` | ✅ PASS | 0 | 108 route · 69 schema | 36.5 |
| `npm test` | ✅ PASS | 0 | 116 passed, 116 total · 736 passed, 736 total | 231.3 |
| `npm run check:compose` | ✅ PASS | 0 | 23 mục PASS | 5.2 |
| `npm run check:boot` | ✅ PASS | 0 | 19 mục PASS | 40.5 |
| `npm run check:audit` | ✅ PASS | 0 | 21 mục PASS | 47.1 |
| `npm run check:ci` | ✅ PASS | 0 | 31 mục PASS | 6.3 |
| `npm run check:backup` | ✅ PASS | 0 | 25 mục PASS | 6.9 |
| `npm run check:redis` | ✅ PASS | 0 | 19 mục PASS | 8 |
| `npm run check:worker` | ✅ PASS | 0 | 29 mục PASS | 48.1 |
| `npm run check:core` | ⊘ BỎ QUA | — | zoldify_1mc chỉ có 4 đơn, cổng này đòi ≥ 500k — nó thuộc zoldify_bulk_test (xem docs/BAN-GIAO.md mục 6: seed:bulk) | — |
| `npm run check:index` | ✅ PASS | 0 | 15 mục PASS | 30.9 |
| `npm run check:constraints` | ✅ PASS | 0 | 13 mục PASS | 28.8 |
| `npm run check:drift` | ✅ PASS | 0 | — | 25.9 |
| `npm run check:race` | ✅ PASS | 0 | 9 mục PASS | 44.2 |
| `npm run check:cache` | ✅ PASS | 0 | 7 mục PASS | 35.5 |
| `npm run check:stock` | ✅ PASS | 0 | 22 mục PASS | 58 |
| cây làm việc sạch | ✅ PASS | — | không có file chưa commit | — |

## Cổng bị bỏ qua

"Bỏ qua" KHÔNG phải "đạt" — những cổng này chưa chứng minh gì cả.

- `npm run check:core` — zoldify_1mc chỉ có 4 đơn, cổng này đòi ≥ 500k — nó thuộc zoldify_bulk_test (xem docs/BAN-GIAO.md mục 6: seed:bulk)

