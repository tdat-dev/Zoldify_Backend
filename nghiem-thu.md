# Nghiệm thu

**Kết luận: CHƯA ĐỦ**

File này do `npm run nghiem-thu` ghi ra. Đừng sửa tay — sửa thì nó mất giá trị làm bằng chứng, và lượt chạy sau ghi đè.

- Lúc: 20:46:52 8/11/2026
- Nhánh: `fix/nghiem-thu-han-test`
- HEAD: `b4a00b2` — Merge remote-tracking branch 'origin/staging' into fix/nghiem-thu-han-test

| Cổng | Kết quả | Mã thoát | Số đo | Giây |
|---|---|---|---|---|
| `npm run build` | ✅ PASS | 0 | — | 36.2 |
| `npm run lint:check` | ✅ PASS | 0 | nợ 464 (423 lỗi + 41 cảnh báo) · mốc 519 | 58.8 |
| `npm run openapi:check` | ✅ PASS | 0 | 113 route · 69 schema | 30.8 |
| `npm test` | ✅ PASS | 0 | 144 passed, 144 total · 989 passed, 989 total | 213.2 |
| `npm run check:compose` | ✅ PASS | 0 | 36 mục PASS | 4 |
| `npm run check:boot` | ✅ PASS | 0 | 19 mục PASS | 50.4 |
| `npm run check:audit` | ✅ PASS | 0 | 21 mục PASS | 46 |
| `npm run check:ci` | ✅ PASS | 0 | 34 mục PASS | 4.9 |
| `npm run check:backup` | ✅ PASS | 0 | 25 mục PASS | 6.1 |
| `npm run check:redis` | ✅ PASS | 0 | 19 mục PASS | 6.3 |
| `npm run check:worker` | ✅ PASS | 0 | 29 mục PASS | 27.2 |
| `npm run check:core` | ⊘ BỎ QUA | — | zoldify_race chỉ có 0 đơn, cổng này đòi ≥ 500k — nó thuộc zoldify_bulk_test (xem docs/BAN-GIAO.md mục 6: seed:bulk) | — |
| `npm run check:index` | ✅ PASS | 0 | 38 mục PASS | 24.5 |
| `npm run check:constraints` | ✅ PASS | 0 | 13 mục PASS | 18.7 |
| `npm run check:drift` | ✅ PASS | 0 | — | 34.3 |
| `npm run check:race` | ✅ PASS | 0 | 9 mục PASS | 83.3 |
| `npm run check:cache` | ✅ PASS | 0 | 7 mục PASS | 32.8 |
| `npm run check:stock` | ✅ PASS | 0 | 22 mục PASS | 50.1 |
| cây làm việc sạch | ✅ PASS | — | không có file chưa commit | — |

## Cổng bị bỏ qua

"Bỏ qua" KHÔNG phải "đạt" — những cổng này chưa chứng minh gì cả.

- `npm run check:core` — zoldify_race chỉ có 0 đơn, cổng này đòi ≥ 500k — nó thuộc zoldify_bulk_test (xem docs/BAN-GIAO.md mục 6: seed:bulk)

