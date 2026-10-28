# Nghiệm thu

**Kết luận: CHƯA ĐỦ**

File này do `npm run nghiem-thu` ghi ra. Đừng sửa tay — sửa thì nó mất giá trị làm bằng chứng, và lượt chạy sau ghi đè.

- Lúc: 17:22:03 28/10/2026
- Nhánh: `feat/anh-nhe-webp`
- HEAD: `ed13240` — feat: script anh:bu-thumb bù ảnh nhỏ _480.webp cho ảnh cũ trên R2

| Cổng | Kết quả | Mã thoát | Số đo | Giây |
|---|---|---|---|---|
| `npm run build` | ✅ PASS | 0 | — | 21.7 |
| `npm run lint:check` | ✅ PASS | 0 | nợ 473 (446 lỗi + 27 cảnh báo) · mốc 519 | 42.7 |
| `npm run openapi:check` | ✅ PASS | 0 | 108 route · 69 schema | 25.1 |
| `npm test` | ✅ PASS | 0 | 108 passed, 108 total · 718 passed, 718 total | 160.7 |
| `npm run check:compose` | ✅ PASS | 0 | 23 mục PASS | 4.5 |
| `npm run check:boot` | ✅ PASS | 0 | 19 mục PASS | 42.3 |
| `npm run check:audit` | ✅ PASS | 0 | 21 mục PASS | 42.4 |
| `npm run check:ci` | ✅ PASS | 0 | 31 mục PASS | 4.7 |
| `npm run check:backup` | ✅ PASS | 0 | 25 mục PASS | 5.6 |
| `npm run check:redis` | ✅ PASS | 0 | 19 mục PASS | 6.9 |
| `npm run check:worker` | ✅ PASS | 0 | 29 mục PASS | 39.7 |
| `npm run check:core` | ⊘ BỎ QUA | — | zoldify_img chỉ có 1 đơn, cổng này đòi ≥ 500k — nó thuộc zoldify_bulk_test (xem docs/BAN-GIAO.md mục 6: seed:bulk) | — |
| `npm run check:index` | ✅ PASS | 0 | 15 mục PASS | 26.3 |
| `npm run check:constraints` | ✅ PASS | 0 | 13 mục PASS | 24.3 |
| `npm run check:drift` | ✅ PASS | 0 | — | 25.6 |
| `npm run check:race` | ✅ PASS | 0 | 9 mục PASS | 38.4 |
| `npm run check:cache` | ✅ PASS | 0 | 7 mục PASS | 30.3 |
| `npm run check:stock` | ✅ PASS | 0 | 22 mục PASS | 68.1 |
| cây làm việc sạch | ✅ PASS | — | không có file chưa commit | — |

## Cổng bị bỏ qua

"Bỏ qua" KHÔNG phải "đạt" — những cổng này chưa chứng minh gì cả.

- `npm run check:core` — zoldify_img chỉ có 1 đơn, cổng này đòi ≥ 500k — nó thuộc zoldify_bulk_test (xem docs/BAN-GIAO.md mục 6: seed:bulk)

