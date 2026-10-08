# Nghiệm thu

**Kết luận: HỎNG**

File này do `npm run nghiem-thu` ghi ra. Đừng sửa tay — sửa thì nó mất giá trị làm bằng chứng, và lượt chạy sau ghi đè.

- Lúc: 09:31:19 8/10/2026
- Nhánh: `feat/task-26b-ton-kho-realtime`
- HEAD: `5fe4efa` — fix(nghiem-thu): check:core doi >=500k don — bao BO QUA kem so do, khong FAIL

| Cổng | Kết quả | Mã thoát | Số đo | Giây |
|---|---|---|---|---|
| `npm run build` | ✅ PASS | 0 | — | 10.9 |
| `npm run lint:check` | ✅ PASS | 0 | nợ 521 (491 lỗi + 30 cảnh báo) · mốc 521 | 14.7 |
| `npm run openapi:check` | ✅ PASS | 0 | 107 route · 66 schema | 10 |
| `npm test` | ✅ PASS | 0 | 51 passed, 51 total · 332 passed, 332 total | 39.2 |
| `npm run check:compose` | ✅ PASS | 0 | 24 mục PASS | 2.2 |
| `npm run check:boot` | ✅ PASS | 0 | 19 mục PASS | 16.1 |
| `npm run check:audit` | ✅ PASS | 0 | 21 mục PASS | 16.1 |
| `npm run check:ci` | ✅ PASS | 0 | 31 mục PASS | 1.9 |
| `npm run check:backup` | ✅ PASS | 0 | 25 mục PASS | 2.1 |
| `npm run check:redis` | ✅ PASS | 0 | 19 mục PASS | 2.8 |
| `npm run check:worker` | ✅ PASS | 0 | 29 mục PASS | 18.3 |
| `npm run check:core` | ⊘ BỎ QUA | — | zoldify_dev chỉ có 1 đơn, cổng này đòi ≥ 500k — nó thuộc zoldify_bulk_test (xem docs/BAN-GIAO.md mục 6: seed:bulk) | — |
| `npm run check:index` | ✅ PASS | 0 | 15 mục PASS | 9.7 |
| `npm run check:constraints` | ✅ PASS | 0 | 13 mục PASS | 9.8 |
| `npm run check:drift` | ❌ FAIL | 1 | — | 9.8 |
| `npm run check:race` | ✅ PASS | 0 | 5 mục PASS | 15 |
| `npm run check:cache` | ✅ PASS | 0 | 7 mục PASS | 11.8 |
| `npm run check:stock` | ✅ PASS | 0 | 22 mục PASS | 21.1 |
| cây làm việc sạch | ✅ PASS | — | không có file chưa commit | — |

## Cổng hỏng

### `npm run check:drift` — EXIT 1

```
ALTER TABLE `push_tokens` DROP FOREIGN KEY `fk_push_user`;
DROP INDEX `uq_push_token` ON `push_tokens`;
ALTER TABLE `push_tokens` ADD UNIQUE INDEX `IDX_869b4a9ba2c9e030aafc4b7dc7` (`token`);
ALTER TABLE `push_tokens` CHANGE `created_at` `created_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6);
ALTER TABLE `push_tokens` CHANGE `updated_at` `updated_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6);
ALTER TABLE `addresses` CHANGE `is_default` `is_default` tinyint(1) NOT NULL DEFAULT '0';
ALTER TABLE `push_tokens` ADD CONSTRAINT `FK_94c371aff70dedeb89dae39f440` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;
```

## Cổng bị bỏ qua

"Bỏ qua" KHÔNG phải "đạt" — những cổng này chưa chứng minh gì cả.

- `npm run check:core` — zoldify_dev chỉ có 1 đơn, cổng này đòi ≥ 500k — nó thuộc zoldify_bulk_test (xem docs/BAN-GIAO.md mục 6: seed:bulk)

