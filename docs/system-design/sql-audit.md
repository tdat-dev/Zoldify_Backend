# Soi SQL — mỗi file sinh ra câu lệnh gì

> Sinh tự động bằng `npm run sql:audit` lúc 2026-09-04T09:57:23.962Z.
> **Đừng sửa tay file này** — chạy lại lệnh trên là nó ghi đè.

## Cách lấy được số liệu này

Không đọc mã để đoán. Ứng dụng được dựng thật, nối vào một database có
dữ liệu thật, rồi bắn vào từng route GET. Mỗi câu SQL thực sự chạy đều
được ghi lại kèm **file và dòng đã gọi nó**, sau đó `EXPLAIN` từng câu.

| | |
|---|---|
| Route đã bắn | 56 |
| Câu SQL chạy thật | 201 |
| Câu SQL khác nhau | 115 |
| File `src/` có sinh SQL | 23 |
| Cần xem: **cao** / vừa / thấp | **7** / 15 / 3 |

Số dòng trong DB soi lúc đo — vì `EXPLAIN` trên bảng rỗng thì câu nào
cũng đẹp, con số dưới đây mới là thứ làm cho kết quả có nghĩa:

| bảng | dòng | | bảng | dòng |
|---|---:|---|---|---:|
| messages | 3.600 | | conversations | 120 |
| order_items | 1.984 | | addresses | 80 |
| products | 1.969 | | users | 63 |
| notifications | 1.575 | | wallets | 50 |
| orders | 1.003 | | shops | 15 |
| wallet_transactions | 1.000 | | ledger_entries | 13 |
| reviews | 600 | | categories | 9 |
| payments | 600 | | ledger_transactions | 6 |
| order_shipments | 500 | | ledger_accounts | 6 |
| follows | 336 | | escrows | 2 |
| withdrawals | 317 | | settings | 1 |

## Đọc bảng thế nào

| Cột | Nghĩa | Xấu khi |
|---|---|---|
| `type` | cách MySQL tìm dòng | `ALL` = đọc từng dòng cả bảng |
| `key` | index nó thật sự dùng | `∅` = không dùng index nào |
| `rows` | số dòng nó ước phải đọc | càng lớn càng chậm |
| `Extra` | việc làm thêm | `Using filesort`, `Using temporary` |
| `ms` | thời gian chạy thật, trung vị 3 lần | đây mới là thứ người dùng chịu |

Ba mức: **CAO** = lặp trong một request, hoặc ≥50ms, hoặc quét ≥1.000 dòng.
**VỪA** = có vấn đề và chạm ≥200 dòng. **THẤP** = có dấu hiệu nhưng dữ liệu
còn nhỏ nên chưa đau — ghi lại để sau này lớn lên còn biết chỗ mà tìm.

Hai nhãn dưới đây **không phải là lỗi thiếu index**, nêu ra vì chúng vẫn tốn:

- *đếm cả bảng N dòng cho phân trang* — `findAndCount` luôn kèm một
  `SELECT COUNT(*)`; đếm hết bảng thì bắt buộc phải duyệt hết. Muốn rẻ thì
  phải đổi cách phân trang (keyset), không phải thêm index.
- *TypeORM dựng bảng dẫn xuất rồi DISTINCT* — khi `find` có quan hệ kèm
  phân trang, TypeORM tách làm hai bước: lấy id của trang trước, rồi mới
  nạp dữ liệu. Bước lấy id chạy trên bảng dẫn xuất nên không dùng được index.

## Những chỗ đáng xem trước

| Mức | Chỗ gọi | Vấn đề | EXPLAIN | ms |
|---|---|---|---|---:|
| CAO | `src/catalog/shop/shop.service.ts:110` | TypeORM dựng bảng dẫn xuất rồi DISTINCT trên 2011 dòng | `ALL` · key=`∅` · rows=2011 | 2.68 |
| CAO | `src/catalog/products/products.service.ts:386` | TypeORM dựng bảng dẫn xuất rồi DISTINCT trên 2011 dòng; sắp xếp ngoài index (filesort); phải dựng bảng tạm | `ALL` · key=`∅` · rows=2011 | 2.59 |
| CAO | `src/catalog/sitemap/sitemap.service.ts:170` | quét toàn bảng 2011 dòng, không dùng index; sắp xếp ngoài index (filesort); phải dựng bảng tạm | `ALL` · key=`∅` · rows=2011 | 2.29 |
| CAO | `src/ordering/orders/orders.service.ts:81` | quét toàn bảng 1003 dòng, không dùng index | `ALL` · key=`∅` · rows=1003 | 0.68 |
| CAO | `src/ops/admin/admin.service.ts:137` | quét toàn bảng 1003 dòng, không dùng index | `ALL` · key=`∅` · rows=1003 | 0.44 |
| VỪA | `src/catalog/shop/shop.service.ts:140` | đếm cả bảng 2011 dòng cho phân trang | `ALL` · key=`∅` · rows=2011 | 7.25 |
| VỪA | `src/catalog/shop/shop.service.ts:110` | đếm cả bảng 2011 dòng cho phân trang | `ALL` · key=`∅` · rows=2011 | 1.76 |
| VỪA | `src/catalog/products/products.service.ts:386` | đếm cả bảng 2011 dòng cho phân trang | `ALL` · key=`∅` · rows=2011 | 1.7 |
| VỪA | `src/catalog/shop/shop.service.ts:100` | đếm cả bảng 2011 dòng cho phân trang | `ALL` · key=`∅` · rows=2011 | 1.46 |
| VỪA | `src/catalog/interactions/interactions.service.ts:104` | TypeORM dựng bảng dẫn xuất rồi DISTINCT trên 600 dòng; sắp xếp ngoài index (filesort); phải dựng bảng tạm | `ALL` · key=`∅` · rows=600 | 1.4 |
| VỪA | `src/ops/admin/admin.service.ts:71` | đếm cả bảng 2011 dòng cho phân trang | `ALL` · key=`∅` · rows=2011 | 1.12 |
| VỪA | `src/catalog/interactions/interactions.service.ts:104` | đếm cả bảng 600 dòng cho phân trang | `ALL` · key=`∅` · rows=600 | 1.02 |
| VỪA | `src/ops/admin/admin.service.ts:131` | đếm cả bảng 2011 dòng cho phân trang | `ALL` · key=`∅` · rows=2011 | 0.85 |
| VỪA | `src/ops/admin/admin.service.ts:180` | TypeORM dựng bảng dẫn xuất rồi DISTINCT trên 317 dòng; sắp xếp ngoài index (filesort); phải dựng bảng tạm | `ALL` · key=`∅` · rows=317 | 0.69 |
| VỪA | `src/ordering/orders/orders.service.ts:74` | đếm cả bảng 2011 dòng cho phân trang | `ALL` · key=`∅` · rows=2011 | 0.62 |
| VỪA | `src/ordering/orders/orders.service.ts:75` | đếm cả bảng 1003 dòng cho phân trang | `ALL` · key=`∅` · rows=1003 | 0.57 |
| VỪA | `src/ordering/orders/orders.service.ts:403` | đếm cả bảng 1003 dòng cho phân trang | `ALL` · key=`∅` · rows=1003 | 0.51 |
| VỪA | `src/ops/admin/admin.service.ts:180` | đếm cả bảng 317 dòng cho phân trang | `ALL` · key=`∅` · rows=317 | 0.51 |
| VỪA | `src/ops/admin/admin.service.ts:132` | đếm cả bảng 1003 dòng cho phân trang | `ALL` · key=`∅` · rows=1003 | 0.38 |
| VỪA | `src/ops/admin/admin.service.ts:140` | đếm cả bảng 1003 dòng cho phân trang | `ALL` · key=`∅` · rows=1003 | 0.38 |
| THẤP | `src/messaging/chat/chat.service.ts:106` | sắp xếp ngoài index (filesort); phải dựng bảng tạm | `ALL` · key=`∅` · rows=120 | 0.73 |
| THẤP | `src/messaging/chat/chat.service.ts:182` | sắp xếp ngoài index (filesort) | `range` · key=`idx_conversation_created` · rows=90 | 0.68 |
| THẤP | `src/ops/admin/admin.service.ts:47` | sắp xếp ngoài index (filesort) | `ALL` · key=`∅` · rows=63 | 0.33 |

---

## Chi tiết theo từng file

### `src/catalog/categories/categories.service.ts`

4 câu SQL khác nhau · 4 lượt chạy

<details><summary><b>dòng 58</b> — <code>QueryBuilder.getRawMany</code> <i>(1 lượt, 1.99ms)</i></summary>

```sql
SELECT `category`.`id` AS `id`, `category`.`name` AS `name`, `category`.`name_en` AS `name_en`, `category`.`description` AS `description`, `category`.`slug` AS `slug`, `category`.`image` AS `image`, `category`.`is_active` AS `is_active`, COUNT(`product`.`id`) AS `product_count` FROM `categories` `category` LEFT JOIN `products` `product` ON `product`.`category_id` = `category`.`id` AND `product`.`deleted_at` IS NULL WHERE `category`.`deleted_at` IS NULL GROUP BY `category`.`id` ORDER BY `category`.`id` DESC LIMIT 10 OFFSET 0
```

EXPLAIN: `type=ref` · `key=idx_category_id` · `rows=223` · `Using where` · chạy thật **1.99ms**

Route gọi tới: `GET /api/v1/categories [buyer]`

</details>

<details><summary><b>dòng 60</b> — <code>Repository.count</code> <i>(1 lượt, 0.28ms)</i></summary>

```sql
SELECT COUNT(1) AS `cnt` FROM `categories` `Category` WHERE `Category`.`deleted_at` IS NULL
```

EXPLAIN: `type=ALL` · `key=∅` · `rows=9` · `Using where` · chạy thật **0.28ms**

Route gọi tới: `GET /api/v1/categories [buyer]`

</details>

<details><summary><b>dòng 87</b> — <code>Repository.findOne</code> <i>(1 lượt, 0.41ms)</i></summary>

```sql
SELECT `Category`.`id` AS `Category_id`, `Category`.`name` AS `Category_name`, `Category`.`name_en` AS `Category_name_en`, `Category`.`description` AS `Category_description`, `Category`.`slug` AS `Category_slug`, `Category`.`image` AS `Category_image`, `Category`.`is_active` AS `Category_is_active`, `Category`.`created_at` AS `Category_created_at`, `Category`.`updated_at` AS `Category_updated_at` FROM `categories` `Category` WHERE ( ((`Category`.`id` = ?)) ) AND ( `Category`.`deleted_at` IS NULL ) LIMIT 1
```

EXPLAIN: `type=const` · `key=PRIMARY` · `rows=1` · chạy thật **0.41ms**

Route gọi tới: `GET /api/v1/categories/{id} [buyer]`

</details>

<details><summary><b>dòng 95</b> — <code>Repository.findOne</code> <i>(1 lượt, 0.39ms)</i></summary>

```sql
SELECT `Category`.`id` AS `Category_id`, `Category`.`name` AS `Category_name`, `Category`.`name_en` AS `Category_name_en`, `Category`.`description` AS `Category_description`, `Category`.`slug` AS `Category_slug`, `Category`.`image` AS `Category_image`, `Category`.`is_active` AS `Category_is_active`, `Category`.`created_at` AS `Category_created_at`, `Category`.`updated_at` AS `Category_updated_at` FROM `categories` `Category` WHERE ( ((`Category`.`slug` = ?)) ) AND ( `Category`.`deleted_at` IS NULL ) LIMIT 1
```

EXPLAIN: `type=const` · `key=IDX_420d9f679d41281f282f5bc7d0` · `rows=1` · chạy thật **0.39ms**

Route gọi tới: `GET /api/v1/categories/slug/{slug} [buyer]`

</details>

### `src/catalog/files/files.service.ts`

2 câu SQL khác nhau · 2 lượt chạy

<details><summary><b>dòng 32</b> — <code>Repository.findAndCount</code> <i>(1 lượt, 0.38ms)</i></summary>

```sql
SELECT `FileEntity`.`id` AS `FileEntity_id`, `FileEntity`.`file_name` AS `FileEntity_file_name`, `FileEntity`.`url` AS `FileEntity_url`, `FileEntity`.`mime_type` AS `FileEntity_mime_type`, `FileEntity`.`size` AS `FileEntity_size`, `FileEntity`.`folder` AS `FileEntity_folder`, `FileEntity`.`created_at` AS `FileEntity_created_at`, `FileEntity`.`uploaded_by` AS `FileEntity_uploaded_by` FROM `files` `FileEntity` ORDER BY `FileEntity`.`created_at` DESC LIMIT 20 OFFSET 0
```

EXPLAIN: `type=ALL` · `key=∅` · `rows=1` · `Using filesort` · chạy thật **0.38ms**

Route gọi tới: `GET /api/v1/files [buyer]`

</details>

<details><summary><b>dòng 46</b> — <code>Repository.findOne</code> <i>(1 lượt, 0.28ms)</i></summary>

```sql
SELECT DISTINCT `distinctAlias`.`FileEntity_id` AS `ids_FileEntity_id` FROM (SELECT `FileEntity`.`id` AS `FileEntity_id`, `FileEntity`.`file_name` AS `FileEntity_file_name`, `FileEntity`.`url` AS `FileEntity_url`, `FileEntity`.`mime_type` AS `FileEntity_mime_type`, `FileEntity`.`size` AS `FileEntity_size`, `FileEntity`.`folder` AS `FileEntity_folder`, `FileEntity`.`created_at` AS `FileEntity_created_at`, `FileEntity`.`uploaded_by` AS `FileEntity_uploaded_by`, `FileEntity__FileEntity_uploaded_by`.`id` AS `FileEntity__FileEntity_uploaded_by_id`, `FileEntity__FileEntity_uploaded_by`.`full_name` AS `FileEntity__FileEntity_uploaded_by_full_name`, `FileEntity__FileEntity_uploaded_by`.`email` AS `FileEntity__FileEntity_uploaded_by_email`, `FileEntity__FileEntity_uploaded_by`.`phone_number` AS `FileEntity__FileEntity_uploaded_by_phone_number`, `FileEntity__FileEntity_uploaded_by`.`role` AS `File …(cắt bớt)
```

EXPLAIN: `type=?` · `key=∅` · `rows=0` · `no matching row in const table` · chạy thật **0.28ms**

Route gọi tới: `GET /api/v1/files/{id} [buyer]`

</details>

### `src/catalog/follows/follows.service.ts`

6 câu SQL khác nhau · 6 lượt chạy

<details><summary><b>dòng 36</b> — <code>Repository.count</code> <i>(1 lượt, 0.23ms)</i></summary>

```sql
SELECT COUNT(1) AS `cnt` FROM `follows` `Follow` WHERE ((`Follow`.`follower_id` = ?) AND (`Follow`.`following_id` = ?))
```

EXPLAIN: `type=?` · `key=∅` · `rows=0` · `no matching row in const table` · chạy thật **0.23ms**

Route gọi tới: `GET /api/v1/follows/check/{sellerId} [buyer]`

</details>

<details><summary><b>dòng 44</b> — <code>Repository.count</code> <i>(1 lượt, 0.23ms)</i></summary>

```sql
SELECT COUNT(1) AS `cnt` FROM `follows` `Follow` WHERE ((`Follow`.`following_id` = ?))
```

EXPLAIN: `type=ref` · `key=FK_c518e3988b9c057920afaf2d8c0` · `rows=16` · `Using index` · chạy thật **0.23ms**

Route gọi tới: `GET /api/v1/follows/{userId}/count [buyer]`

</details>

<details><summary><b>dòng 50</b> — <code>Repository.count</code> <i>(1 lượt, 0.31ms)</i></summary>

```sql
SELECT COUNT(1) AS `cnt` FROM `follows` `Follow` WHERE ((`Follow`.`follower_id` = ?))
```

EXPLAIN: `type=ref` · `key=IDX_8109e59f691f0444b43420f698` · `rows=1` · `Using index` · chạy thật **0.31ms**

Route gọi tới: `GET /api/v1/follows/{userId}/count [buyer]`

</details>

<details><summary><b>dòng 56</b> — <code>Repository.findAndCount</code> <i>(1 lượt, 0.47ms)</i></summary>

```sql
SELECT DISTINCT `distinctAlias`.`Follow_id` AS `ids_Follow_id`, `distinctAlias`.`Follow_created_at` FROM (SELECT `Follow`.`id` AS `Follow_id`, `Follow`.`follower_id` AS `Follow_follower_id`, `Follow`.`following_id` AS `Follow_following_id`, `Follow`.`created_at` AS `Follow_created_at`, `Follow__Follow_follower`.`id` AS `Follow__Follow_follower_id`, `Follow__Follow_follower`.`full_name` AS `Follow__Follow_follower_full_name`, `Follow__Follow_follower`.`email` AS `Follow__Follow_follower_email`, `Follow__Follow_follower`.`phone_number` AS `Follow__Follow_follower_phone_number`, `Follow__Follow_follower`.`role` AS `Follow__Follow_follower_role`, `Follow__Follow_follower`.`avatar` AS `Follow__Follow_follower_avatar`, `Follow__Follow_follower`.`email_verified` AS `Follow__Follow_follower_email_verified`, `Follow__Follow_follower`.`is_locked` AS `Follow__Follow_follower_is_locked`, `Follow__Fo …(cắt bớt)
```

EXPLAIN: `type=ref` · `key=FK_c518e3988b9c057920afaf2d8c0` · `rows=16` · `Using temporary; Using filesort` · chạy thật **0.47ms**

Route gọi tới: `GET /api/v1/follows/{userId}/followers [buyer]`

</details>

<details><summary><b>dòng 56</b> — <code>Repository.findAndCount</code> <i>(1 lượt, 0.68ms)</i></summary>

```sql
SELECT `Follow`.`id` AS `Follow_id`, `Follow`.`follower_id` AS `Follow_follower_id`, `Follow`.`following_id` AS `Follow_following_id`, `Follow`.`created_at` AS `Follow_created_at`, `Follow__Follow_follower`.`id` AS `Follow__Follow_follower_id`, `Follow__Follow_follower`.`full_name` AS `Follow__Follow_follower_full_name`, `Follow__Follow_follower`.`email` AS `Follow__Follow_follower_email`, `Follow__Follow_follower`.`phone_number` AS `Follow__Follow_follower_phone_number`, `Follow__Follow_follower`.`role` AS `Follow__Follow_follower_role`, `Follow__Follow_follower`.`avatar` AS `Follow__Follow_follower_avatar`, `Follow__Follow_follower`.`email_verified` AS `Follow__Follow_follower_email_verified`, `Follow__Follow_follower`.`is_locked` AS `Follow__Follow_follower_is_locked`, `Follow__Follow_follower`.`last_seen` AS `Follow__Follow_follower_last_seen`, `Follow__Follow_follower`.`gender` AS ` …(cắt bớt)
```

EXPLAIN: `type=range` · `key=PRIMARY` · `rows=16` · `Using where; Using filesort` · chạy thật **0.68ms**

Route gọi tới: `GET /api/v1/follows/{userId}/followers [buyer]`

</details>

<details><summary><b>dòng 76</b> — <code>Repository.findAndCount</code> <i>(1 lượt, 0.33ms)</i></summary>

```sql
SELECT DISTINCT `distinctAlias`.`Follow_id` AS `ids_Follow_id`, `distinctAlias`.`Follow_created_at` FROM (SELECT `Follow`.`id` AS `Follow_id`, `Follow`.`follower_id` AS `Follow_follower_id`, `Follow`.`following_id` AS `Follow_following_id`, `Follow`.`created_at` AS `Follow_created_at`, `Follow__Follow_following`.`id` AS `Follow__Follow_following_id`, `Follow__Follow_following`.`full_name` AS `Follow__Follow_following_full_name`, `Follow__Follow_following`.`email` AS `Follow__Follow_following_email`, `Follow__Follow_following`.`phone_number` AS `Follow__Follow_following_phone_number`, `Follow__Follow_following`.`role` AS `Follow__Follow_following_role`, `Follow__Follow_following`.`avatar` AS `Follow__Follow_following_avatar`, `Follow__Follow_following`.`email_verified` AS `Follow__Follow_following_email_verified`, `Follow__Follow_following`.`is_locked` AS `Follow__Follow_following_is_lock …(cắt bớt)
```

EXPLAIN: `type=ref` · `key=IDX_8109e59f691f0444b43420f698` · `rows=1` · `Using temporary; Using filesort` · chạy thật **0.33ms**

Route gọi tới: `GET /api/v1/follows/{userId}/following [buyer]`

</details>

### `src/catalog/interactions/interactions.service.ts`

8 câu SQL khác nhau · 8 lượt chạy · 2 mức VỪA

<details><summary><b>dòng 69</b> — <code>Repository.findAndCount</code> <i>(1 lượt, 0.71ms)</i></summary>

```sql
SELECT DISTINCT `distinctAlias`.`Review_id` AS `ids_Review_id`, `distinctAlias`.`Review_created_at` FROM (SELECT `Review`.`id` AS `Review_id`, `Review`.`rating` AS `Review_rating`, `Review`.`comment` AS `Review_comment`, `Review`.`images` AS `Review_images`, `Review`.`created_at` AS `Review_created_at`, `Review`.`updated_at` AS `Review_updated_at`, `Review`.`user_id` AS `Review_user_id`, `Review`.`product_id` AS `Review_product_id`, `Review`.`order_id` AS `Review_order_id`, `Review__Review_user`.`id` AS `Review__Review_user_id`, `Review__Review_user`.`full_name` AS `Review__Review_user_full_name`, `Review__Review_user`.`email` AS `Review__Review_user_email`, `Review__Review_user`.`phone_number` AS `Review__Review_user_phone_number`, `Review__Review_user`.`role` AS `Review__Review_user_role`, `Review__Review_user`.`avatar` AS `Review__Review_user_avatar`, `Review__Review_user`.`email_veri …(cắt bớt)
```

EXPLAIN: `type=const` · `key=PRIMARY` · `rows=1` · `Using temporary; Using filesort` · chạy thật **0.71ms**

Route gọi tới: `GET /api/v1/interactions/product/{productId} [buyer]`

</details>

<details><summary><b>dòng 69</b> — <code>Repository.findAndCount</code> <i>(1 lượt, 0.55ms)</i></summary>

```sql
SELECT `Review`.`id` AS `Review_id`, `Review`.`rating` AS `Review_rating`, `Review`.`comment` AS `Review_comment`, `Review`.`images` AS `Review_images`, `Review`.`created_at` AS `Review_created_at`, `Review`.`updated_at` AS `Review_updated_at`, `Review`.`user_id` AS `Review_user_id`, `Review`.`product_id` AS `Review_product_id`, `Review`.`order_id` AS `Review_order_id`, `Review__Review_user`.`id` AS `Review__Review_user_id`, `Review__Review_user`.`full_name` AS `Review__Review_user_full_name`, `Review__Review_user`.`email` AS `Review__Review_user_email`, `Review__Review_user`.`phone_number` AS `Review__Review_user_phone_number`, `Review__Review_user`.`role` AS `Review__Review_user_role`, `Review__Review_user`.`avatar` AS `Review__Review_user_avatar`, `Review__Review_user`.`email_verified` AS `Review__Review_user_email_verified`, `Review__Review_user`.`is_locked` AS `Review__Review_user_i …(cắt bớt)
```

EXPLAIN: `type=const` · `key=PRIMARY` · `rows=1` · chạy thật **0.55ms**

Route gọi tới: `GET /api/v1/interactions/product/{productId} [buyer]`

</details>

<details><summary><b>dòng 81</b> — <code>QueryBuilder.getRawOne</code> <i>(1 lượt, 0.43ms)</i></summary>

```sql
SELECT AVG(`review`.`rating`) AS `avg` FROM `reviews` `review` WHERE ( `review`.`product_id` = ? ) AND ( `review`.`deleted_at` IS NULL )
```

EXPLAIN: `type=ref` · `key=idx_product_created` · `rows=1` · `Using where` · chạy thật **0.43ms**

Route gọi tới: `GET /api/v1/interactions/product/{productId} [buyer]`

</details>

<details><summary><b>dòng 104</b> — <code>Repository.findAndCount</code> — <b>[VỪA]</b> TypeORM dựng bảng dẫn xuất rồi DISTINCT trên 600 dòng; sắp xếp ngoài index (filesort); phải dựng bảng tạm <i>(1 lượt, 1.4ms)</i></summary>

```sql
SELECT DISTINCT `distinctAlias`.`Review_id` AS `ids_Review_id`, `distinctAlias`.`Review_created_at` FROM (SELECT `Review`.`id` AS `Review_id`, `Review`.`rating` AS `Review_rating`, `Review`.`comment` AS `Review_comment`, `Review`.`images` AS `Review_images`, `Review`.`created_at` AS `Review_created_at`, `Review`.`updated_at` AS `Review_updated_at`, `Review`.`user_id` AS `Review_user_id`, `Review`.`product_id` AS `Review_product_id`, `Review`.`order_id` AS `Review_order_id`, `Review__Review_user`.`id` AS `Review__Review_user_id`, `Review__Review_user`.`full_name` AS `Review__Review_user_full_name`, `Review__Review_user`.`email` AS `Review__Review_user_email`, `Review__Review_user`.`phone_number` AS `Review__Review_user_phone_number`, `Review__Review_user`.`role` AS `Review__Review_user_role`, `Review__Review_user`.`avatar` AS `Review__Review_user_avatar`, `Review__Review_user`.`email_veri …(cắt bớt)
```

EXPLAIN: `type=ALL` · `key=∅` · `rows=600` · `Using where; Using temporary; Using filesort` · chạy thật **1.4ms**

Route gọi tới: `GET /api/v1/interactions [buyer]`

</details>

<details><summary><b>dòng 104</b> — <code>Repository.findAndCount</code> <i>(1 lượt, 0.89ms)</i></summary>

```sql
SELECT `Review`.`id` AS `Review_id`, `Review`.`rating` AS `Review_rating`, `Review`.`comment` AS `Review_comment`, `Review`.`images` AS `Review_images`, `Review`.`created_at` AS `Review_created_at`, `Review`.`updated_at` AS `Review_updated_at`, `Review`.`user_id` AS `Review_user_id`, `Review`.`product_id` AS `Review_product_id`, `Review`.`order_id` AS `Review_order_id`, `Review__Review_user`.`id` AS `Review__Review_user_id`, `Review__Review_user`.`full_name` AS `Review__Review_user_full_name`, `Review__Review_user`.`email` AS `Review__Review_user_email`, `Review__Review_user`.`phone_number` AS `Review__Review_user_phone_number`, `Review__Review_user`.`role` AS `Review__Review_user_role`, `Review__Review_user`.`avatar` AS `Review__Review_user_avatar`, `Review__Review_user`.`email_verified` AS `Review__Review_user_email_verified`, `Review__Review_user`.`is_locked` AS `Review__Review_user_i …(cắt bớt)
```

EXPLAIN: `type=range` · `key=PRIMARY` · `rows=10` · `Using where; Using filesort` · chạy thật **0.89ms**

Route gọi tới: `GET /api/v1/interactions [buyer]`

</details>

<details><summary><b>dòng 104</b> — <code>Repository.findAndCount</code> — <b>[VỪA]</b> đếm cả bảng 600 dòng cho phân trang <i>(1 lượt, 1.02ms)</i></summary>

```sql
SELECT COUNT(DISTINCT `Review`.`id`) AS `cnt` FROM `reviews` `Review` LEFT JOIN `users` `Review__Review_user` ON `Review__Review_user`.`id`=`Review`.`user_id` AND (`Review__Review_user`.`deleted_at` IS NULL) LEFT JOIN `products` `Review__Review_product` ON `Review__Review_product`.`id`=`Review`.`product_id` AND (`Review__Review_product`.`deleted_at` IS NULL) WHERE `Review`.`deleted_at` IS NULL
```

EXPLAIN: `type=ALL` · `key=∅` · `rows=600` · `Using where` · chạy thật **1.02ms**

Route gọi tới: `GET /api/v1/interactions [buyer]`

</details>

<details><summary><b>dòng 125</b> — <code>Repository.findOne</code> <i>(1 lượt, 0.49ms)</i></summary>

```sql
SELECT DISTINCT `distinctAlias`.`Review_id` AS `ids_Review_id` FROM (SELECT `Review`.`id` AS `Review_id`, `Review`.`rating` AS `Review_rating`, `Review`.`comment` AS `Review_comment`, `Review`.`images` AS `Review_images`, `Review`.`created_at` AS `Review_created_at`, `Review`.`updated_at` AS `Review_updated_at`, `Review`.`user_id` AS `Review_user_id`, `Review`.`product_id` AS `Review_product_id`, `Review`.`order_id` AS `Review_order_id`, `Review__Review_user`.`id` AS `Review__Review_user_id`, `Review__Review_user`.`full_name` AS `Review__Review_user_full_name`, `Review__Review_user`.`email` AS `Review__Review_user_email`, `Review__Review_user`.`phone_number` AS `Review__Review_user_phone_number`, `Review__Review_user`.`role` AS `Review__Review_user_role`, `Review__Review_user`.`avatar` AS `Review__Review_user_avatar`, `Review__Review_user`.`email_verified` AS `Review__Review_user_email_v …(cắt bớt)
```

EXPLAIN: `type=const` · `key=PRIMARY` · `rows=1` · chạy thật **0.49ms**

Route gọi tới: `GET /api/v1/interactions/{id} [buyer]`

</details>

<details><summary><b>dòng 125</b> — <code>Repository.findOne</code> <i>(1 lượt, 0.56ms)</i></summary>

```sql
SELECT `Review`.`id` AS `Review_id`, `Review`.`rating` AS `Review_rating`, `Review`.`comment` AS `Review_comment`, `Review`.`images` AS `Review_images`, `Review`.`created_at` AS `Review_created_at`, `Review`.`updated_at` AS `Review_updated_at`, `Review`.`user_id` AS `Review_user_id`, `Review`.`product_id` AS `Review_product_id`, `Review`.`order_id` AS `Review_order_id`, `Review__Review_user`.`id` AS `Review__Review_user_id`, `Review__Review_user`.`full_name` AS `Review__Review_user_full_name`, `Review__Review_user`.`email` AS `Review__Review_user_email`, `Review__Review_user`.`phone_number` AS `Review__Review_user_phone_number`, `Review__Review_user`.`role` AS `Review__Review_user_role`, `Review__Review_user`.`avatar` AS `Review__Review_user_avatar`, `Review__Review_user`.`email_verified` AS `Review__Review_user_email_verified`, `Review__Review_user`.`is_locked` AS `Review__Review_user_i …(cắt bớt)
```

EXPLAIN: `type=const` · `key=PRIMARY` · `rows=1` · chạy thật **0.56ms**

Route gọi tới: `GET /api/v1/interactions/{id} [buyer]`

</details>

### `src/catalog/products/products.service.ts`

5 câu SQL khác nhau · 5 lượt chạy · **1 mức CAO** · 1 mức VỪA

<details><summary><b>dòng 386</b> — <code>Repository.findAndCount</code> — <b>[CAO]</b> TypeORM dựng bảng dẫn xuất rồi DISTINCT trên 2011 dòng; sắp xếp ngoài index (filesort); phải dựng bảng tạm <i>(1 lượt, 2.59ms)</i></summary>

```sql
SELECT DISTINCT `distinctAlias`.`Product_id` AS `ids_Product_id`, `distinctAlias`.`Product_created_at` FROM (SELECT `Product`.`id` AS `Product_id`, `Product`.`name` AS `Product_name`, `Product`.`slug` AS `Product_slug`, `Product`.`description` AS `Product_description`, `Product`.`price` AS `Product_price`, `Product`.`currency` AS `Product_currency`, `Product`.`stock` AS `Product_stock`, `Product`.`image` AS `Product_image`, `Product`.`brand` AS `Product_brand`, `Product`.`spec` AS `Product_spec`, `Product`.`images` AS `Product_images`, `Product`.`condition` AS `Product_condition`, `Product`.`is_freeship` AS `Product_is_freeship`, `Product`.`sold_count` AS `Product_sold_count`, `Product`.`view_count` AS `Product_view_count`, `Product`.`status` AS `Product_status`, `Product`.`created_at` AS `Product_created_at`, `Product`.`updated_at` AS `Product_updated_at`, `Product`.`category_id` AS `Pr …(cắt bớt)
```

EXPLAIN: `type=ALL` · `key=∅` · `rows=2011` · `Using where; Using temporary; Using filesort` · chạy thật **2.59ms**

Route gọi tới: `GET /api/v1/products [buyer]`

</details>

<details><summary><b>dòng 386</b> — <code>Repository.findAndCount</code> <i>(1 lượt, 0.6ms)</i></summary>

```sql
SELECT `Product`.`id` AS `Product_id`, `Product`.`name` AS `Product_name`, `Product`.`slug` AS `Product_slug`, `Product`.`description` AS `Product_description`, `Product`.`price` AS `Product_price`, `Product`.`currency` AS `Product_currency`, `Product`.`stock` AS `Product_stock`, `Product`.`image` AS `Product_image`, `Product`.`brand` AS `Product_brand`, `Product`.`spec` AS `Product_spec`, `Product`.`images` AS `Product_images`, `Product`.`condition` AS `Product_condition`, `Product`.`is_freeship` AS `Product_is_freeship`, `Product`.`sold_count` AS `Product_sold_count`, `Product`.`view_count` AS `Product_view_count`, `Product`.`status` AS `Product_status`, `Product`.`created_at` AS `Product_created_at`, `Product`.`updated_at` AS `Product_updated_at`, `Product`.`category_id` AS `Product_category_id`, `Product`.`seller_id` AS `Product_seller_id`, `Product__Product_category`.`id` AS `Produc …(cắt bớt)
```

EXPLAIN: `type=range` · `key=PRIMARY` · `rows=10` · `Using where; Using filesort` · chạy thật **0.6ms**

Route gọi tới: `GET /api/v1/products [buyer]`

</details>

<details><summary><b>dòng 386</b> — <code>Repository.findAndCount</code> — <b>[VỪA]</b> đếm cả bảng 2011 dòng cho phân trang <i>(1 lượt, 1.7ms)</i></summary>

```sql
SELECT COUNT(DISTINCT `Product`.`id`) AS `cnt` FROM `products` `Product` LEFT JOIN `categories` `Product__Product_category` ON `Product__Product_category`.`id`=`Product`.`category_id` AND (`Product__Product_category`.`deleted_at` IS NULL) LEFT JOIN `users` `Product__Product_seller` ON `Product__Product_seller`.`id`=`Product`.`seller_id` AND (`Product__Product_seller`.`deleted_at` IS NULL) WHERE `Product`.`deleted_at` IS NULL
```

EXPLAIN: `type=ALL` · `key=∅` · `rows=2011` · `Using where` · chạy thật **1.7ms**

Route gọi tới: `GET /api/v1/products [buyer]`

</details>

<details><summary><b>dòng 429</b> — <code>Repository.findOne</code> <i>(1 lượt, 0.5ms)</i></summary>

```sql
SELECT DISTINCT `distinctAlias`.`Product_id` AS `ids_Product_id` FROM (SELECT `Product`.`id` AS `Product_id`, `Product`.`name` AS `Product_name`, `Product`.`slug` AS `Product_slug`, `Product`.`description` AS `Product_description`, `Product`.`price` AS `Product_price`, `Product`.`currency` AS `Product_currency`, `Product`.`stock` AS `Product_stock`, `Product`.`image` AS `Product_image`, `Product`.`brand` AS `Product_brand`, `Product`.`spec` AS `Product_spec`, `Product`.`images` AS `Product_images`, `Product`.`condition` AS `Product_condition`, `Product`.`is_freeship` AS `Product_is_freeship`, `Product`.`sold_count` AS `Product_sold_count`, `Product`.`view_count` AS `Product_view_count`, `Product`.`status` AS `Product_status`, `Product`.`created_at` AS `Product_created_at`, `Product`.`updated_at` AS `Product_updated_at`, `Product`.`category_id` AS `Product_category_id`, `Product`.`seller_ …(cắt bớt)
```

EXPLAIN: `type=const` · `key=PRIMARY` · `rows=1` · chạy thật **0.5ms**

Route gọi tới: `GET /api/v1/products/{id} [buyer]`

</details>

<details><summary><b>dòng 429</b> — <code>Repository.findOne</code> <i>(1 lượt, 0.63ms)</i></summary>

```sql
SELECT `Product`.`id` AS `Product_id`, `Product`.`name` AS `Product_name`, `Product`.`slug` AS `Product_slug`, `Product`.`description` AS `Product_description`, `Product`.`price` AS `Product_price`, `Product`.`currency` AS `Product_currency`, `Product`.`stock` AS `Product_stock`, `Product`.`image` AS `Product_image`, `Product`.`brand` AS `Product_brand`, `Product`.`spec` AS `Product_spec`, `Product`.`images` AS `Product_images`, `Product`.`condition` AS `Product_condition`, `Product`.`is_freeship` AS `Product_is_freeship`, `Product`.`sold_count` AS `Product_sold_count`, `Product`.`view_count` AS `Product_view_count`, `Product`.`status` AS `Product_status`, `Product`.`created_at` AS `Product_created_at`, `Product`.`updated_at` AS `Product_updated_at`, `Product`.`category_id` AS `Product_category_id`, `Product`.`seller_id` AS `Product_seller_id`, `Product__Product_category`.`id` AS `Produc …(cắt bớt)
```

EXPLAIN: `type=const` · `key=PRIMARY` · `rows=1` · chạy thật **0.63ms**

Route gọi tới: `GET /api/v1/products/{id} [buyer]`

</details>

### `src/catalog/shop/shop.service.ts`

12 câu SQL khác nhau · 13 lượt chạy · **2 mức CAO** · 3 mức VỪA

<details><summary><b>dòng 58</b> — <code>Repository.findOne</code> <i>(2 lượt, 0.33ms)</i></summary>

```sql
SELECT DISTINCT `distinctAlias`.`Shop_id` AS `ids_Shop_id` FROM (SELECT `Shop`.`id` AS `Shop_id`, `Shop`.`name` AS `Shop_name`, `Shop`.`slug` AS `Shop_slug`, `Shop`.`description` AS `Shop_description`, `Shop`.`logo` AS `Shop_logo`, `Shop`.`banner` AS `Shop_banner`, `Shop`.`phone` AS `Shop_phone`, `Shop`.`address` AS `Shop_address`, `Shop`.`pickup_name` AS `Shop_pickup_name`, `Shop`.`pickup_phone` AS `Shop_pickup_phone`, `Shop`.`pickup_address` AS `Shop_pickup_address`, `Shop`.`pickup_province_name` AS `Shop_pickup_province_name`, `Shop`.`pickup_district_id` AS `Shop_pickup_district_id`, `Shop`.`pickup_district_name` AS `Shop_pickup_district_name`, `Shop`.`pickup_ward_code` AS `Shop_pickup_ward_code`, `Shop`.`pickup_ward_name` AS `Shop_pickup_ward_name`, `Shop`.`status` AS `Shop_status`, `Shop`.`created_at` AS `Shop_created_at`, `Shop`.`updated_at` AS `Shop_updated_at`, `Shop`.`user_id` A …(cắt bớt)
```

EXPLAIN: `type=?` · `key=∅` · `rows=0` · `no matching row in const table` · chạy thật **0.33ms**

Route gọi tới: `GET /api/v1/shop/me [buyer]`, `GET /api/v1/shop/me [seller]`

</details>

<details><summary><b>dòng 58</b> — <code>Repository.findOne</code> <i>(1 lượt, 0.91ms)</i></summary>

```sql
SELECT `Shop`.`id` AS `Shop_id`, `Shop`.`name` AS `Shop_name`, `Shop`.`slug` AS `Shop_slug`, `Shop`.`description` AS `Shop_description`, `Shop`.`logo` AS `Shop_logo`, `Shop`.`banner` AS `Shop_banner`, `Shop`.`phone` AS `Shop_phone`, `Shop`.`address` AS `Shop_address`, `Shop`.`pickup_name` AS `Shop_pickup_name`, `Shop`.`pickup_phone` AS `Shop_pickup_phone`, `Shop`.`pickup_address` AS `Shop_pickup_address`, `Shop`.`pickup_province_name` AS `Shop_pickup_province_name`, `Shop`.`pickup_district_id` AS `Shop_pickup_district_id`, `Shop`.`pickup_district_name` AS `Shop_pickup_district_name`, `Shop`.`pickup_ward_code` AS `Shop_pickup_ward_code`, `Shop`.`pickup_ward_name` AS `Shop_pickup_ward_name`, `Shop`.`status` AS `Shop_status`, `Shop`.`created_at` AS `Shop_created_at`, `Shop`.`updated_at` AS `Shop_updated_at`, `Shop`.`user_id` AS `Shop_user_id`, `Shop__Shop_user`.`id` AS `Shop__Shop_user_id`, …(cắt bớt)
```

EXPLAIN: `type=const` · `key=PRIMARY` · `rows=1` · chạy thật **0.91ms**

Route gọi tới: `GET /api/v1/shop/me [seller]`

</details>

<details><summary><b>dòng 85</b> — <code>Repository.findOne</code> <i>(1 lượt, 0.41ms)</i></summary>

```sql
SELECT DISTINCT `distinctAlias`.`Shop_id` AS `ids_Shop_id` FROM (SELECT `Shop`.`id` AS `Shop_id`, `Shop`.`name` AS `Shop_name`, `Shop`.`slug` AS `Shop_slug`, `Shop`.`description` AS `Shop_description`, `Shop`.`logo` AS `Shop_logo`, `Shop`.`banner` AS `Shop_banner`, `Shop`.`phone` AS `Shop_phone`, `Shop`.`address` AS `Shop_address`, `Shop`.`pickup_name` AS `Shop_pickup_name`, `Shop`.`pickup_phone` AS `Shop_pickup_phone`, `Shop`.`pickup_address` AS `Shop_pickup_address`, `Shop`.`pickup_province_name` AS `Shop_pickup_province_name`, `Shop`.`pickup_district_id` AS `Shop_pickup_district_id`, `Shop`.`pickup_district_name` AS `Shop_pickup_district_name`, `Shop`.`pickup_ward_code` AS `Shop_pickup_ward_code`, `Shop`.`pickup_ward_name` AS `Shop_pickup_ward_name`, `Shop`.`status` AS `Shop_status`, `Shop`.`created_at` AS `Shop_created_at`, `Shop`.`updated_at` AS `Shop_updated_at`, `Shop`.`user_id` A …(cắt bớt)
```

EXPLAIN: `type=const` · `key=REL_bb9c758dcc60137e56f6fee72f` · `rows=1` · `Using index` · chạy thật **0.41ms**

Route gọi tới: `GET /api/v1/shop/{sellerId} [buyer]`

</details>

<details><summary><b>dòng 85</b> — <code>Repository.findOne</code> <i>(1 lượt, 0.44ms)</i></summary>

```sql
SELECT `Shop`.`id` AS `Shop_id`, `Shop`.`name` AS `Shop_name`, `Shop`.`slug` AS `Shop_slug`, `Shop`.`description` AS `Shop_description`, `Shop`.`logo` AS `Shop_logo`, `Shop`.`banner` AS `Shop_banner`, `Shop`.`phone` AS `Shop_phone`, `Shop`.`address` AS `Shop_address`, `Shop`.`pickup_name` AS `Shop_pickup_name`, `Shop`.`pickup_phone` AS `Shop_pickup_phone`, `Shop`.`pickup_address` AS `Shop_pickup_address`, `Shop`.`pickup_province_name` AS `Shop_pickup_province_name`, `Shop`.`pickup_district_id` AS `Shop_pickup_district_id`, `Shop`.`pickup_district_name` AS `Shop_pickup_district_name`, `Shop`.`pickup_ward_code` AS `Shop_pickup_ward_code`, `Shop`.`pickup_ward_name` AS `Shop_pickup_ward_name`, `Shop`.`status` AS `Shop_status`, `Shop`.`created_at` AS `Shop_created_at`, `Shop`.`updated_at` AS `Shop_updated_at`, `Shop`.`user_id` AS `Shop_user_id`, `Shop__Shop_user`.`id` AS `Shop__Shop_user_id`, …(cắt bớt)
```

EXPLAIN: `type=const` · `key=PRIMARY` · `rows=1` · chạy thật **0.44ms**

Route gọi tới: `GET /api/v1/shop/{sellerId} [buyer]`

</details>

<details><summary><b>dòng 100</b> — <code>Repository.count</code> — <b>[VỪA]</b> đếm cả bảng 2011 dòng cho phân trang <i>(1 lượt, 1.46ms)</i></summary>

```sql
SELECT COUNT(DISTINCT `Product`.`id`) AS `cnt` FROM `products` `Product` LEFT JOIN `users` `Product__Product_seller` ON `Product__Product_seller`.`id`=`Product`.`seller_id` AND (`Product__Product_seller`.`deleted_at` IS NULL) WHERE ( ((((`Product__Product_seller`.`id` = ?))) AND (`Product`.`status` = ?)) ) AND ( `Product`.`deleted_at` IS NULL )
```

EXPLAIN: `type=ALL` · `key=∅` · `rows=2011` · `Using where` · chạy thật **1.46ms**

Route gọi tới: `GET /api/v1/shop/{sellerId} [buyer]`

</details>

<details><summary><b>dòng 103</b> — <code>Repository.count</code> <i>(1 lượt, 0.28ms)</i></summary>

```sql
SELECT COUNT(DISTINCT `Follow`.`id`) AS `cnt` FROM `follows` `Follow` LEFT JOIN `users` `Follow__Follow_following` ON `Follow__Follow_following`.`id`=`Follow`.`following_id` AND (`Follow__Follow_following`.`deleted_at` IS NULL) WHERE ((((`Follow__Follow_following`.`id` = ?))))
```

EXPLAIN: `type=ref` · `key=FK_c518e3988b9c057920afaf2d8c0` · `rows=16` · `Using index` · chạy thật **0.28ms**

Route gọi tới: `GET /api/v1/shop/{sellerId} [buyer]`

</details>

<details><summary><b>dòng 110</b> — <code>Repository.findAndCount</code> — <b>[CAO]</b> TypeORM dựng bảng dẫn xuất rồi DISTINCT trên 2011 dòng <i>(1 lượt, 2.68ms)</i></summary>

```sql
SELECT DISTINCT `distinctAlias`.`Product_id` AS `ids_Product_id`, `distinctAlias`.`Product_created_at` FROM (SELECT `Product`.`id` AS `Product_id`, `Product`.`name` AS `Product_name`, `Product`.`slug` AS `Product_slug`, `Product`.`description` AS `Product_description`, `Product`.`price` AS `Product_price`, `Product`.`currency` AS `Product_currency`, `Product`.`stock` AS `Product_stock`, `Product`.`image` AS `Product_image`, `Product`.`brand` AS `Product_brand`, `Product`.`spec` AS `Product_spec`, `Product`.`images` AS `Product_images`, `Product`.`condition` AS `Product_condition`, `Product`.`is_freeship` AS `Product_is_freeship`, `Product`.`sold_count` AS `Product_sold_count`, `Product`.`view_count` AS `Product_view_count`, `Product`.`status` AS `Product_status`, `Product`.`created_at` AS `Product_created_at`, `Product`.`updated_at` AS `Product_updated_at`, `Product`.`category_id` AS `Pr …(cắt bớt)
```

EXPLAIN: `type=ALL` · `key=∅` · `rows=2011` · `Using where` · chạy thật **2.68ms**

Route gọi tới: `GET /api/v1/shop/{sellerId}/products [buyer]`

</details>

<details><summary><b>dòng 110</b> — <code>Repository.findAndCount</code> <i>(1 lượt, 1.28ms)</i></summary>

```sql
SELECT `Product`.`id` AS `Product_id`, `Product`.`name` AS `Product_name`, `Product`.`slug` AS `Product_slug`, `Product`.`description` AS `Product_description`, `Product`.`price` AS `Product_price`, `Product`.`currency` AS `Product_currency`, `Product`.`stock` AS `Product_stock`, `Product`.`image` AS `Product_image`, `Product`.`brand` AS `Product_brand`, `Product`.`spec` AS `Product_spec`, `Product`.`images` AS `Product_images`, `Product`.`condition` AS `Product_condition`, `Product`.`is_freeship` AS `Product_is_freeship`, `Product`.`sold_count` AS `Product_sold_count`, `Product`.`view_count` AS `Product_view_count`, `Product`.`status` AS `Product_status`, `Product`.`created_at` AS `Product_created_at`, `Product`.`updated_at` AS `Product_updated_at`, `Product`.`category_id` AS `Product_category_id`, `Product`.`seller_id` AS `Product_seller_id`, `Product__Product_category`.`id` AS `Produc …(cắt bớt)
```

EXPLAIN: `type=range` · `key=PRIMARY` · `rows=20` · `Using where` · chạy thật **1.28ms**

Route gọi tới: `GET /api/v1/shop/{sellerId}/products [buyer]`

</details>

<details><summary><b>dòng 110</b> — <code>Repository.findAndCount</code> — <b>[VỪA]</b> đếm cả bảng 2011 dòng cho phân trang <i>(1 lượt, 1.76ms)</i></summary>

```sql
SELECT COUNT(DISTINCT `Product`.`id`) AS `cnt` FROM `products` `Product` LEFT JOIN `categories` `Product__Product_category` ON `Product__Product_category`.`id`=`Product`.`category_id` AND (`Product__Product_category`.`deleted_at` IS NULL) LEFT JOIN `users` `Product__Product_seller` ON `Product__Product_seller`.`id`=`Product`.`seller_id` AND (`Product__Product_seller`.`deleted_at` IS NULL) WHERE ( ((((`Product__Product_seller`.`id` = ?))) AND (`Product`.`status` = ?)) ) AND ( `Product`.`deleted_at` IS NULL )
```

EXPLAIN: `type=ALL` · `key=∅` · `rows=2011` · `Using where` · chạy thật **1.76ms**

Route gọi tới: `GET /api/v1/shop/{sellerId}/products [buyer]`

</details>

<details><summary><b>dòng 140</b> — <code>Repository.findAndCount</code> — <b>[CAO]</b>  <i>(1 lượt, 8.8ms)</i></summary>

```sql
SELECT DISTINCT `distinctAlias`.`OrderItem_id` AS `ids_OrderItem_id`, `distinctAlias`.`OrderItem_id` FROM (SELECT `OrderItem`.`id` AS `OrderItem_id`, `OrderItem`.`product_name` AS `OrderItem_product_name`, `OrderItem`.`product_image` AS `OrderItem_product_image`, `OrderItem`.`price` AS `OrderItem_price`, `OrderItem`.`quantity` AS `OrderItem_quantity`, `OrderItem`.`subtotal` AS `OrderItem_subtotal`, `OrderItem`.`created_at` AS `OrderItem_created_at`, `OrderItem`.`updated_at` AS `OrderItem_updated_at`, `OrderItem`.`order_id` AS `OrderItem_order_id`, `OrderItem`.`product_id` AS `OrderItem_product_id`, `OrderItem__OrderItem_order`.`id` AS `OrderItem__OrderItem_order_id`, `OrderItem__OrderItem_order`.`order_code` AS `OrderItem__OrderItem_order_order_code`, `OrderItem__OrderItem_order`.`total_amount` AS `OrderItem__OrderItem_order_total_amount`, `OrderItem__OrderItem_order`.`shipping_fee` AS ` …(cắt bớt)
```

EXPLAIN: `type=range` · `key=idx_seller_status` · `rows=2015` · `Using index condition; Using where` · chạy thật **8.8ms**

Route gọi tới: `GET /api/v1/shop/{sellerId}/orders [seller]`

</details>

<details><summary><b>dòng 140</b> — <code>Repository.findAndCount</code> <i>(1 lượt, 1.62ms)</i></summary>

```sql
SELECT `OrderItem`.`id` AS `OrderItem_id`, `OrderItem`.`product_name` AS `OrderItem_product_name`, `OrderItem`.`product_image` AS `OrderItem_product_image`, `OrderItem`.`price` AS `OrderItem_price`, `OrderItem`.`quantity` AS `OrderItem_quantity`, `OrderItem`.`subtotal` AS `OrderItem_subtotal`, `OrderItem`.`created_at` AS `OrderItem_created_at`, `OrderItem`.`updated_at` AS `OrderItem_updated_at`, `OrderItem`.`order_id` AS `OrderItem_order_id`, `OrderItem`.`product_id` AS `OrderItem_product_id`, `OrderItem__OrderItem_order`.`id` AS `OrderItem__OrderItem_order_id`, `OrderItem__OrderItem_order`.`order_code` AS `OrderItem__OrderItem_order_order_code`, `OrderItem__OrderItem_order`.`total_amount` AS `OrderItem__OrderItem_order_total_amount`, `OrderItem__OrderItem_order`.`shipping_fee` AS `OrderItem__OrderItem_order_shipping_fee`, `OrderItem__OrderItem_order`.`discount_amount` AS `OrderItem__Ord …(cắt bớt)
```

EXPLAIN: `type=range` · `key=PRIMARY` · `rows=20` · `Using where; Backward index scan` · chạy thật **1.62ms**

Route gọi tới: `GET /api/v1/shop/{sellerId}/orders [seller]`

</details>

<details><summary><b>dòng 140</b> — <code>Repository.findAndCount</code> — <b>[VỪA]</b> đếm cả bảng 2011 dòng cho phân trang <i>(1 lượt, 7.25ms)</i></summary>

```sql
SELECT COUNT(DISTINCT `OrderItem`.`id`) AS `cnt` FROM `order_items` `OrderItem` LEFT JOIN `orders` `OrderItem__OrderItem_order` ON `OrderItem__OrderItem_order`.`id`=`OrderItem`.`order_id` AND (`OrderItem__OrderItem_order`.`deleted_at` IS NULL) LEFT JOIN `users` `OrderItem__OrderItem_order__OrderItem__OrderItem_order_user` ON `OrderItem__OrderItem_order__OrderItem__OrderItem_order_user`.`id`=`OrderItem__OrderItem_order`.`user_id` AND (`OrderItem__OrderItem_order__OrderItem__OrderItem_order_user`.`deleted_at` IS NULL) LEFT JOIN `products` `OrderItem__OrderItem_product` ON `OrderItem__OrderItem_product`.`id`=`OrderItem`.`product_id` AND (`OrderItem__OrderItem_product`.`deleted_at` IS NULL) LEFT JOIN `users` `e063eec0f61a8f48f1b33f3111c143215d8c87d2` ON `e063eec0f61a8f48f1b33f3111c143215d8c87d2`.`id`=`OrderItem__OrderItem_product`.`seller_id` AND (`e063eec0f61a8f48f1b33f3111c143215d8c87d2`.` …(cắt bớt)
```

EXPLAIN: `type=ALL` · `key=∅` · `rows=2011` · `Using where` · chạy thật **7.25ms**

Route gọi tới: `GET /api/v1/shop/{sellerId}/orders [seller]`

</details>

### `src/catalog/sitemap/sitemap.service.ts`

4 câu SQL khác nhau · 6 lượt chạy · **1 mức CAO**

<details><summary><b>dòng 170</b> — <code>QueryBuilder.getRawMany</code> — <b>[CAO]</b> quét toàn bảng 2011 dòng, không dùng index; sắp xếp ngoài index (filesort); phải dựng bảng tạm <i>(1 lượt, 2.29ms)</i></summary>

```sql
SELECT FLOOR((`p`.`id` - 1) / ?) AS `lo`, MAX(`p`.`updated_at`) AS `moi_nhat` FROM `products` `p` WHERE ( `p`.`status` = ? AND `p`.`deleted_at` IS NULL ) AND ( `p`.`deleted_at` IS NULL ) GROUP BY lo ORDER BY lo ASC
```

EXPLAIN: `type=ALL` · `key=∅` · `rows=2011` · `Using where; Using temporary; Using filesort` · chạy thật **2.29ms**

Route gọi tới: `GET /sitemap.xml [buyer]`

</details>

<details><summary><b>dòng 198</b> — <code>Repository.find</code> <i>(1 lượt, 0.33ms)</i></summary>

```sql
SELECT `Category`.`id` AS `Category_id`, `Category`.`slug` AS `Category_slug`, `Category`.`updated_at` AS `Category_updated_at` FROM `categories` `Category` WHERE `Category`.`deleted_at` IS NULL
```

EXPLAIN: `type=ALL` · `key=∅` · `rows=9` · `Using where` · chạy thật **0.33ms**

Route gọi tới: `GET /sitemap-static.xml [buyer]`

</details>

<details><summary><b>dòng 209</b> — <code>Repository.find</code> <i>(1 lượt, 0.72ms)</i></summary>

```sql
SELECT `Shop`.`id` AS `Shop_id`, `Shop`.`updated_at` AS `Shop_updated_at`, `Shop__Shop_user`.`id` AS `Shop__Shop_user_id`, `Shop__Shop_user`.`full_name` AS `Shop__Shop_user_full_name`, `Shop__Shop_user`.`email` AS `Shop__Shop_user_email`, `Shop__Shop_user`.`phone_number` AS `Shop__Shop_user_phone_number`, `Shop__Shop_user`.`role` AS `Shop__Shop_user_role`, `Shop__Shop_user`.`avatar` AS `Shop__Shop_user_avatar`, `Shop__Shop_user`.`email_verified` AS `Shop__Shop_user_email_verified`, `Shop__Shop_user`.`is_locked` AS `Shop__Shop_user_is_locked`, `Shop__Shop_user`.`last_seen` AS `Shop__Shop_user_last_seen`, `Shop__Shop_user`.`gender` AS `Shop__Shop_user_gender`, `Shop__Shop_user`.`token_version` AS `Shop__Shop_user_token_version`, `Shop__Shop_user`.`created_at` AS `Shop__Shop_user_created_at`, `Shop__Shop_user`.`deleted_at` AS `Shop__Shop_user_deleted_at` FROM `shops` `Shop` LEFT JOIN `users …(cắt bớt)
```

EXPLAIN: `type=ALL` · `key=∅` · `rows=15` · `Using where` · chạy thật **0.72ms**

Route gọi tới: `GET /sitemap-static.xml [buyer]`

</details>

<details><summary><b>dòng 230</b> — <code>Repository.find</code> <i>(3 lượt, 0.32ms)</i></summary>

```sql
SELECT `Product`.`id` AS `Product_id`, `Product`.`name` AS `Product_name`, `Product`.`slug` AS `Product_slug`, `Product`.`updated_at` AS `Product_updated_at` FROM `products` `Product` WHERE ( ((`Product`.`status` = ?) AND (`Product`.`id` BETWEEN ? AND ?)) ) AND ( `Product`.`deleted_at` IS NULL ) ORDER BY `Product_id` ASC LIMIT 5000
```

EXPLAIN: `type=range` · `key=PRIMARY` · `rows=1` · `Using where` · chạy thật **0.32ms**

Route gọi tới: `GET /sitemap-products-{lo}.xml [buyer]`, `GET /sitemap-products-{lo}.xml [seller]`, `GET /sitemap-products-{lo}.xml [admin]`

</details>

### `src/identity/addresses/addresses.service.ts`

3 câu SQL khác nhau · 4 lượt chạy

<details><summary><b>dòng 16</b> — <code>Repository.find</code> <i>(1 lượt, 0.31ms)</i></summary>

```sql
SELECT `Address`.`id` AS `Address_id`, `Address`.`recipient_name` AS `Address_recipient_name`, `Address`.`phone_number` AS `Address_phone_number`, `Address`.`label` AS `Address_label`, `Address`.`country` AS `Address_country`, `Address`.`province` AS `Address_province`, `Address`.`district` AS `Address_district`, `Address`.`ward` AS `Address_ward`, `Address`.`street` AS `Address_street`, `Address`.`is_default` AS `Address_is_default`, `Address`.`created_at` AS `Address_created_at`, `Address`.`updated_at` AS `Address_updated_at`, `Address`.`user_id` AS `Address_user_id` FROM `addresses` `Address` LEFT JOIN `users` `Address__Address_user` ON `Address__Address_user`.`id`=`Address`.`user_id` AND (`Address__Address_user`.`deleted_at` IS NULL) WHERE ((((`Address__Address_user`.`id` = ?)))) ORDER BY `Address`.`is_default` DESC, `Address`.`created_at` DESC
```

EXPLAIN: `type=ref` · `key=FK_16aac8a9f6f9c1dd6bcb75ec023` · `rows=2` · chạy thật **0.31ms**

Route gọi tới: `GET /api/v1/addresses [buyer]`

</details>

<details><summary><b>dòng 23</b> — <code>Repository.findOne</code> <i>(2 lượt, 0.29ms)</i></summary>

```sql
SELECT DISTINCT `distinctAlias`.`Address_id` AS `ids_Address_id` FROM (SELECT `Address`.`id` AS `Address_id`, `Address`.`recipient_name` AS `Address_recipient_name`, `Address`.`phone_number` AS `Address_phone_number`, `Address`.`label` AS `Address_label`, `Address`.`country` AS `Address_country`, `Address`.`province` AS `Address_province`, `Address`.`district` AS `Address_district`, `Address`.`ward` AS `Address_ward`, `Address`.`street` AS `Address_street`, `Address`.`is_default` AS `Address_is_default`, `Address`.`created_at` AS `Address_created_at`, `Address`.`updated_at` AS `Address_updated_at`, `Address`.`user_id` AS `Address_user_id` FROM `addresses` `Address` LEFT JOIN `users` `Address__Address_user` ON `Address__Address_user`.`id`=`Address`.`user_id` AND (`Address__Address_user`.`deleted_at` IS NULL) WHERE ((`Address`.`id` = ?) AND (((`Address__Address_user`.`id` = ?))))) `distinc …(cắt bớt)
```

EXPLAIN: `type=?` · `key=∅` · `rows=0` · `Impossible WHERE noticed after reading const tables` · chạy thật **0.29ms**

Route gọi tới: `GET /api/v1/addresses/{id} [buyer]`, `GET /api/v1/addresses/{id} [seller]`

</details>

<details><summary><b>dòng 23</b> — <code>Repository.findOne</code> <i>(1 lượt, 0.34ms)</i></summary>

```sql
SELECT `Address`.`id` AS `Address_id`, `Address`.`recipient_name` AS `Address_recipient_name`, `Address`.`phone_number` AS `Address_phone_number`, `Address`.`label` AS `Address_label`, `Address`.`country` AS `Address_country`, `Address`.`province` AS `Address_province`, `Address`.`district` AS `Address_district`, `Address`.`ward` AS `Address_ward`, `Address`.`street` AS `Address_street`, `Address`.`is_default` AS `Address_is_default`, `Address`.`created_at` AS `Address_created_at`, `Address`.`updated_at` AS `Address_updated_at`, `Address`.`user_id` AS `Address_user_id` FROM `addresses` `Address` LEFT JOIN `users` `Address__Address_user` ON `Address__Address_user`.`id`=`Address`.`user_id` AND (`Address__Address_user`.`deleted_at` IS NULL) WHERE ( ((`Address`.`id` = ?) AND (((`Address__Address_user`.`id` = ?)))) ) AND ( `Address`.`id` IN (1) )
```

EXPLAIN: `type=const` · `key=PRIMARY` · `rows=1` · chạy thật **0.34ms**

Route gọi tới: `GET /api/v1/addresses/{id} [seller]`

</details>

### `src/identity/auth/auth.service.ts`

1 câu SQL khác nhau · 3 lượt chạy

<details><summary><b>dòng 75</b> — <code>Repository.findOne</code> <i>(3 lượt, 0.59ms)</i></summary>

```sql
SELECT `User`.`id` AS `User_id`, `User`.`full_name` AS `User_full_name`, `User`.`email` AS `User_email`, `User`.`phone_number` AS `User_phone_number`, `User`.`role` AS `User_role`, `User`.`avatar` AS `User_avatar`, `User`.`email_verified` AS `User_email_verified`, `User`.`is_locked` AS `User_is_locked`, `User`.`last_seen` AS `User_last_seen`, `User`.`gender` AS `User_gender`, `User`.`token_version` AS `User_token_version`, `User`.`created_at` AS `User_created_at`, `User`.`deleted_at` AS `User_deleted_at` FROM `users` `User` WHERE ( ((`User`.`id` = ?)) ) AND ( `User`.`deleted_at` IS NULL ) LIMIT 1
```

EXPLAIN: `type=const` · `key=PRIMARY` · `rows=1` · chạy thật **0.59ms**

Route gọi tới: `(khởi động)`

</details>

### `src/identity/auth/passport/jwt.strategy.ts`

1 câu SQL khác nhau · 67 lượt chạy

<details><summary><b>dòng 24</b> — <code>Repository.findOne</code> <i>(67 lượt, 0.32ms)</i></summary>

```sql
SELECT `User`.`id` AS `User_id`, `User`.`full_name` AS `User_full_name`, `User`.`email` AS `User_email`, `User`.`phone_number` AS `User_phone_number`, `User`.`role` AS `User_role`, `User`.`avatar` AS `User_avatar`, `User`.`email_verified` AS `User_email_verified`, `User`.`is_locked` AS `User_is_locked`, `User`.`last_seen` AS `User_last_seen`, `User`.`gender` AS `User_gender`, `User`.`token_version` AS `User_token_version`, `User`.`created_at` AS `User_created_at`, `User`.`deleted_at` AS `User_deleted_at` FROM `users` `User` WHERE ( ((`User`.`id` = ?)) ) AND ( `User`.`deleted_at` IS NULL ) LIMIT 1
```

EXPLAIN: `type=const` · `key=PRIMARY` · `rows=1` · chạy thật **0.32ms**

Route gọi tới: `GET /api/v1/users [buyer]`, `GET /api/v1/users [seller]`, `GET /api/v1/users [admin]`, `GET /api/v1/users/{id} [buyer]`, `GET /api/v1/users/{id} [seller]`, `GET /api/v1/users/{id} [admin]` …(+61)

</details>

### `src/identity/users/users.service.ts`

5 câu SQL khác nhau · 9 lượt chạy

<details><summary><b>dòng 39</b> — <code>Repository.findAndCount</code> <i>(1 lượt, 0.4ms)</i></summary>

```sql
SELECT `User`.`id` AS `User_id`, `User`.`full_name` AS `User_full_name`, `User`.`email` AS `User_email`, `User`.`phone_number` AS `User_phone_number`, `User`.`role` AS `User_role`, `User`.`avatar` AS `User_avatar`, `User`.`email_verified` AS `User_email_verified`, `User`.`is_locked` AS `User_is_locked`, `User`.`last_seen` AS `User_last_seen`, `User`.`gender` AS `User_gender`, `User`.`token_version` AS `User_token_version`, `User`.`created_at` AS `User_created_at`, `User`.`deleted_at` AS `User_deleted_at` FROM `users` `User` WHERE `User`.`deleted_at` IS NULL LIMIT 10 OFFSET 0
```

EXPLAIN: `type=ALL` · `key=∅` · `rows=63` · `Using where` · chạy thật **0.4ms**

Route gọi tới: `GET /api/v1/users [admin]`

</details>

<details><summary><b>dòng 39</b> — <code>Repository.findAndCount</code> <i>(1 lượt, 0.25ms)</i></summary>

```sql
SELECT COUNT(1) AS `cnt` FROM `users` `User` WHERE `User`.`deleted_at` IS NULL
```

EXPLAIN: `type=ALL` · `key=∅` · `rows=63` · `Using where` · chạy thật **0.25ms**

Route gọi tới: `GET /api/v1/users [admin]`

</details>

<details><summary><b>dòng 58</b> — <code>Repository.findOne</code> <i>(1 lượt, 0.25ms)</i></summary>

```sql
SELECT `User`.`id` AS `User_id`, `User`.`full_name` AS `User_full_name`, `User`.`email` AS `User_email`, `User`.`phone_number` AS `User_phone_number`, `User`.`role` AS `User_role`, `User`.`avatar` AS `User_avatar`, `User`.`email_verified` AS `User_email_verified`, `User`.`is_locked` AS `User_is_locked`, `User`.`last_seen` AS `User_last_seen`, `User`.`gender` AS `User_gender`, `User`.`token_version` AS `User_token_version`, `User`.`created_at` AS `User_created_at`, `User`.`deleted_at` AS `User_deleted_at` FROM `users` `User` WHERE ( ((`User`.`id` = ?)) ) AND ( `User`.`deleted_at` IS NULL ) LIMIT 1
```

EXPLAIN: `type=const` · `key=PRIMARY` · `rows=1` · chạy thật **0.25ms**

Route gọi tới: `GET /api/v1/users/{id} [admin]`

</details>

<details><summary><b>dòng 104</b> — <code>QueryBuilder.getOne</code> <i>(3 lượt, 0.4ms)</i></summary>

```sql
SELECT `user`.`id` AS `user_id`, `user`.`full_name` AS `user_full_name`, `user`.`email` AS `user_email`, `user`.`password` AS `user_password`, `user`.`phone_number` AS `user_phone_number`, `user`.`role` AS `user_role` FROM `users` `user` WHERE ( `user`.`email` = ? ) AND ( `user`.`deleted_at` IS NULL )
```

EXPLAIN: `type=const` · `key=IDX_97672ac88f789774dd47f7c8be` · `rows=1` · chạy thật **0.4ms**

Route gọi tới: `(khởi động)`

</details>

<details><summary><b>dòng 112</b> — <code>Repository.update</code> <i>(3 lượt)</i></summary>

```sql
UPDATE `users` SET `refresh_token` = ? WHERE `id` IN (?)
```

Route gọi tới: `(khởi động)`

</details>

### `src/messaging/chat/chat.service.ts`

10 câu SQL khác nhau · 12 lượt chạy

<details><summary><b>dòng 106</b> — <code>Repository.findAndCount</code> — <b>[THẤP]</b> sắp xếp ngoài index (filesort); phải dựng bảng tạm <i>(1 lượt, 0.73ms)</i></summary>

```sql
SELECT DISTINCT `distinctAlias`.`Conversation_id` AS `ids_Conversation_id`, `distinctAlias`.`Conversation_updated_at` FROM (SELECT `Conversation`.`id` AS `Conversation_id`, `Conversation`.`created_at` AS `Conversation_created_at`, `Conversation`.`updated_at` AS `Conversation_updated_at`, `Conversation`.`buyer_id` AS `Conversation_buyer_id`, `Conversation`.`seller_id` AS `Conversation_seller_id`, `Conversation`.`product_id` AS `Conversation_product_id`, `Conversation__Conversation_buyer`.`id` AS `Conversation__Conversation_buyer_id`, `Conversation__Conversation_buyer`.`full_name` AS `Conversation__Conversation_buyer_full_name`, `Conversation__Conversation_buyer`.`email` AS `Conversation__Conversation_buyer_email`, `Conversation__Conversation_buyer`.`phone_number` AS `Conversation__Conversation_buyer_phone_number`, `Conversation__Conversation_buyer`.`role` AS `Conversation__Conversation_bu …(cắt bớt)
```

EXPLAIN: `type=ALL` · `key=∅` · `rows=120` · `Using temporary; Using filesort` · chạy thật **0.73ms**

Route gọi tới: `GET /api/v1/chat/conversations [buyer]`

</details>

<details><summary><b>dòng 106</b> — <code>Repository.findAndCount</code> <i>(1 lượt, 1ms)</i></summary>

```sql
SELECT `Conversation`.`id` AS `Conversation_id`, `Conversation`.`created_at` AS `Conversation_created_at`, `Conversation`.`updated_at` AS `Conversation_updated_at`, `Conversation`.`buyer_id` AS `Conversation_buyer_id`, `Conversation`.`seller_id` AS `Conversation_seller_id`, `Conversation`.`product_id` AS `Conversation_product_id`, `Conversation__Conversation_buyer`.`id` AS `Conversation__Conversation_buyer_id`, `Conversation__Conversation_buyer`.`full_name` AS `Conversation__Conversation_buyer_full_name`, `Conversation__Conversation_buyer`.`email` AS `Conversation__Conversation_buyer_email`, `Conversation__Conversation_buyer`.`phone_number` AS `Conversation__Conversation_buyer_phone_number`, `Conversation__Conversation_buyer`.`role` AS `Conversation__Conversation_buyer_role`, `Conversation__Conversation_buyer`.`avatar` AS `Conversation__Conversation_buyer_avatar`, `Conversation__Conversa …(cắt bớt)
```

EXPLAIN: `type=range` · `key=PRIMARY` · `rows=3` · `Using where; Using filesort` · chạy thật **1ms**

Route gọi tới: `GET /api/v1/chat/conversations [buyer]`

</details>

<details><summary><b>dòng 182</b> — <code>QueryBuilder.getRawMany</code> — <b>[THẤP]</b> sắp xếp ngoài index (filesort) <i>(1 lượt, 0.68ms)</i></summary>

```sql
SELECT `m`.`id` AS id, `m`.`conversation_id` AS conversation_id, `m`.`sender_id` AS sender_id, `m`.`content` AS content, `m`.`is_read` AS is_read, `m`.`created_at` AS created_at, ROW_NUMBER() OVER (PARTITION BY `m`.`conversation_id` ORDER BY `m`.`created_at` DESC, `m`.`id` DESC) AS `rn` FROM `messages` `m` WHERE `m`.`conversation_id` IN (?, ?, ?)
```

EXPLAIN: `type=range` · `key=idx_conversation_created` · `rows=90` · `Using index condition; Using filesort` · chạy thật **0.68ms**

Route gọi tới: `GET /api/v1/chat/conversations [buyer]`

</details>

<details><summary><b>dòng 211</b> — <code>QueryBuilder.getRawMany</code> <i>(1 lượt, 0.51ms)</i></summary>

```sql
SELECT `m`.`conversation_id` AS `conversation_id`, COUNT(*) AS `so` FROM `messages` `m` WHERE `m`.`conversation_id` IN (?, ?, ?) AND `m`.`is_read` = 0 AND `m`.`sender_id` <> ? GROUP BY `m`.`conversation_id`
```

EXPLAIN: `type=range` · `key=idx_conversation_created` · `rows=90` · `Using index condition; Using where` · chạy thật **0.51ms**

Route gọi tới: `GET /api/v1/chat/conversations [buyer]`

</details>

<details><summary><b>dòng 224</b> — <code>Repository.findOne</code> <i>(2 lượt, 0.29ms)</i></summary>

```sql
SELECT DISTINCT `distinctAlias`.`Conversation_id` AS `ids_Conversation_id` FROM (SELECT `Conversation`.`id` AS `Conversation_id`, `Conversation`.`created_at` AS `Conversation_created_at`, `Conversation`.`updated_at` AS `Conversation_updated_at`, `Conversation`.`buyer_id` AS `Conversation_buyer_id`, `Conversation`.`seller_id` AS `Conversation_seller_id`, `Conversation`.`product_id` AS `Conversation_product_id`, `Conversation__Conversation_buyer`.`id` AS `Conversation__Conversation_buyer_id`, `Conversation__Conversation_buyer`.`full_name` AS `Conversation__Conversation_buyer_full_name`, `Conversation__Conversation_buyer`.`email` AS `Conversation__Conversation_buyer_email`, `Conversation__Conversation_buyer`.`phone_number` AS `Conversation__Conversation_buyer_phone_number`, `Conversation__Conversation_buyer`.`role` AS `Conversation__Conversation_buyer_role`, `Conversation__Conversation_buye …(cắt bớt)
```

EXPLAIN: `type=const` · `key=PRIMARY` · `rows=1` · chạy thật **0.29ms**

Route gọi tới: `GET /api/v1/chat/conversations/{id}/messages [buyer]`, `GET /api/v1/chat/conversations/{id}/messages [seller]`

</details>

<details><summary><b>dòng 224</b> — <code>Repository.findOne</code> <i>(2 lượt, 0.6ms)</i></summary>

```sql
SELECT `Conversation`.`id` AS `Conversation_id`, `Conversation`.`created_at` AS `Conversation_created_at`, `Conversation`.`updated_at` AS `Conversation_updated_at`, `Conversation`.`buyer_id` AS `Conversation_buyer_id`, `Conversation`.`seller_id` AS `Conversation_seller_id`, `Conversation`.`product_id` AS `Conversation_product_id`, `Conversation__Conversation_buyer`.`id` AS `Conversation__Conversation_buyer_id`, `Conversation__Conversation_buyer`.`full_name` AS `Conversation__Conversation_buyer_full_name`, `Conversation__Conversation_buyer`.`email` AS `Conversation__Conversation_buyer_email`, `Conversation__Conversation_buyer`.`phone_number` AS `Conversation__Conversation_buyer_phone_number`, `Conversation__Conversation_buyer`.`role` AS `Conversation__Conversation_buyer_role`, `Conversation__Conversation_buyer`.`avatar` AS `Conversation__Conversation_buyer_avatar`, `Conversation__Conversa …(cắt bớt)
```

EXPLAIN: `type=const` · `key=PRIMARY` · `rows=1` · chạy thật **0.6ms**

Route gọi tới: `GET /api/v1/chat/conversations/{id}/messages [buyer]`, `GET /api/v1/chat/conversations/{id}/messages [seller]`

</details>

<details><summary><b>dòng 250</b> — <code>Repository.findAndCount</code> <i>(1 lượt, 0.64ms)</i></summary>

```sql
SELECT DISTINCT `distinctAlias`.`Message_id` AS `ids_Message_id`, `distinctAlias`.`Message_created_at` FROM (SELECT `Message`.`id` AS `Message_id`, `Message`.`content` AS `Message_content`, `Message`.`images` AS `Message_images`, `Message`.`is_read` AS `Message_is_read`, `Message`.`created_at` AS `Message_created_at`, `Message`.`conversation_id` AS `Message_conversation_id`, `Message`.`sender_id` AS `Message_sender_id`, `Message__Message_sender`.`id` AS `Message__Message_sender_id`, `Message__Message_sender`.`full_name` AS `Message__Message_sender_full_name`, `Message__Message_sender`.`email` AS `Message__Message_sender_email`, `Message__Message_sender`.`phone_number` AS `Message__Message_sender_phone_number`, `Message__Message_sender`.`role` AS `Message__Message_sender_role`, `Message__Message_sender`.`avatar` AS `Message__Message_sender_avatar`, `Message__Message_sender`.`email_verifie …(cắt bớt)
```

EXPLAIN: `type=ref` · `key=idx_conversation_created` · `rows=30` · chạy thật **0.64ms**

Route gọi tới: `GET /api/v1/chat/conversations/{id}/messages [seller]`

</details>

<details><summary><b>dòng 250</b> — <code>Repository.findAndCount</code> <i>(1 lượt, 0.58ms)</i></summary>

```sql
SELECT `Message`.`id` AS `Message_id`, `Message`.`content` AS `Message_content`, `Message`.`images` AS `Message_images`, `Message`.`is_read` AS `Message_is_read`, `Message`.`created_at` AS `Message_created_at`, `Message`.`conversation_id` AS `Message_conversation_id`, `Message`.`sender_id` AS `Message_sender_id`, `Message__Message_sender`.`id` AS `Message__Message_sender_id`, `Message__Message_sender`.`full_name` AS `Message__Message_sender_full_name`, `Message__Message_sender`.`email` AS `Message__Message_sender_email`, `Message__Message_sender`.`phone_number` AS `Message__Message_sender_phone_number`, `Message__Message_sender`.`role` AS `Message__Message_sender_role`, `Message__Message_sender`.`avatar` AS `Message__Message_sender_avatar`, `Message__Message_sender`.`email_verified` AS `Message__Message_sender_email_verified`, `Message__Message_sender`.`is_locked` AS `Message__Message_se …(cắt bớt)
```

EXPLAIN: `type=range` · `key=PRIMARY` · `rows=20` · `Using where` · chạy thật **0.58ms**

Route gọi tới: `GET /api/v1/chat/conversations/{id}/messages [seller]`

</details>

<details><summary><b>dòng 250</b> — <code>Repository.findAndCount</code> <i>(1 lượt, 0.4ms)</i></summary>

```sql
SELECT COUNT(DISTINCT `Message`.`id`) AS `cnt` FROM `messages` `Message` LEFT JOIN `users` `Message__Message_sender` ON `Message__Message_sender`.`id`=`Message`.`sender_id` AND (`Message__Message_sender`.`deleted_at` IS NULL) LEFT JOIN `conversations` `Message__Message_conversation` ON `Message__Message_conversation`.`id`=`Message`.`conversation_id` WHERE ((((`Message__Message_conversation`.`id` = ?))))
```

EXPLAIN: `type=ref` · `key=idx_conversation_created` · `rows=30` · chạy thật **0.4ms**

Route gọi tới: `GET /api/v1/chat/conversations/{id}/messages [seller]`

</details>

<details><summary><b>dòng 354</b> — <code>QueryBuilder.getCount</code> <i>(1 lượt, 0.37ms)</i></summary>

```sql
SELECT COUNT(DISTINCT `m`.`id`) AS `cnt` FROM `messages` `m` INNER JOIN `conversations` `c` ON `c`.`id` = `m`.`conversation_id` WHERE (`c`.`buyer_id` = ? OR `c`.`seller_id` = ?) AND `m`.`is_read` = 0 AND `m`.`sender_id` <> ?
```

EXPLAIN: `type=ref` · `key=idx_conversation_created` · `rows=30` · `Using where` · chạy thật **0.37ms**

Route gọi tới: `GET /api/v1/chat/unread-count [buyer]`

</details>

### `src/messaging/notifications/notifications.service.ts`

6 câu SQL khác nhau · 7 lượt chạy

<details><summary><b>dòng 38</b> — <code>Repository.findAndCount</code> <i>(1 lượt, 0.46ms)</i></summary>

```sql
SELECT DISTINCT `distinctAlias`.`Notification_id` AS `ids_Notification_id`, `distinctAlias`.`Notification_created_at` FROM (SELECT `Notification`.`id` AS `Notification_id`, `Notification`.`type` AS `Notification_type`, `Notification`.`title` AS `Notification_title`, `Notification`.`content` AS `Notification_content`, `Notification`.`data` AS `Notification_data`, `Notification`.`is_read` AS `Notification_is_read`, `Notification`.`created_at` AS `Notification_created_at`, `Notification`.`user_id` AS `Notification_user_id` FROM `notifications` `Notification` LEFT JOIN `users` `Notification__Notification_user` ON `Notification__Notification_user`.`id`=`Notification`.`user_id` AND (`Notification__Notification_user`.`deleted_at` IS NULL) WHERE ((((`Notification__Notification_user`.`id` = ?))))) `distinctAlias` ORDER BY `distinctAlias`.`Notification_created_at` DESC, `Notification_id` ASC LIMIT …(cắt bớt)
```

EXPLAIN: `type=ref` · `key=idx_user_created` · `rows=25` · `Using index` · chạy thật **0.46ms**

Route gọi tới: `GET /api/v1/notifications [buyer]`

</details>

<details><summary><b>dòng 38</b> — <code>Repository.findAndCount</code> <i>(1 lượt, 0.43ms)</i></summary>

```sql
SELECT `Notification`.`id` AS `Notification_id`, `Notification`.`type` AS `Notification_type`, `Notification`.`title` AS `Notification_title`, `Notification`.`content` AS `Notification_content`, `Notification`.`data` AS `Notification_data`, `Notification`.`is_read` AS `Notification_is_read`, `Notification`.`created_at` AS `Notification_created_at`, `Notification`.`user_id` AS `Notification_user_id` FROM `notifications` `Notification` LEFT JOIN `users` `Notification__Notification_user` ON `Notification__Notification_user`.`id`=`Notification`.`user_id` AND (`Notification__Notification_user`.`deleted_at` IS NULL) WHERE ( ((((`Notification__Notification_user`.`id` = ?)))) ) AND ( `Notification`.`id` IN (75, 74, 73, 72, 71, 70, 69, 68, 67, 66) ) ORDER BY `Notification`.`created_at` DESC
```

EXPLAIN: `type=range` · `key=PRIMARY` · `rows=10` · `Using where` · chạy thật **0.43ms**

Route gọi tới: `GET /api/v1/notifications [buyer]`

</details>

<details><summary><b>dòng 38</b> — <code>Repository.findAndCount</code> <i>(1 lượt, 0.28ms)</i></summary>

```sql
SELECT COUNT(DISTINCT `Notification`.`id`) AS `cnt` FROM `notifications` `Notification` LEFT JOIN `users` `Notification__Notification_user` ON `Notification__Notification_user`.`id`=`Notification`.`user_id` AND (`Notification__Notification_user`.`deleted_at` IS NULL) WHERE ((((`Notification__Notification_user`.`id` = ?))))
```

EXPLAIN: `type=ref` · `key=idx_user_read` · `rows=25` · `Using index` · chạy thật **0.28ms**

Route gọi tới: `GET /api/v1/notifications [buyer]`

</details>

<details><summary><b>dòng 59</b> — <code>Repository.count</code> <i>(1 lượt, 0.28ms)</i></summary>

```sql
SELECT COUNT(DISTINCT `Notification`.`id`) AS `cnt` FROM `notifications` `Notification` LEFT JOIN `users` `Notification__Notification_user` ON `Notification__Notification_user`.`id`=`Notification`.`user_id` AND (`Notification__Notification_user`.`deleted_at` IS NULL) WHERE ((((`Notification__Notification_user`.`id` = ?))) AND (`Notification`.`is_read` = ?))
```

EXPLAIN: `type=ref` · `key=idx_user_read` · `rows=8` · `Using index` · chạy thật **0.28ms**

Route gọi tới: `GET /api/v1/notifications/unread-count [buyer]`

</details>

<details><summary><b>dòng 66</b> — <code>Repository.findOne</code> <i>(2 lượt, 0.32ms)</i></summary>

```sql
SELECT DISTINCT `distinctAlias`.`Notification_id` AS `ids_Notification_id` FROM (SELECT `Notification`.`id` AS `Notification_id`, `Notification`.`type` AS `Notification_type`, `Notification`.`title` AS `Notification_title`, `Notification`.`content` AS `Notification_content`, `Notification`.`data` AS `Notification_data`, `Notification`.`is_read` AS `Notification_is_read`, `Notification`.`created_at` AS `Notification_created_at`, `Notification`.`user_id` AS `Notification_user_id` FROM `notifications` `Notification` LEFT JOIN `users` `Notification__Notification_user` ON `Notification__Notification_user`.`id`=`Notification`.`user_id` AND (`Notification__Notification_user`.`deleted_at` IS NULL) WHERE ((`Notification`.`id` = ?) AND (((`Notification__Notification_user`.`id` = ?))))) `distinctAlias` ORDER BY `Notification_id` ASC LIMIT 1
```

EXPLAIN: `type=?` · `key=∅` · `rows=0` · `Impossible WHERE noticed after reading const tables` · chạy thật **0.32ms**

Route gọi tới: `GET /api/v1/notifications/{id} [buyer]`, `GET /api/v1/notifications/{id} [seller]`

</details>

<details><summary><b>dòng 66</b> — <code>Repository.findOne</code> <i>(1 lượt, 0.49ms)</i></summary>

```sql
SELECT `Notification`.`id` AS `Notification_id`, `Notification`.`type` AS `Notification_type`, `Notification`.`title` AS `Notification_title`, `Notification`.`content` AS `Notification_content`, `Notification`.`data` AS `Notification_data`, `Notification`.`is_read` AS `Notification_is_read`, `Notification`.`created_at` AS `Notification_created_at`, `Notification`.`user_id` AS `Notification_user_id` FROM `notifications` `Notification` LEFT JOIN `users` `Notification__Notification_user` ON `Notification__Notification_user`.`id`=`Notification`.`user_id` AND (`Notification__Notification_user`.`deleted_at` IS NULL) WHERE ( ((`Notification`.`id` = ?) AND (((`Notification__Notification_user`.`id` = ?)))) ) AND ( `Notification`.`id` IN (1) )
```

EXPLAIN: `type=const` · `key=PRIMARY` · `rows=1` · chạy thật **0.49ms**

Route gọi tới: `GET /api/v1/notifications/{id} [seller]`

</details>

### `src/money/escrows/escrows.service.ts`

6 câu SQL khác nhau · 6 lượt chạy

<details><summary><b>dòng 246</b> — <code>Repository.find</code> <i>(1 lượt, 0.61ms)</i></summary>

```sql
SELECT `Escrow`.`id` AS `Escrow_id`, `Escrow`.`amount` AS `Escrow_amount`, `Escrow`.`status` AS `Escrow_status`, `Escrow`.`released_at` AS `Escrow_released_at`, `Escrow`.`note` AS `Escrow_note`, `Escrow`.`created_at` AS `Escrow_created_at`, `Escrow`.`updated_at` AS `Escrow_updated_at`, `Escrow`.`order_id` AS `Escrow_order_id`, `Escrow`.`buyer_id` AS `Escrow_buyer_id`, `Escrow`.`seller_id` AS `Escrow_seller_id`, `Escrow__Escrow_buyer`.`id` AS `Escrow__Escrow_buyer_id`, `Escrow__Escrow_buyer`.`full_name` AS `Escrow__Escrow_buyer_full_name`, `Escrow__Escrow_buyer`.`email` AS `Escrow__Escrow_buyer_email`, `Escrow__Escrow_buyer`.`phone_number` AS `Escrow__Escrow_buyer_phone_number`, `Escrow__Escrow_buyer`.`role` AS `Escrow__Escrow_buyer_role`, `Escrow__Escrow_buyer`.`avatar` AS `Escrow__Escrow_buyer_avatar`, `Escrow__Escrow_buyer`.`email_verified` AS `Escrow__Escrow_buyer_email_verified`, `Es …(cắt bớt)
```

EXPLAIN: `type=const` · `key=PRIMARY` · `rows=1` · chạy thật **0.61ms**

Route gọi tới: `GET /api/v1/escrows/order/{orderId} [buyer]`

</details>

<details><summary><b>dòng 261</b> — <code>Repository.findAndCount</code> <i>(1 lượt, 0.56ms)</i></summary>

```sql
SELECT DISTINCT `distinctAlias`.`Escrow_id` AS `ids_Escrow_id`, `distinctAlias`.`Escrow_created_at` FROM (SELECT `Escrow`.`id` AS `Escrow_id`, `Escrow`.`amount` AS `Escrow_amount`, `Escrow`.`status` AS `Escrow_status`, `Escrow`.`released_at` AS `Escrow_released_at`, `Escrow`.`note` AS `Escrow_note`, `Escrow`.`created_at` AS `Escrow_created_at`, `Escrow`.`updated_at` AS `Escrow_updated_at`, `Escrow`.`order_id` AS `Escrow_order_id`, `Escrow`.`buyer_id` AS `Escrow_buyer_id`, `Escrow`.`seller_id` AS `Escrow_seller_id`, `Escrow__Escrow_order`.`id` AS `Escrow__Escrow_order_id`, `Escrow__Escrow_order`.`order_code` AS `Escrow__Escrow_order_order_code`, `Escrow__Escrow_order`.`total_amount` AS `Escrow__Escrow_order_total_amount`, `Escrow__Escrow_order`.`shipping_fee` AS `Escrow__Escrow_order_shipping_fee`, `Escrow__Escrow_order`.`discount_amount` AS `Escrow__Escrow_order_discount_amount`, `Escrow …(cắt bớt)
```

EXPLAIN: `type=ref` · `key=idx_seller` · `rows=2` · chạy thật **0.56ms**

Route gọi tới: `GET /api/v1/escrows/seller/{sellerId} [buyer]`

</details>

<details><summary><b>dòng 261</b> — <code>Repository.findAndCount</code> <i>(1 lượt, 0.89ms)</i></summary>

```sql
SELECT `Escrow`.`id` AS `Escrow_id`, `Escrow`.`amount` AS `Escrow_amount`, `Escrow`.`status` AS `Escrow_status`, `Escrow`.`released_at` AS `Escrow_released_at`, `Escrow`.`note` AS `Escrow_note`, `Escrow`.`created_at` AS `Escrow_created_at`, `Escrow`.`updated_at` AS `Escrow_updated_at`, `Escrow`.`order_id` AS `Escrow_order_id`, `Escrow`.`buyer_id` AS `Escrow_buyer_id`, `Escrow`.`seller_id` AS `Escrow_seller_id`, `Escrow__Escrow_order`.`id` AS `Escrow__Escrow_order_id`, `Escrow__Escrow_order`.`order_code` AS `Escrow__Escrow_order_order_code`, `Escrow__Escrow_order`.`total_amount` AS `Escrow__Escrow_order_total_amount`, `Escrow__Escrow_order`.`shipping_fee` AS `Escrow__Escrow_order_shipping_fee`, `Escrow__Escrow_order`.`discount_amount` AS `Escrow__Escrow_order_discount_amount`, `Escrow__Escrow_order`.`final_amount` AS `Escrow__Escrow_order_final_amount`, `Escrow__Escrow_order`.`currency` A …(cắt bớt)
```

EXPLAIN: `type=range` · `key=PRIMARY` · `rows=2` · `Using where` · chạy thật **0.89ms**

Route gọi tới: `GET /api/v1/escrows/seller/{sellerId} [buyer]`

</details>

<details><summary><b>dòng 284</b> — <code>Repository.findAndCount</code> <i>(1 lượt, 0.54ms)</i></summary>

```sql
SELECT DISTINCT `distinctAlias`.`Escrow_id` AS `ids_Escrow_id`, `distinctAlias`.`Escrow_created_at` FROM (SELECT `Escrow`.`id` AS `Escrow_id`, `Escrow`.`amount` AS `Escrow_amount`, `Escrow`.`status` AS `Escrow_status`, `Escrow`.`released_at` AS `Escrow_released_at`, `Escrow`.`note` AS `Escrow_note`, `Escrow`.`created_at` AS `Escrow_created_at`, `Escrow`.`updated_at` AS `Escrow_updated_at`, `Escrow`.`order_id` AS `Escrow_order_id`, `Escrow`.`buyer_id` AS `Escrow_buyer_id`, `Escrow`.`seller_id` AS `Escrow_seller_id`, `Escrow__Escrow_order`.`id` AS `Escrow__Escrow_order_id`, `Escrow__Escrow_order`.`order_code` AS `Escrow__Escrow_order_order_code`, `Escrow__Escrow_order`.`total_amount` AS `Escrow__Escrow_order_total_amount`, `Escrow__Escrow_order`.`shipping_fee` AS `Escrow__Escrow_order_shipping_fee`, `Escrow__Escrow_order`.`discount_amount` AS `Escrow__Escrow_order_discount_amount`, `Escrow …(cắt bớt)
```

EXPLAIN: `type=ALL` · `key=∅` · `rows=2` · `Using temporary; Using filesort` · chạy thật **0.54ms**

Route gọi tới: `GET /api/v1/escrows [buyer]`

</details>

<details><summary><b>dòng 284</b> — <code>Repository.findAndCount</code> <i>(1 lượt, 1.52ms)</i></summary>

```sql
SELECT `Escrow`.`id` AS `Escrow_id`, `Escrow`.`amount` AS `Escrow_amount`, `Escrow`.`status` AS `Escrow_status`, `Escrow`.`released_at` AS `Escrow_released_at`, `Escrow`.`note` AS `Escrow_note`, `Escrow`.`created_at` AS `Escrow_created_at`, `Escrow`.`updated_at` AS `Escrow_updated_at`, `Escrow`.`order_id` AS `Escrow_order_id`, `Escrow`.`buyer_id` AS `Escrow_buyer_id`, `Escrow`.`seller_id` AS `Escrow_seller_id`, `Escrow__Escrow_order`.`id` AS `Escrow__Escrow_order_id`, `Escrow__Escrow_order`.`order_code` AS `Escrow__Escrow_order_order_code`, `Escrow__Escrow_order`.`total_amount` AS `Escrow__Escrow_order_total_amount`, `Escrow__Escrow_order`.`shipping_fee` AS `Escrow__Escrow_order_shipping_fee`, `Escrow__Escrow_order`.`discount_amount` AS `Escrow__Escrow_order_discount_amount`, `Escrow__Escrow_order`.`final_amount` AS `Escrow__Escrow_order_final_amount`, `Escrow__Escrow_order`.`currency` A …(cắt bớt)
```

EXPLAIN: `type=range` · `key=PRIMARY` · `rows=2` · `Using where; Using filesort` · chạy thật **1.52ms**

Route gọi tới: `GET /api/v1/escrows [buyer]`

</details>

<details><summary><b>dòng 309</b> — <code>QueryBuilder.getRawOne</code> <i>(1 lượt, 0.34ms)</i></summary>

```sql
SELECT COALESCE(SUM(`escrow`.`amount`), 0) AS `total` FROM `escrows` `escrow` WHERE `escrow`.`seller_id` = ? AND `escrow`.`status` = ?
```

EXPLAIN: `type=ref` · `key=idx_seller` · `rows=2` · `Using where` · chạy thật **0.34ms**

Route gọi tới: `GET /api/v1/escrows/held/{sellerId} [buyer]`

</details>

### `src/money/ledger/ledger.service.ts`

2 câu SQL khác nhau · 5 lượt chạy

<details><summary><b>dòng 74</b> — <code>EntityManager.findOne</code> <i>(1 lượt, 0.25ms)</i></summary>

```sql
SELECT `LedgerAccount`.`id` AS `LedgerAccount_id`, `LedgerAccount`.`owner_type` AS `LedgerAccount_owner_type`, `LedgerAccount`.`owner_id` AS `LedgerAccount_owner_id`, `LedgerAccount`.`purpose` AS `LedgerAccount_purpose`, `LedgerAccount`.`balance` AS `LedgerAccount_balance`, `LedgerAccount`.`version` AS `LedgerAccount_version`, `LedgerAccount`.`created_at` AS `LedgerAccount_created_at`, `LedgerAccount`.`updated_at` AS `LedgerAccount_updated_at` FROM `ledger_accounts` `LedgerAccount` WHERE ((`LedgerAccount`.`owner_type` = ?) AND (`LedgerAccount`.`owner_id` = ?) AND (`LedgerAccount`.`purpose` = ?)) LIMIT 1
```

EXPLAIN: `type=const` · `key=uq_ledger_account` · `rows=1` · chạy thật **0.25ms**

Route gọi tới: `GET /api/v1/wallets/transactions [buyer]`

</details>

<details><summary><b>dòng 232</b> — <code>EntityManager.findOne</code> <i>(4 lượt, 0.44ms)</i></summary>

```sql
SELECT `LedgerAccount`.`id` AS `LedgerAccount_id`, `LedgerAccount`.`owner_type` AS `LedgerAccount_owner_type`, `LedgerAccount`.`owner_id` AS `LedgerAccount_owner_id`, `LedgerAccount`.`purpose` AS `LedgerAccount_purpose`, `LedgerAccount`.`balance` AS `LedgerAccount_balance`, `LedgerAccount`.`version` AS `LedgerAccount_version`, `LedgerAccount`.`created_at` AS `LedgerAccount_created_at`, `LedgerAccount`.`updated_at` AS `LedgerAccount_updated_at` FROM `ledger_accounts` `LedgerAccount` WHERE ((`LedgerAccount`.`owner_type` = ?) AND (`LedgerAccount`.`owner_id` = ?) AND (`LedgerAccount`.`purpose` = ?)) LIMIT 1
```

EXPLAIN: `type=const` · `key=uq_ledger_account` · `rows=1` · chạy thật **0.44ms**

Route gọi tới: `GET /api/v1/payments/wallet/balance [buyer]`, `GET /api/v1/wallets/balance [buyer]`

</details>

### `src/money/payments/payments.service.ts`

6 câu SQL khác nhau · 7 lượt chạy

<details><summary><b>dòng 164</b> — <code>Repository.findAndCount</code> <i>(1 lượt, 0.66ms)</i></summary>

```sql
SELECT DISTINCT `distinctAlias`.`Payment_id` AS `ids_Payment_id`, `distinctAlias`.`Payment_created_at` FROM (SELECT `Payment`.`id` AS `Payment_id`, `Payment`.`amount` AS `Payment_amount`, `Payment`.`payment_method` AS `Payment_payment_method`, `Payment`.`transaction_code` AS `Payment_transaction_code`, `Payment`.`status` AS `Payment_status`, `Payment`.`type` AS `Payment_type`, `Payment`.`note` AS `Payment_note`, `Payment`.`paid_at` AS `Payment_paid_at`, `Payment`.`payos_order_code` AS `Payment_payos_order_code`, `Payment`.`payos_payment_link_id` AS `Payment_payos_payment_link_id`, `Payment`.`payos_checkout_url` AS `Payment_payos_checkout_url`, `Payment`.`payos_qr_code` AS `Payment_payos_qr_code`, `Payment`.`created_at` AS `Payment_created_at`, `Payment`.`updated_at` AS `Payment_updated_at`, `Payment`.`order_id` AS `Payment_order_id`, `Payment`.`user_id` AS `Payment_user_id`, `Payment__Pa …(cắt bớt)
```

EXPLAIN: `type=ref` · `key=idx_user_id` · `rows=15` · chạy thật **0.66ms**

Route gọi tới: `GET /api/v1/payments [buyer]`

</details>

<details><summary><b>dòng 164</b> — <code>Repository.findAndCount</code> <i>(1 lượt, 0.94ms)</i></summary>

```sql
SELECT `Payment`.`id` AS `Payment_id`, `Payment`.`amount` AS `Payment_amount`, `Payment`.`payment_method` AS `Payment_payment_method`, `Payment`.`transaction_code` AS `Payment_transaction_code`, `Payment`.`status` AS `Payment_status`, `Payment`.`type` AS `Payment_type`, `Payment`.`note` AS `Payment_note`, `Payment`.`paid_at` AS `Payment_paid_at`, `Payment`.`payos_order_code` AS `Payment_payos_order_code`, `Payment`.`payos_payment_link_id` AS `Payment_payos_payment_link_id`, `Payment`.`payos_checkout_url` AS `Payment_payos_checkout_url`, `Payment`.`payos_qr_code` AS `Payment_payos_qr_code`, `Payment`.`created_at` AS `Payment_created_at`, `Payment`.`updated_at` AS `Payment_updated_at`, `Payment`.`order_id` AS `Payment_order_id`, `Payment`.`user_id` AS `Payment_user_id`, `Payment__Payment_order`.`id` AS `Payment__Payment_order_id`, `Payment__Payment_order`.`order_code` AS `Payment__Payment_ …(cắt bớt)
```

EXPLAIN: `type=range` · `key=PRIMARY` · `rows=10` · `Using where` · chạy thật **0.94ms**

Route gọi tới: `GET /api/v1/payments [buyer]`

</details>

<details><summary><b>dòng 164</b> — <code>Repository.findAndCount</code> <i>(1 lượt, 0.31ms)</i></summary>

```sql
SELECT COUNT(DISTINCT `Payment`.`id`) AS `cnt` FROM `payments` `Payment` LEFT JOIN `orders` `Payment__Payment_order` ON `Payment__Payment_order`.`id`=`Payment`.`order_id` AND (`Payment__Payment_order`.`deleted_at` IS NULL) LEFT JOIN `users` `Payment__Payment_user` ON `Payment__Payment_user`.`id`=`Payment`.`user_id` AND (`Payment__Payment_user`.`deleted_at` IS NULL) WHERE ((((`Payment__Payment_user`.`id` = ?))))
```

EXPLAIN: `type=ref` · `key=idx_user_id` · `rows=15` · chạy thật **0.31ms**

Route gọi tới: `GET /api/v1/payments [buyer]`

</details>

<details><summary><b>dòng 189</b> — <code>Repository.findOne</code> <i>(2 lượt, 0.5ms)</i></summary>

```sql
SELECT DISTINCT `distinctAlias`.`Payment_id` AS `ids_Payment_id` FROM (SELECT `Payment`.`id` AS `Payment_id`, `Payment`.`amount` AS `Payment_amount`, `Payment`.`payment_method` AS `Payment_payment_method`, `Payment`.`transaction_code` AS `Payment_transaction_code`, `Payment`.`status` AS `Payment_status`, `Payment`.`type` AS `Payment_type`, `Payment`.`note` AS `Payment_note`, `Payment`.`paid_at` AS `Payment_paid_at`, `Payment`.`payos_order_code` AS `Payment_payos_order_code`, `Payment`.`payos_payment_link_id` AS `Payment_payos_payment_link_id`, `Payment`.`payos_checkout_url` AS `Payment_payos_checkout_url`, `Payment`.`payos_qr_code` AS `Payment_payos_qr_code`, `Payment`.`created_at` AS `Payment_created_at`, `Payment`.`updated_at` AS `Payment_updated_at`, `Payment`.`order_id` AS `Payment_order_id`, `Payment`.`user_id` AS `Payment_user_id`, `Payment__Payment_order`.`id` AS `Payment__Payment …(cắt bớt)
```

EXPLAIN: `type=?` · `key=∅` · `rows=0` · `Impossible WHERE noticed after reading const tables` · chạy thật **0.5ms**

Route gọi tới: `GET /api/v1/payments/{id} [buyer]`, `GET /api/v1/payments/{id} [seller]`

</details>

<details><summary><b>dòng 189</b> — <code>Repository.findOne</code> <i>(1 lượt, 0.37ms)</i></summary>

```sql
SELECT DISTINCT `distinctAlias`.`Payment_id` AS `ids_Payment_id` FROM (SELECT `Payment`.`id` AS `Payment_id`, `Payment`.`amount` AS `Payment_amount`, `Payment`.`payment_method` AS `Payment_payment_method`, `Payment`.`transaction_code` AS `Payment_transaction_code`, `Payment`.`status` AS `Payment_status`, `Payment`.`type` AS `Payment_type`, `Payment`.`note` AS `Payment_note`, `Payment`.`paid_at` AS `Payment_paid_at`, `Payment`.`payos_order_code` AS `Payment_payos_order_code`, `Payment`.`payos_payment_link_id` AS `Payment_payos_payment_link_id`, `Payment`.`payos_checkout_url` AS `Payment_payos_checkout_url`, `Payment`.`payos_qr_code` AS `Payment_payos_qr_code`, `Payment`.`created_at` AS `Payment_created_at`, `Payment`.`updated_at` AS `Payment_updated_at`, `Payment`.`order_id` AS `Payment_order_id`, `Payment`.`user_id` AS `Payment_user_id`, `Payment__Payment_order`.`id` AS `Payment__Payment …(cắt bớt)
```

EXPLAIN: `type=const` · `key=PRIMARY` · `rows=1` · chạy thật **0.37ms**

Route gọi tới: `GET /api/v1/payments/{id} [admin]`

</details>

<details><summary><b>dòng 189</b> — <code>Repository.findOne</code> <i>(1 lượt, 0.57ms)</i></summary>

```sql
SELECT `Payment`.`id` AS `Payment_id`, `Payment`.`amount` AS `Payment_amount`, `Payment`.`payment_method` AS `Payment_payment_method`, `Payment`.`transaction_code` AS `Payment_transaction_code`, `Payment`.`status` AS `Payment_status`, `Payment`.`type` AS `Payment_type`, `Payment`.`note` AS `Payment_note`, `Payment`.`paid_at` AS `Payment_paid_at`, `Payment`.`payos_order_code` AS `Payment_payos_order_code`, `Payment`.`payos_payment_link_id` AS `Payment_payos_payment_link_id`, `Payment`.`payos_checkout_url` AS `Payment_payos_checkout_url`, `Payment`.`payos_qr_code` AS `Payment_payos_qr_code`, `Payment`.`created_at` AS `Payment_created_at`, `Payment`.`updated_at` AS `Payment_updated_at`, `Payment`.`order_id` AS `Payment_order_id`, `Payment`.`user_id` AS `Payment_user_id`, `Payment__Payment_order`.`id` AS `Payment__Payment_order_id`, `Payment__Payment_order`.`order_code` AS `Payment__Payment_ …(cắt bớt)
```

EXPLAIN: `type=const` · `key=PRIMARY` · `rows=1` · chạy thật **0.57ms**

Route gọi tới: `GET /api/v1/payments/{id} [admin]`

</details>

### `src/money/payos/payos.service.ts`

2 câu SQL khác nhau · 2 lượt chạy

<details><summary><b>dòng 196</b> — <code>Repository.findOne</code> <i>(1 lượt, 0.46ms)</i></summary>

```sql
SELECT `Order`.`id` AS `Order_id`, `Order`.`order_code` AS `Order_order_code`, `Order`.`total_amount` AS `Order_total_amount`, `Order`.`shipping_fee` AS `Order_shipping_fee`, `Order`.`discount_amount` AS `Order_discount_amount`, `Order`.`final_amount` AS `Order_final_amount`, `Order`.`currency` AS `Order_currency`, `Order`.`status` AS `Order_status`, `Order`.`payment_method` AS `Order_payment_method`, `Order`.`is_paid` AS `Order_is_paid`, `Order`.`paid_at` AS `Order_paid_at`, `Order`.`receiver_name` AS `Order_receiver_name`, `Order`.`receiver_phone` AS `Order_receiver_phone`, `Order`.`shipping_address` AS `Order_shipping_address`, `Order`.`province` AS `Order_province`, `Order`.`district` AS `Order_district`, `Order`.`ghn_district_id` AS `Order_ghn_district_id`, `Order`.`ghn_ward_code` AS `Order_ghn_ward_code`, `Order`.`note` AS `Order_note`, `Order`.`tracking_code` AS `Order_tracking_co …(cắt bớt)
```

EXPLAIN: `type=const` · `key=PRIMARY` · `rows=1` · chạy thật **0.46ms**

Route gọi tới: `GET /api/v1/payos/order/{orderId} [buyer]`

</details>

<details><summary><b>dòng 202</b> — <code>Repository.findOne</code> <i>(1 lượt, 0.37ms)</i></summary>

```sql
SELECT DISTINCT `distinctAlias`.`Payment_id` AS `ids_Payment_id`, `distinctAlias`.`Payment_created_at` FROM (SELECT `Payment`.`id` AS `Payment_id`, `Payment`.`amount` AS `Payment_amount`, `Payment`.`payment_method` AS `Payment_payment_method`, `Payment`.`transaction_code` AS `Payment_transaction_code`, `Payment`.`status` AS `Payment_status`, `Payment`.`type` AS `Payment_type`, `Payment`.`note` AS `Payment_note`, `Payment`.`paid_at` AS `Payment_paid_at`, `Payment`.`payos_order_code` AS `Payment_payos_order_code`, `Payment`.`payos_payment_link_id` AS `Payment_payos_payment_link_id`, `Payment`.`payos_checkout_url` AS `Payment_payos_checkout_url`, `Payment`.`payos_qr_code` AS `Payment_payos_qr_code`, `Payment`.`created_at` AS `Payment_created_at`, `Payment`.`updated_at` AS `Payment_updated_at`, `Payment`.`order_id` AS `Payment_order_id`, `Payment`.`user_id` AS `Payment_user_id` FROM `payment …(cắt bớt)
```

EXPLAIN: `type=const` · `key=PRIMARY` · `rows=1` · `Using temporary; Using filesort` · chạy thật **0.37ms**

Route gọi tới: `GET /api/v1/payos/order/{orderId} [buyer]`

</details>

### `src/money/wallets/wallets.service.ts`

2 câu SQL khác nhau · 2 lượt chạy

<details><summary><b>dòng 244</b> — <code>EntityManager.query</code> <i>(1 lượt, 0.42ms)</i></summary>

```sql
SELECT COUNT(*) AS total FROM ledger_entries e JOIN ledger_transactions t ON t.id = e.transaction_id WHERE e.account_id = ?
```

EXPLAIN: `type=ref` · `key=idx_ledger_entry_account_time` · `rows=1` · `Using index condition; Using where` · chạy thật **0.42ms**

Route gọi tới: `GET /api/v1/wallets/transactions [buyer]`

</details>

<details><summary><b>dòng 251</b> — <code>EntityManager.query</code> <i>(1 lượt, 0.42ms)</i></summary>

```sql
SELECT e.id, e.amount, e.balance_after, e.created_at, t.type, t.reference_type, t.reference_id, t.metadata FROM ledger_entries e JOIN ledger_transactions t ON t.id = e.transaction_id WHERE e.account_id = ? ORDER BY e.id DESC LIMIT ? OFFSET ?
```

EXPLAIN: `type=ref` · `key=idx_ledger_entry_account_time` · `rows=1` · `Using index condition; Using where; Using filesort` · chạy thật **0.42ms**

Route gọi tới: `GET /api/v1/wallets/transactions [buyer]`

</details>

### `src/money/withdrawals/withdrawals.service.ts`

1 câu SQL khác nhau · 1 lượt chạy

<details><summary><b>dòng 119</b> — <code>Repository.findAndCount</code> <i>(1 lượt, 0.33ms)</i></summary>

```sql
SELECT DISTINCT `distinctAlias`.`Withdrawal_id` AS `ids_Withdrawal_id`, `distinctAlias`.`Withdrawal_created_at` FROM (SELECT `Withdrawal`.`id` AS `Withdrawal_id`, `Withdrawal`.`amount` AS `Withdrawal_amount`, `Withdrawal`.`bank_name` AS `Withdrawal_bank_name`, `Withdrawal`.`bank_account` AS `Withdrawal_bank_account`, `Withdrawal`.`bank_holder` AS `Withdrawal_bank_holder`, `Withdrawal`.`status` AS `Withdrawal_status`, `Withdrawal`.`note` AS `Withdrawal_note`, `Withdrawal`.`processed_at` AS `Withdrawal_processed_at`, `Withdrawal`.`created_at` AS `Withdrawal_created_at`, `Withdrawal`.`updated_at` AS `Withdrawal_updated_at`, `Withdrawal`.`user_id` AS `Withdrawal_user_id`, `Withdrawal`.`approved_by` AS `Withdrawal_approved_by` FROM `withdrawals` `Withdrawal` LEFT JOIN `users` `Withdrawal__Withdrawal_user` ON `Withdrawal__Withdrawal_user`.`id`=`Withdrawal`.`user_id` AND (`Withdrawal__Withdrawa …(cắt bớt)
```

EXPLAIN: `type=const` · `key=PRIMARY` · `rows=1` · `Using temporary; Using filesort` · chạy thật **0.33ms**

Route gọi tới: `GET /api/v1/withdrawals/me [buyer]`

</details>

### `src/ops/admin/admin.service.ts`

14 câu SQL khác nhau · 14 lượt chạy · **1 mức CAO** · 6 mức VỪA

<details><summary><b>dòng 47</b> — <code>Repository.findAndCount</code> — <b>[THẤP]</b> sắp xếp ngoài index (filesort) <i>(1 lượt, 0.33ms)</i></summary>

```sql
SELECT `User`.`id` AS `User_id`, `User`.`full_name` AS `User_full_name`, `User`.`email` AS `User_email`, `User`.`phone_number` AS `User_phone_number`, `User`.`role` AS `User_role`, `User`.`avatar` AS `User_avatar`, `User`.`email_verified` AS `User_email_verified`, `User`.`is_locked` AS `User_is_locked`, `User`.`last_seen` AS `User_last_seen`, `User`.`gender` AS `User_gender`, `User`.`token_version` AS `User_token_version`, `User`.`created_at` AS `User_created_at`, `User`.`deleted_at` AS `User_deleted_at` FROM `users` `User` WHERE `User`.`deleted_at` IS NULL ORDER BY `User`.`created_at` DESC LIMIT 20 OFFSET 0
```

EXPLAIN: `type=ALL` · `key=∅` · `rows=63` · `Using where; Using filesort` · chạy thật **0.33ms**

Route gọi tới: `GET /api/v1/admin/users [admin]`

</details>

<details><summary><b>dòng 47</b> — <code>Repository.findAndCount</code> <i>(1 lượt, 0.29ms)</i></summary>

```sql
SELECT COUNT(1) AS `cnt` FROM `users` `User` WHERE `User`.`deleted_at` IS NULL
```

EXPLAIN: `type=ALL` · `key=∅` · `rows=63` · `Using where` · chạy thật **0.29ms**

Route gọi tới: `GET /api/v1/admin/users [admin]`

</details>

<details><summary><b>dòng 66</b> — <code>Repository.findOne</code> <i>(1 lượt, 0.4ms)</i></summary>

```sql
SELECT `User`.`id` AS `User_id`, `User`.`full_name` AS `User_full_name`, `User`.`email` AS `User_email`, `User`.`phone_number` AS `User_phone_number`, `User`.`role` AS `User_role`, `User`.`avatar` AS `User_avatar`, `User`.`email_verified` AS `User_email_verified`, `User`.`is_locked` AS `User_is_locked`, `User`.`last_seen` AS `User_last_seen`, `User`.`gender` AS `User_gender`, `User`.`token_version` AS `User_token_version`, `User`.`created_at` AS `User_created_at`, `User`.`deleted_at` AS `User_deleted_at` FROM `users` `User` WHERE ( ((`User`.`id` = ?)) ) AND ( `User`.`deleted_at` IS NULL ) LIMIT 1
```

EXPLAIN: `type=const` · `key=PRIMARY` · `rows=1` · chạy thật **0.4ms**

Route gọi tới: `GET /api/v1/admin/users/{id} [admin]`

</details>

<details><summary><b>dòng 70</b> — <code>Repository.count</code> <i>(1 lượt, 0.3ms)</i></summary>

```sql
SELECT COUNT(DISTINCT `Order`.`id`) AS `cnt` FROM `orders` `Order` LEFT JOIN `users` `Order__Order_user` ON `Order__Order_user`.`id`=`Order`.`user_id` AND (`Order__Order_user`.`deleted_at` IS NULL) WHERE ( ((((`Order__Order_user`.`id` = ?)))) ) AND ( `Order`.`deleted_at` IS NULL )
```

EXPLAIN: `type=const` · `key=PRIMARY` · `rows=1` · chạy thật **0.3ms**

Route gọi tới: `GET /api/v1/admin/users/{id} [admin]`

</details>

<details><summary><b>dòng 71</b> — <code>Repository.count</code> — <b>[VỪA]</b> đếm cả bảng 2011 dòng cho phân trang <i>(1 lượt, 1.12ms)</i></summary>

```sql
SELECT COUNT(DISTINCT `Product`.`id`) AS `cnt` FROM `products` `Product` LEFT JOIN `users` `Product__Product_seller` ON `Product__Product_seller`.`id`=`Product`.`seller_id` AND (`Product__Product_seller`.`deleted_at` IS NULL) WHERE ( ((((`Product__Product_seller`.`id` = ?)))) ) AND ( `Product`.`deleted_at` IS NULL )
```

EXPLAIN: `type=ALL` · `key=∅` · `rows=2011` · `Using where` · chạy thật **1.12ms**

Route gọi tới: `GET /api/v1/admin/users/{id} [admin]`

</details>

<details><summary><b>dòng 130</b> — <code>Repository.count</code> <i>(1 lượt, 0.31ms)</i></summary>

```sql
SELECT COUNT(1) AS `cnt` FROM `users` `User` WHERE `User`.`deleted_at` IS NULL
```

EXPLAIN: `type=ALL` · `key=∅` · `rows=63` · `Using where` · chạy thật **0.31ms**

Route gọi tới: `GET /api/v1/admin/stats [admin]`

</details>

<details><summary><b>dòng 131</b> — <code>Repository.count</code> — <b>[VỪA]</b> đếm cả bảng 2011 dòng cho phân trang <i>(1 lượt, 0.85ms)</i></summary>

```sql
SELECT COUNT(1) AS `cnt` FROM `products` `Product` WHERE `Product`.`deleted_at` IS NULL
```

EXPLAIN: `type=ALL` · `key=∅` · `rows=2011` · `Using where` · chạy thật **0.85ms**

Route gọi tới: `GET /api/v1/admin/stats [admin]`

</details>

<details><summary><b>dòng 132</b> — <code>Repository.count</code> — <b>[VỪA]</b> đếm cả bảng 1003 dòng cho phân trang <i>(1 lượt, 0.38ms)</i></summary>

```sql
SELECT COUNT(1) AS `cnt` FROM `orders` `Order` WHERE `Order`.`deleted_at` IS NULL
```

EXPLAIN: `type=ALL` · `key=∅` · `rows=1003` · `Using where` · chạy thật **0.38ms**

Route gọi tới: `GET /api/v1/admin/stats [admin]`

</details>

<details><summary><b>dòng 137</b> — <code>QueryBuilder.getRawOne</code> — <b>[CAO]</b> quét toàn bảng 1003 dòng, không dùng index <i>(1 lượt, 0.44ms)</i></summary>

```sql
SELECT COALESCE(SUM(`order`.`final_amount`), 0) AS `total` FROM `orders` `order` WHERE ( `order`.`status` = ? ) AND ( `order`.`deleted_at` IS NULL )
```

EXPLAIN: `type=ALL` · `key=∅` · `rows=1003` · `Using where` · chạy thật **0.44ms**

Route gọi tới: `GET /api/v1/admin/stats [admin]`

</details>

<details><summary><b>dòng 140</b> — <code>Repository.count</code> — <b>[VỪA]</b> đếm cả bảng 1003 dòng cho phân trang <i>(1 lượt, 0.38ms)</i></summary>

```sql
SELECT COUNT(1) AS `cnt` FROM `orders` `Order` WHERE ( ((`Order`.`status` = ?)) ) AND ( `Order`.`deleted_at` IS NULL )
```

EXPLAIN: `type=ALL` · `key=∅` · `rows=1003` · `Using where` · chạy thật **0.38ms**

Route gọi tới: `GET /api/v1/admin/stats [admin]`

</details>

<details><summary><b>dòng 156</b> — <code>Repository.find</code> <i>(1 lượt, 0.25ms)</i></summary>

```sql
SELECT `Setting`.`id` AS `Setting_id`, `Setting`.`key` AS `Setting_key`, `Setting`.`value` AS `Setting_value`, `Setting`.`created_at` AS `Setting_created_at`, `Setting`.`updated_at` AS `Setting_updated_at` FROM `settings` `Setting`
```

EXPLAIN: `type=ALL` · `key=∅` · `rows=1` · chạy thật **0.25ms**

Route gọi tới: `GET /api/v1/admin/settings [admin]`

</details>

<details><summary><b>dòng 180</b> — <code>Repository.findAndCount</code> — <b>[VỪA]</b> TypeORM dựng bảng dẫn xuất rồi DISTINCT trên 317 dòng; sắp xếp ngoài index (filesort); phải dựng bảng tạm <i>(1 lượt, 0.69ms)</i></summary>

```sql
SELECT DISTINCT `distinctAlias`.`Withdrawal_id` AS `ids_Withdrawal_id`, `distinctAlias`.`Withdrawal_created_at` FROM (SELECT `Withdrawal`.`id` AS `Withdrawal_id`, `Withdrawal`.`amount` AS `Withdrawal_amount`, `Withdrawal`.`bank_name` AS `Withdrawal_bank_name`, `Withdrawal`.`bank_account` AS `Withdrawal_bank_account`, `Withdrawal`.`bank_holder` AS `Withdrawal_bank_holder`, `Withdrawal`.`status` AS `Withdrawal_status`, `Withdrawal`.`note` AS `Withdrawal_note`, `Withdrawal`.`processed_at` AS `Withdrawal_processed_at`, `Withdrawal`.`created_at` AS `Withdrawal_created_at`, `Withdrawal`.`updated_at` AS `Withdrawal_updated_at`, `Withdrawal`.`user_id` AS `Withdrawal_user_id`, `Withdrawal`.`approved_by` AS `Withdrawal_approved_by`, `Withdrawal__Withdrawal_user`.`id` AS `Withdrawal__Withdrawal_user_id`, `Withdrawal__Withdrawal_user`.`full_name` AS `Withdrawal__Withdrawal_user_full_name`, `Withdraw …(cắt bớt)
```

EXPLAIN: `type=ALL` · `key=∅` · `rows=317` · `Using temporary; Using filesort` · chạy thật **0.69ms**

Route gọi tới: `GET /api/v1/admin/withdrawals [admin]`

</details>

<details><summary><b>dòng 180</b> — <code>Repository.findAndCount</code> <i>(1 lượt, 0.76ms)</i></summary>

```sql
SELECT `Withdrawal`.`id` AS `Withdrawal_id`, `Withdrawal`.`amount` AS `Withdrawal_amount`, `Withdrawal`.`bank_name` AS `Withdrawal_bank_name`, `Withdrawal`.`bank_account` AS `Withdrawal_bank_account`, `Withdrawal`.`bank_holder` AS `Withdrawal_bank_holder`, `Withdrawal`.`status` AS `Withdrawal_status`, `Withdrawal`.`note` AS `Withdrawal_note`, `Withdrawal`.`processed_at` AS `Withdrawal_processed_at`, `Withdrawal`.`created_at` AS `Withdrawal_created_at`, `Withdrawal`.`updated_at` AS `Withdrawal_updated_at`, `Withdrawal`.`user_id` AS `Withdrawal_user_id`, `Withdrawal`.`approved_by` AS `Withdrawal_approved_by`, `Withdrawal__Withdrawal_user`.`id` AS `Withdrawal__Withdrawal_user_id`, `Withdrawal__Withdrawal_user`.`full_name` AS `Withdrawal__Withdrawal_user_full_name`, `Withdrawal__Withdrawal_user`.`email` AS `Withdrawal__Withdrawal_user_email`, `Withdrawal__Withdrawal_user`.`phone_number` AS ` …(cắt bớt)
```

EXPLAIN: `type=range` · `key=PRIMARY` · `rows=20` · `Using where; Using filesort` · chạy thật **0.76ms**

Route gọi tới: `GET /api/v1/admin/withdrawals [admin]`

</details>

<details><summary><b>dòng 180</b> — <code>Repository.findAndCount</code> — <b>[VỪA]</b> đếm cả bảng 317 dòng cho phân trang <i>(1 lượt, 0.51ms)</i></summary>

```sql
SELECT COUNT(DISTINCT `Withdrawal`.`id`) AS `cnt` FROM `withdrawals` `Withdrawal` LEFT JOIN `users` `Withdrawal__Withdrawal_user` ON `Withdrawal__Withdrawal_user`.`id`=`Withdrawal`.`user_id` AND (`Withdrawal__Withdrawal_user`.`deleted_at` IS NULL) LEFT JOIN `users` `Withdrawal__Withdrawal_approved_by` ON `Withdrawal__Withdrawal_approved_by`.`id`=`Withdrawal`.`approved_by` AND (`Withdrawal__Withdrawal_approved_by`.`deleted_at` IS NULL)
```

EXPLAIN: `type=ALL` · `key=∅` · `rows=317` · chạy thật **0.51ms**

Route gọi tới: `GET /api/v1/admin/withdrawals [admin]`

</details>

### `src/ops/settings/settings.service.ts`

3 câu SQL khác nhau · 4 lượt chạy

<details><summary><b>dòng 16</b> — <code>Repository.find</code> <i>(1 lượt, 0.28ms)</i></summary>

```sql
SELECT `Setting`.`id` AS `Setting_id`, `Setting`.`key` AS `Setting_key`, `Setting`.`value` AS `Setting_value`, `Setting`.`created_at` AS `Setting_created_at`, `Setting`.`updated_at` AS `Setting_updated_at` FROM `settings` `Setting`
```

EXPLAIN: `type=ALL` · `key=∅` · `rows=1` · chạy thật **0.28ms**

Route gọi tới: `GET /api/v1/settings [admin]`

</details>

<details><summary><b>dòng 31</b> — <code>Repository.find</code> <i>(1 lượt, 0.28ms)</i></summary>

```sql
SELECT `Setting`.`id` AS `Setting_id`, `Setting`.`key` AS `Setting_key`, `Setting`.`value` AS `Setting_value`, `Setting`.`created_at` AS `Setting_created_at`, `Setting`.`updated_at` AS `Setting_updated_at` FROM `settings` `Setting` WHERE ((((`Setting`.`key` = ?))) OR (((`Setting`.`key` = ?))) OR (((`Setting`.`key` = ?))) OR (((`Setting`.`key` = ?))))
```

EXPLAIN: `type=range` · `key=IDX_c8639b7626fa94ba8265628f21` · `rows=4` · `Using index condition` · chạy thật **0.28ms**

Route gọi tới: `GET /api/v1/settings/public [buyer]`

</details>

<details><summary><b>dòng 47</b> — <code>Repository.findOne</code> <i>(2 lượt, 0.37ms)</i></summary>

```sql
SELECT `Setting`.`id` AS `Setting_id`, `Setting`.`key` AS `Setting_key`, `Setting`.`value` AS `Setting_value`, `Setting`.`created_at` AS `Setting_created_at`, `Setting`.`updated_at` AS `Setting_updated_at` FROM `settings` `Setting` WHERE ((`Setting`.`key` = ?)) LIMIT 1
```

EXPLAIN: `type=?` · `key=∅` · `rows=0` · `no matching row in const table` · chạy thật **0.37ms**

Route gọi tới: `GET / [buyer]`, `GET /api/v1/admin/stats [admin]`

</details>

### `src/ordering/carts/cart.service.ts`

2 câu SQL khác nhau · 4 lượt chạy

<details><summary><b>dòng 44</b> — <code>Repository.findAndCount</code> <i>(1 lượt, 0.41ms)</i></summary>

```sql
SELECT `Cart`.`id` AS `Cart_id`, `Cart`.`quantity` AS `Cart_quantity`, `Cart`.`created_at` AS `Cart_created_at`, `Cart`.`updated_at` AS `Cart_updated_at`, `Cart`.`user_id` AS `Cart_user_id`, `Cart`.`product_id` AS `Cart_product_id`, `Cart__Cart_product`.`id` AS `Cart__Cart_product_id`, `Cart__Cart_product`.`name` AS `Cart__Cart_product_name`, `Cart__Cart_product`.`slug` AS `Cart__Cart_product_slug`, `Cart__Cart_product`.`description` AS `Cart__Cart_product_description`, `Cart__Cart_product`.`price` AS `Cart__Cart_product_price`, `Cart__Cart_product`.`currency` AS `Cart__Cart_product_currency`, `Cart__Cart_product`.`stock` AS `Cart__Cart_product_stock`, `Cart__Cart_product`.`image` AS `Cart__Cart_product_image`, `Cart__Cart_product`.`brand` AS `Cart__Cart_product_brand`, `Cart__Cart_product`.`spec` AS `Cart__Cart_product_spec`, `Cart__Cart_product`.`images` AS `Cart__Cart_product_images`, …(cắt bớt)
```

EXPLAIN: `type=const` · `key=PRIMARY` · `rows=1` · chạy thật **0.41ms**

Route gọi tới: `GET /api/v1/cart [buyer]`

</details>

<details><summary><b>dòng 61</b> — <code>Repository.findOne</code> <i>(3 lượt, 0.37ms)</i></summary>

```sql
SELECT DISTINCT `distinctAlias`.`Cart_id` AS `ids_Cart_id` FROM (SELECT `Cart`.`id` AS `Cart_id`, `Cart`.`quantity` AS `Cart_quantity`, `Cart`.`created_at` AS `Cart_created_at`, `Cart`.`updated_at` AS `Cart_updated_at`, `Cart`.`user_id` AS `Cart_user_id`, `Cart`.`product_id` AS `Cart_product_id`, `Cart__Cart_user`.`id` AS `Cart__Cart_user_id`, `Cart__Cart_user`.`full_name` AS `Cart__Cart_user_full_name`, `Cart__Cart_user`.`email` AS `Cart__Cart_user_email`, `Cart__Cart_user`.`phone_number` AS `Cart__Cart_user_phone_number`, `Cart__Cart_user`.`role` AS `Cart__Cart_user_role`, `Cart__Cart_user`.`avatar` AS `Cart__Cart_user_avatar`, `Cart__Cart_user`.`email_verified` AS `Cart__Cart_user_email_verified`, `Cart__Cart_user`.`is_locked` AS `Cart__Cart_user_is_locked`, `Cart__Cart_user`.`last_seen` AS `Cart__Cart_user_last_seen`, `Cart__Cart_user`.`gender` AS `Cart__Cart_user_gender`, `Cart__Car …(cắt bớt)
```

EXPLAIN: `type=?` · `key=∅` · `rows=0` · `no matching row in const table` · chạy thật **0.37ms**

Route gọi tới: `GET /api/v1/cart/{id} [buyer]`, `GET /api/v1/cart/{id} [seller]`, `GET /api/v1/cart/{id} [admin]`

</details>

### `src/ordering/orders/orders.service.ts`

10 câu SQL khác nhau · 10 lượt chạy · **2 mức CAO** · 3 mức VỪA

<details><summary><b>dòng 73</b> — <code>Repository.count</code> <i>(1 lượt, 0.28ms)</i></summary>

```sql
SELECT COUNT(1) AS `cnt` FROM `users` `User` WHERE `User`.`deleted_at` IS NULL
```

EXPLAIN: `type=ALL` · `key=∅` · `rows=63` · `Using where` · chạy thật **0.28ms**

Route gọi tới: `GET /api/v1/orders/stats [admin]`

</details>

<details><summary><b>dòng 74</b> — <code>Repository.count</code> — <b>[VỪA]</b> đếm cả bảng 2011 dòng cho phân trang <i>(1 lượt, 0.62ms)</i></summary>

```sql
SELECT COUNT(1) AS `cnt` FROM `products` `Product` WHERE `Product`.`deleted_at` IS NULL
```

EXPLAIN: `type=ALL` · `key=∅` · `rows=2011` · `Using where` · chạy thật **0.62ms**

Route gọi tới: `GET /api/v1/orders/stats [admin]`

</details>

<details><summary><b>dòng 75</b> — <code>Repository.count</code> — <b>[VỪA]</b> đếm cả bảng 1003 dòng cho phân trang <i>(1 lượt, 0.57ms)</i></summary>

```sql
SELECT COUNT(1) AS `cnt` FROM `orders` `Order` WHERE `Order`.`deleted_at` IS NULL
```

EXPLAIN: `type=ALL` · `key=∅` · `rows=1003` · `Using where` · chạy thật **0.57ms**

Route gọi tới: `GET /api/v1/orders/stats [admin]`

</details>

<details><summary><b>dòng 81</b> — <code>QueryBuilder.getRawOne</code> — <b>[CAO]</b> quét toàn bảng 1003 dòng, không dùng index <i>(1 lượt, 0.68ms)</i></summary>

```sql
SELECT COALESCE(SUM(`order`.`final_amount`), 0) AS `total` FROM `orders` `order` WHERE ( `order`.`status` != ? ) AND ( `order`.`deleted_at` IS NULL )
```

EXPLAIN: `type=ALL` · `key=∅` · `rows=1003` · `Using where` · chạy thật **0.68ms**

Route gọi tới: `GET /api/v1/orders/stats [admin]`

</details>

<details><summary><b>dòng 403</b> — <code>QueryBuilder.getCount</code> — <b>[VỪA]</b> đếm cả bảng 1003 dòng cho phân trang <i>(1 lượt, 0.51ms)</i></summary>

```sql
SELECT COUNT(1) AS `cnt` FROM `orders` `order` WHERE ( `order`.`user_id` = ? ) AND ( `order`.`deleted_at` IS NULL )
```

EXPLAIN: `type=ALL` · `key=∅` · `rows=1003` · `Using where` · chạy thật **0.51ms**

Route gọi tới: `GET /api/v1/orders [buyer]`

</details>

<details><summary><b>dòng 441</b> — <code>QueryBuilder.getRawMany</code> — <b>[CAO]</b>  <i>(1 lượt, 0.33ms)</i></summary>

```sql
SELECT `order`.`id` AS `id`, DATE_FORMAT(`order`.`created_at`, '%Y-%m-%d %H:%i:%s.%f') AS `cts` FROM `orders` `order` WHERE ( `order`.`user_id` = ? ) AND ( `order`.`deleted_at` IS NULL ) ORDER BY `order`.`created_at` DESC, `order`.`id` DESC LIMIT 10 OFFSET 0
```

EXPLAIN: `type=range` · `key=idx_user_created` · `rows=1003` · `Using index condition; Using where; Backward index scan` · chạy thật **0.33ms**

Route gọi tới: `GET /api/v1/orders [buyer]`

</details>

<details><summary><b>dòng 447</b> — <code>Repository.find</code> <i>(1 lượt, 1.19ms)</i></summary>

```sql
SELECT `Order`.`id` AS `Order_id`, `Order`.`order_code` AS `Order_order_code`, `Order`.`total_amount` AS `Order_total_amount`, `Order`.`shipping_fee` AS `Order_shipping_fee`, `Order`.`discount_amount` AS `Order_discount_amount`, `Order`.`final_amount` AS `Order_final_amount`, `Order`.`currency` AS `Order_currency`, `Order`.`status` AS `Order_status`, `Order`.`payment_method` AS `Order_payment_method`, `Order`.`is_paid` AS `Order_is_paid`, `Order`.`paid_at` AS `Order_paid_at`, `Order`.`receiver_name` AS `Order_receiver_name`, `Order`.`receiver_phone` AS `Order_receiver_phone`, `Order`.`shipping_address` AS `Order_shipping_address`, `Order`.`province` AS `Order_province`, `Order`.`district` AS `Order_district`, `Order`.`ghn_district_id` AS `Order_ghn_district_id`, `Order`.`ghn_ward_code` AS `Order_ghn_ward_code`, `Order`.`note` AS `Order_note`, `Order`.`tracking_code` AS `Order_tracking_co …(cắt bớt)
```

EXPLAIN: `type=range` · `key=PRIMARY` · `rows=10` · `Using where; Using filesort` · chạy thật **1.19ms**

Route gọi tới: `GET /api/v1/orders [buyer]`

</details>

<details><summary><b>dòng 482</b> — <code>Repository.findOne</code> <i>(1 lượt, 0.52ms)</i></summary>

```sql
SELECT DISTINCT `distinctAlias`.`Order_id` AS `ids_Order_id` FROM (SELECT `Order`.`id` AS `Order_id`, `Order`.`order_code` AS `Order_order_code`, `Order`.`total_amount` AS `Order_total_amount`, `Order`.`shipping_fee` AS `Order_shipping_fee`, `Order`.`discount_amount` AS `Order_discount_amount`, `Order`.`final_amount` AS `Order_final_amount`, `Order`.`currency` AS `Order_currency`, `Order`.`status` AS `Order_status`, `Order`.`payment_method` AS `Order_payment_method`, `Order`.`is_paid` AS `Order_is_paid`, `Order`.`paid_at` AS `Order_paid_at`, `Order`.`receiver_name` AS `Order_receiver_name`, `Order`.`receiver_phone` AS `Order_receiver_phone`, `Order`.`shipping_address` AS `Order_shipping_address`, `Order`.`province` AS `Order_province`, `Order`.`district` AS `Order_district`, `Order`.`ghn_district_id` AS `Order_ghn_district_id`, `Order`.`ghn_ward_code` AS `Order_ghn_ward_code`, `Order`.`n …(cắt bớt)
```

EXPLAIN: `type=const` · `key=PRIMARY` · `rows=1` · `Using temporary` · chạy thật **0.52ms**

Route gọi tới: `GET /api/v1/orders/{id} [buyer]`

</details>

<details><summary><b>dòng 482</b> — <code>Repository.findOne</code> <i>(1 lượt, 1.02ms)</i></summary>

```sql
SELECT `Order`.`id` AS `Order_id`, `Order`.`order_code` AS `Order_order_code`, `Order`.`total_amount` AS `Order_total_amount`, `Order`.`shipping_fee` AS `Order_shipping_fee`, `Order`.`discount_amount` AS `Order_discount_amount`, `Order`.`final_amount` AS `Order_final_amount`, `Order`.`currency` AS `Order_currency`, `Order`.`status` AS `Order_status`, `Order`.`payment_method` AS `Order_payment_method`, `Order`.`is_paid` AS `Order_is_paid`, `Order`.`paid_at` AS `Order_paid_at`, `Order`.`receiver_name` AS `Order_receiver_name`, `Order`.`receiver_phone` AS `Order_receiver_phone`, `Order`.`shipping_address` AS `Order_shipping_address`, `Order`.`province` AS `Order_province`, `Order`.`district` AS `Order_district`, `Order`.`ghn_district_id` AS `Order_ghn_district_id`, `Order`.`ghn_ward_code` AS `Order_ghn_ward_code`, `Order`.`note` AS `Order_note`, `Order`.`tracking_code` AS `Order_tracking_co …(cắt bớt)
```

EXPLAIN: `type=const` · `key=PRIMARY` · `rows=1` · chạy thật **1.02ms**

Route gọi tới: `GET /api/v1/orders/{id} [buyer]`

</details>

<details><summary><b>dòng 494</b> — <code>Repository.find</code> <i>(1 lượt, 0.55ms)</i></summary>

```sql
SELECT `OrderShipment`.`id` AS `OrderShipment_id`, `OrderShipment`.`tracking_code` AS `OrderShipment_tracking_code`, `OrderShipment`.`cod_amount` AS `OrderShipment_cod_amount`, `OrderShipment`.`status` AS `OrderShipment_status`, `OrderShipment`.`error` AS `OrderShipment_error`, `OrderShipment`.`delivered_at` AS `OrderShipment_delivered_at`, `OrderShipment`.`received_at` AS `OrderShipment_received_at`, `OrderShipment`.`auto_received` AS `OrderShipment_auto_received`, `OrderShipment`.`created_at` AS `OrderShipment_created_at`, `OrderShipment`.`updated_at` AS `OrderShipment_updated_at`, `OrderShipment`.`order_id` AS `OrderShipment_order_id`, `OrderShipment`.`seller_id` AS `OrderShipment_seller_id`, `OrderShipment__OrderShipment_seller`.`id` AS `OrderShipment__OrderShipment_seller_id`, `OrderShipment__OrderShipment_seller`.`full_name` AS `OrderShipment__OrderShipment_seller_full_name`, `Orde …(cắt bớt)
```

EXPLAIN: `type=const` · `key=PRIMARY` · `rows=1` · chạy thật **0.55ms**

Route gọi tới: `GET /api/v1/orders/{id} [buyer]`

</details>

---

## Chưa phủ được

Những route trả về lỗi nên không sinh (hoặc sinh thiếu) truy vấn. Muốn
phủ nốt thì phải đổ thêm dữ liệu cho đúng vai, hoặc bắn cả route POST.

- `GET /api/v1/cart/{id}` — mọi vai đều trả HTTP 404
- `GET /sitemap-products-{lo}.xml` — mọi vai đều trả HTTP 404
