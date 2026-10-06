-- Seed đánh giá cho dữ liệu thử tải và demo (lỗi H-01, 06/10).
--
-- Vì sao có file này: app trước đây tự sinh số sao, số đánh giá bằng số ngẫu
-- nhiên theo id sản phẩm (mobile mock.ts), nên bảng `reviews` trên prod có 0
-- dòng. App giờ đọc số thật; không seed thì mọi sản phẩm hiện "Chưa có đánh giá",
-- và bài thử tải không có dữ liệu đánh giá nào để đọc.
--
-- Cách làm: mỗi tài khoản người mua đang hoạt động đánh giá khoảng 2/3 số sản
-- phẩm (trừ sản phẩm của chính mình). Số sao lệch về 4-5 như sàn thật. Mọi giá
-- trị suy ra TẤT ĐỊNH từ (user_id, product_id) bằng MOD, chạy lại cho cùng kết quả.
--
-- Chạy lại an toàn: INSERT IGNORE + UNIQUE idx_user_product (user, product), cặp
-- nào đã có đánh giá (thật hoặc seed) thì bỏ qua, không ghi đè đánh giá thật.
-- order_id để NULL: đây là dữ liệu seed, không gắn với đơn nào. Đánh giá viết
-- qua app vẫn bắt buộc có đơn đã giao (InteractionsService.create).
--
-- Chạy (prod: -p zoldify, thư mục /opt/zoldify-backend):
--   docker compose -p zoldify exec -T mysql sh -c \
--     'mysql --default-character-set=utf8mb4 -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' \
--     < scripts/seed-reviews.sql
-- PHẢI có --default-character-set=utf8mb4, không thì bình luận tiếng Việt lưu sai.

INSERT IGNORE INTO reviews (user_id, product_id, order_id, rating, comment, created_at, updated_at)
SELECT
  u.id,
  p.id,
  NULL,
  CASE
    WHEN MOD(u.id * 7 + p.id * 13, 10) < 6 THEN 5
    WHEN MOD(u.id * 7 + p.id * 13, 10) < 9 THEN 4
    ELSE 3
  END,
  ELT(1 + MOD(u.id * 3 + p.id * 5, 10),
    'Hàng đúng mô tả, đóng gói kỹ.',
    'Giao nhanh, người bán trả lời tin nhắn nhiệt tình.',
    'Dùng được vài hôm thấy ổn, đáng tiền.',
    'Còn mới như hình, không trầy xước gì.',
    'Giá hợp lý so với chất lượng.',
    'Shop gói hàng cẩn thận, giao đúng hẹn.',
    'Có vài vết nhỏ nhưng người bán đã báo trước.',
    'Mua lần hai ở shop này, vẫn ưng.',
    'Hàng ổn, giao hơi chậm một chút.',
    NULL),
  NOW() - INTERVAL MOD(u.id * 11 + p.id * 17, 60) DAY,
  NOW() - INTERVAL MOD(u.id * 11 + p.id * 17, 60) DAY
FROM products p
JOIN users u
  ON u.role = 'buyer'
 AND u.is_locked = 0
 AND u.id <> p.seller_id
WHERE p.deleted_at IS NULL
  AND MOD(u.id + p.id, 3) <> 0;

-- Tính lại điểm giữ sẵn trên products (cùng công thức InteractionsService).
UPDATE products p
LEFT JOIN (
  SELECT product_id, ROUND(AVG(rating), 2) AS a, COUNT(*) AS c
  FROM reviews
  WHERE deleted_at IS NULL
  GROUP BY product_id
) r ON r.product_id = p.id
SET p.rating_avg = COALESCE(r.a, 0), p.review_count = COALESCE(r.c, 0);

SELECT COUNT(*) AS reviews_total FROM reviews WHERE deleted_at IS NULL;
SELECT id, name, rating_avg, review_count FROM products WHERE deleted_at IS NULL ORDER BY id LIMIT 20;
