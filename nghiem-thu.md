# Nghiệm thu

**Kết luận: CHƯA ĐỦ**

File này do `npm run nghiem-thu` ghi ra. Đừng sửa tay — sửa thì nó mất giá trị làm bằng chứng, và lượt chạy sau ghi đè.

- Lúc: 17:24:44 8/10/2026
- Nhánh: `feat/task-b19-ghn-resilience`
- HEAD: `f76230b` — style: prettier cho ghn-song-song-va-retry.spec.ts

| Cổng | Kết quả | Mã thoát | Số đo | Giây |
|---|---|---|---|---|
| `npm run build` | ✅ PASS | 0 | — | 9.7 |
| `npm run lint:check` | ✅ PASS | 0 | nợ 521 (491 lỗi + 30 cảnh báo) · mốc 521 | 22.5 |
| `npm run openapi:check` | ✅ PASS | 0 | 107 route · 66 schema | 12.7 |
| `npm test` | ✅ PASS | 0 | 52 passed, 52 total · 335 passed, 335 total | 43 |
| `npm run check:compose` | ✅ PASS | 0 | 24 mục PASS | 2.5 |
| `npm run check:boot` | ✅ PASS | 0 | 19 mục PASS | 18.3 |
| `npm run check:audit` | ✅ PASS | 0 | 21 mục PASS | 18.8 |
| `npm run check:ci` | ✅ PASS | 0 | 31 mục PASS | 2.3 |
| `npm run check:backup` | ✅ PASS | 0 | 25 mục PASS | 2.4 |
| `npm run check:redis` | ✅ PASS | 0 | 19 mục PASS | 3.2 |
| `npm run check:worker` | ✅ PASS | 0 | 29 mục PASS | 20.6 |
| `npm run check:core` | ⊘ BỎ QUA | — | 127.0.0.1:3306/zoldify_dev — Access denied for user 'root'@'localhost' (using password: YES) | — |
| `npm run check:index` | ⊘ BỎ QUA | — | 127.0.0.1:3306/zoldify_dev — Access denied for user 'root'@'localhost' (using password: YES) | — |
| `npm run check:constraints` | ⊘ BỎ QUA | — | 127.0.0.1:3306/zoldify_dev — Access denied for user 'root'@'localhost' (using password: YES) | — |
| `npm run check:drift` | ⊘ BỎ QUA | — | 127.0.0.1:3306/zoldify_dev — Access denied for user 'root'@'localhost' (using password: YES) | — |
| `npm run check:race` | ⊘ BỎ QUA | — | 127.0.0.1:3306/zoldify_dev — Access denied for user 'root'@'localhost' (using password: YES) | — |
| `npm run check:cache` | ⊘ BỎ QUA | — | 127.0.0.1:3306/zoldify_dev — Access denied for user 'root'@'localhost' (using password: YES) | — |
| `npm run check:stock` | ✅ PASS | 0 | 22 mục PASS | 23.6 |
| cây làm việc sạch | ✅ PASS | — | không có file chưa commit | — |

## Cổng bị bỏ qua

"Bỏ qua" KHÔNG phải "đạt" — những cổng này chưa chứng minh gì cả.

- `npm run check:core` — 127.0.0.1:3306/zoldify_dev — Access denied for user 'root'@'localhost' (using password: YES)
- `npm run check:index` — 127.0.0.1:3306/zoldify_dev — Access denied for user 'root'@'localhost' (using password: YES)
- `npm run check:constraints` — 127.0.0.1:3306/zoldify_dev — Access denied for user 'root'@'localhost' (using password: YES)
- `npm run check:drift` — 127.0.0.1:3306/zoldify_dev — Access denied for user 'root'@'localhost' (using password: YES)
- `npm run check:race` — 127.0.0.1:3306/zoldify_dev — Access denied for user 'root'@'localhost' (using password: YES)
- `npm run check:cache` — 127.0.0.1:3306/zoldify_dev — Access denied for user 'root'@'localhost' (using password: YES)

