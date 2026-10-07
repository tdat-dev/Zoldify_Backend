# Nghiệm thu

**Kết luận: ĐẠT**

File này do `npm run nghiem-thu` ghi ra. Đừng sửa tay — sửa thì nó mất giá trị làm bằng chứng, và lượt chạy sau ghi đè.

- Lúc: 16:32:57 7/10/2026
- Nhánh: `merge/staging-07-10`
- HEAD: `b14fef5` — merge: hoa origin/staging (31 commit vai A) vao nhanh vai B

| Cổng | Kết quả | Mã thoát | Số đo | Giây |
|---|---|---|---|---|
| `npm run build` | ✅ PASS | 0 | — | 9.6 |
| `npm run lint:check` | ✅ PASS | 0 | nợ 521 (491 lỗi + 30 cảnh báo) · mốc 521 | 17.1 |
| `npm run openapi:check` | ✅ PASS | 0 | 107 route · 66 schema | 11.5 |
| `npm test` | ✅ PASS | 0 | 50 passed, 50 total · 327 passed, 327 total | 39.1 |
| `npm run check:compose` | ✅ PASS | 0 | 24 mục PASS | 2.2 |
| `npm run check:boot` | ✅ PASS | 0 | 19 mục PASS | 17.1 |
| `npm run check:audit` | ✅ PASS | 0 | 21 mục PASS | 17.5 |
| cây làm việc sạch | ✅ PASS | — | không có file chưa commit | — |

