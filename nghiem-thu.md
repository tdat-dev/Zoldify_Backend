# Nghiệm thu

**Kết luận: CHƯA ĐỦ**

File này do `npm run nghiem-thu` ghi ra. Đừng sửa tay — sửa thì nó mất giá trị làm bằng chứng, và lượt chạy sau ghi đè.

- Lúc: 17:47:54 27/10/2026
- Nhánh: `fix/thong-bao-va-van-don`
- HEAD: `e0882e8` — style: gỡ nợ lint của đợt sửa review (ép kiểu thừa, tham số không dùng)

| Cổng | Kết quả | Mã thoát | Số đo | Giây |
|---|---|---|---|---|
| `npm run build` | ✅ PASS | 0 | — | 43 |
| `npm run lint:check` | ✅ PASS | 0 | nợ 473 (446 lỗi + 27 cảnh báo) · mốc 519 | 71.7 |
| `npm run openapi:check` | ✅ PASS | 0 | 108 route · 69 schema | 42.8 |
| `npm test` | ✅ PASS | 0 | 107 passed, 107 total · 700 passed, 700 total | 209.1 |
| `npm run check:compose` | ✅ PASS | 0 | 23 mục PASS | 11.2 |
| `npm run check:boot` | ✅ PASS | 0 | 19 mục PASS | 77.6 |
| `npm run check:audit` | ✅ PASS | 0 | 21 mục PASS | 63.7 |
| `npm run check:ci` | ✅ PASS | 0 | 31 mục PASS | 6 |
| `npm run check:backup` | ✅ PASS | 0 | 25 mục PASS | 7.6 |
| `npm run check:redis` | ✅ PASS | 0 | 19 mục PASS | 9.3 |
| `npm run check:worker` | ✅ PASS | 0 | 29 mục PASS | 60.5 |
| `npm run check:core` | ⊘ BỎ QUA | — | zoldify_race chỉ có 0 đơn, cổng này đòi ≥ 500k — nó thuộc zoldify_bulk_test (xem docs/BAN-GIAO.md mục 6: seed:bulk) | — |
| `npm run check:index` | ✅ PASS | 0 | 15 mục PASS | 31.9 |
| `npm run check:constraints` | ✅ PASS | 0 | 13 mục PASS | 49.3 |
| `npm run check:drift` | ✅ PASS | 0 | — | 38.6 |
| `npm run check:race` | ✅ PASS | 0 | 9 mục PASS | 54.1 |
| `npm run check:cache` | ✅ PASS | 0 | 7 mục PASS | 37.4 |
| `npm run check:stock` | ✅ PASS | 0 | 22 mục PASS | 57.8 |
| cây làm việc sạch | ✅ PASS | — | không có file chưa commit | — |

## Cổng bị bỏ qua

"Bỏ qua" KHÔNG phải "đạt" — những cổng này chưa chứng minh gì cả.

- `npm run check:core` — zoldify_race chỉ có 0 đơn, cổng này đòi ≥ 500k — nó thuộc zoldify_bulk_test (xem docs/BAN-GIAO.md mục 6: seed:bulk)

