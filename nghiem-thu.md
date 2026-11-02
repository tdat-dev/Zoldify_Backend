# Nghiệm thu

**Kết luận: CHƯA ĐỦ**

File này do `npm run nghiem-thu` ghi ra. Đừng sửa tay — sửa thì nó mất giá trị làm bằng chứng, và lượt chạy sau ghi đè.

- Lúc: 14:26:14 2/11/2026
- Nhánh: `perf/1m-tong-hop`
- HEAD: `14d4cc9` — test(orders): ép đường EXISTS trong bài đơn bán thay vì dựa vào MAX(id) của DB test

| Cổng | Kết quả | Mã thoát | Số đo | Giây |
|---|---|---|---|---|
| `npm run build` | ✅ PASS | 0 | — | 40.6 |
| `npm run lint:check` | ✅ PASS | 0 | nợ 464 (434 lỗi + 30 cảnh báo) · mốc 519 | 92 |
| `npm run openapi:check` | ✅ PASS | 0 | 108 route · 69 schema | 41.2 |
| `npm test` | ✅ PASS | 0 | 128 passed, 128 total · 796 passed, 796 total | 422 |
| `npm run check:compose` | ✅ PASS | 0 | 35 mục PASS | 11.7 |
| `npm run check:boot` | ✅ PASS | 0 | 19 mục PASS | 93.3 |
| `npm run check:audit` | ✅ PASS | 0 | 21 mục PASS | 79.5 |
| `npm run check:ci` | ✅ PASS | 0 | 31 mục PASS | 6.9 |
| `npm run check:backup` | ✅ PASS | 0 | 25 mục PASS | 7.2 |
| `npm run check:redis` | ✅ PASS | 0 | 19 mục PASS | 8.4 |
| `npm run check:worker` | ✅ PASS | 0 | 29 mục PASS | 62.2 |
| `npm run check:core` | ⊘ BỎ QUA | — | zoldify_1m_gate chỉ có 0 đơn, cổng này đòi ≥ 500k — nó thuộc zoldify_bulk_test (xem docs/BAN-GIAO.md mục 6: seed:bulk) | — |
| `npm run check:index` | ✅ PASS | 0 | 35 mục PASS | 54.3 |
| `npm run check:constraints` | ✅ PASS | 0 | 13 mục PASS | 70.1 |
| `npm run check:drift` | ✅ PASS | 0 | — | 45.9 |
| `npm run check:race` | ✅ PASS | 0 | 9 mục PASS | 96.2 |
| `npm run check:cache` | ✅ PASS | 0 | 7 mục PASS | 70.4 |
| `npm run check:stock` | ✅ PASS | 0 | 22 mục PASS | 86.9 |
| cây làm việc sạch | ✅ PASS | — | không có file chưa commit | — |

## Cổng bị bỏ qua

"Bỏ qua" KHÔNG phải "đạt" — những cổng này chưa chứng minh gì cả.

- `npm run check:core` — zoldify_1m_gate chỉ có 0 đơn, cổng này đòi ≥ 500k — nó thuộc zoldify_bulk_test (xem docs/BAN-GIAO.md mục 6: seed:bulk)

