-- Sinh dữ liệu cỡ 1 TRIỆU dòng mỗi bảng nóng, hoàn toàn bằng SQL (INSERT ... SELECT).
--
-- VÌ SAO KHÔNG DÙNG seed-bulk.ts. Script đó đẩy từng gói 1.000 dòng từ Node qua
-- mạng: mỗi dòng đi một vòng tham số hoá + JSON, và phải giữ một tiến trình Node
-- chạy hàng chục phút. Ở đây MySQL tự nhân dòng từ một bảng số `_so`, Node không
-- tham gia; mỗi câu chèn 100.000 dòng rồi tự commit, nên undo log không phình
-- quá một lô (MySQL test trong WSL, MySQL prod chỉ có 1 GB).
--
-- Tiền đề: database đã `migration:run` và `npm run seed` (9 danh mục, admin,
-- buyer@zoldify.com...). Dữ liệu sinh ra dùng id CỐ ĐỊNH từ 100000 trở lên, nên
-- không đoán AUTO_INCREMENT và không đụng dòng của seed nền.
--
-- KHÔNG đụng nhóm bảng tiền (ledger_*, wallets, escrows, payments): sổ cái kép
-- có bất biến SUM(amount) = 0 mà check:core kiểm, và job tự xác nhận / huỷ quá
-- hạn chạy đúng khi đơn không có ký quỹ (giải ngân theo người bán là no-op).
--
-- Chạy (WSL):
--   docker exec -i zoldify-test-mysql mysql --default-character-set=utf8mb4 \
--     -uroot -ptestpw <db> < scripts/seed-1m.sql
--
-- Quy mô (id = 100000 + n):
--   users          1.000.000  (n < 5.000 là người bán; n = 0 bán nhiều nhất,
--                              n = 5.000 là người mua "nặng")
--   shops              5.000
--   products       1.000.000  (9 danh mục; người bán 100000 giữ 1%)
--   orders         1.000.000  + order_items 1.300.000 + order_shipments cho
--                              đơn đang giao / đã giao
--   reviews        1.000.000  (sản phẩm 100005 có ~9.950 đánh giá)
--   notifications  1.000.000  (trải một năm: phân nửa quá 180 ngày)
--   conversations     50.000 + messages 1.000.000 (20 tin mỗi hội thoại)
--   follows          500.000, carts 300.000
--
-- Người dùng sinh ra đăng nhập bằng mật khẩu của buyer@zoldify.com (chép hash).

SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION';
SET SESSION unique_checks = 0;
SET @t0 = NOW(6);

-- ─── Bảng số 0..999.999 ───────────────────────────────────────────────────────
DROP TABLE IF EXISTS _so;
CREATE TABLE _so (n INT NOT NULL PRIMARY KEY) ENGINE=InnoDB;
INSERT INTO _so (n)
SELECT a.d + b.d * 10 + c.d * 100 + d.d * 1000 + e.d * 10000 + f.d * 100000
  FROM (SELECT 0 d UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
        UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) a,
       (SELECT 0 d UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
        UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) b,
       (SELECT 0 d UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
        UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) c,
       (SELECT 0 d UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
        UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) d,
       (SELECT 0 d UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
        UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) e,
       (SELECT 0 d UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
        UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) f;

-- Danh mục đánh số 0..8 theo id, để chia đều sản phẩm.
DROP TABLE IF EXISTS _dm;
CREATE TABLE _dm (k INT NOT NULL PRIMARY KEY, id INT NOT NULL) ENGINE=InnoDB;
INSERT INTO _dm (k, id)
SELECT ROW_NUMBER() OVER (ORDER BY id) - 1, id FROM categories WHERE deleted_at IS NULL;
SET @so_dm = (SELECT COUNT(*) FROM _dm);

SET @hash = (SELECT password FROM users WHERE email = 'buyer@zoldify.com');
SET @hash = COALESCE(@hash, (SELECT password FROM users ORDER BY id LIMIT 1));

DROP PROCEDURE IF EXISTS _seed_1m;
DELIMITER //
CREATE PROCEDURE _seed_1m()
BEGIN
  DECLARE a INT;
  DECLARE LO INT DEFAULT 100000;

  -- ① USERS ──────────────────────────────────────────────────────────────────
  SET a = 0;
  WHILE a < 1000000 DO
    INSERT INTO users (id, full_name, email, password, role, email_verified, created_at)
    SELECT 100000 + n,
           CONCAT(ELT(1 + n % 8, 'Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Vũ', 'Đặng', 'Bùi'), ' ',
                  ELT(1 + (n DIV 8) % 8, 'Văn', 'Thị', 'Minh', 'Ngọc', 'Quốc', 'Thu', 'Gia', 'Hữu'), ' ', n),
           CONCAT('u1m', n, '@zoldify.test'),
           @hash,
           IF(n < 5000, 'seller', 'buyer'),
           1,
           NOW(6) - INTERVAL (1000000 - n) * 31 SECOND
      FROM _so WHERE n >= a AND n < a + LO;
    SET a = a + LO;
  END WHILE;
  SELECT 'users', TIMESTAMPDIFF(SECOND, @t0, NOW(6)) AS giay;

  INSERT INTO shops (id, name, slug, description, status, user_id)
  SELECT 100000 + n, CONCAT('Shop 1M ', n), CONCAT('shop-1m-', n), 'Cửa hàng sinh cho bài đo 1 triệu dòng', 'active', 100000 + n
    FROM _so WHERE n < 5000;

  -- ② PRODUCTS ───────────────────────────────────────────────────────────────
  -- Người bán: 1% số món về người bán 100000 (đường "người bán nặng"), còn lại
  -- chia đều 5.000 người bán. created_at tăng theo id (30 giây một món, ~347
  -- ngày), giống thật: id lớn là hàng mới.
  SET a = 0;
  WHILE a < 1000000 DO
    INSERT INTO products (id, name, slug, description, price, currency, stock, image, brand,
                          `condition`, is_freeship, sold_count, view_count, status,
                          created_at, updated_at, category_id, seller_id, rating_avg, review_count)
    SELECT 100000 + n,
           CONCAT(ELT(1 + n % 12, 'Áo thun', 'Áo khoác', 'Quần jean', 'Giày sneaker', 'Túi xách', 'Đồng hồ',
                      'Điện thoại', 'Tai nghe', 'Bàn phím', 'Nồi chiên', 'Xe đạp', 'Tủ lạnh'), ' ',
                  ELT(1 + (n DIV 12) % 8, 'cao cấp', 'giá rẻ', 'chính hãng', 'mới 99%', 'size L', 'màu đen',
                      'bản giới hạn', 'nhập khẩu'), ' #', n),
           CONCAT('sp-1m-', n),
           CONCAT('Hàng sinh cho bài đo 1 triệu dòng, mã ', n, '. Giao nhanh, đổi trả 7 ngày.'),
           10000 * (2 + (n * 7919) % 500),
           'VND',
           1 + n % 100,
           'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=500&h=500&fit=crop',
           ELT(1 + n % 5, 'Zold', 'Viet', 'Saigon', 'Hanoi', 'Mekong'),
           IF(n % 4 = 0, 'used', 'new'),
           IF(n % 3 = 0, 1, 0),
           (n * 7919) % 2000,
           (n * 104729) % 100000,
           CASE n % 50 WHEN 1 THEN 'draft' WHEN 2 THEN 'sold' WHEN 3 THEN 'pending' ELSE 'active' END,
           NOW(6) - INTERVAL (1000000 - n) * 30 SECOND,
           NOW(6) - INTERVAL (1000000 - n) * 30 SECOND,
           _dm.id,
           IF(n % 100 = 0, 100000, 100000 + n % 5000),
           ROUND(3 + (n % 21) / 10, 2),
           n % 50
      FROM _so JOIN _dm ON _dm.k = _so.n % @so_dm
     WHERE n >= a AND n < a + LO;
    SET a = a + LO;
  END WHILE;
  SELECT 'products', TIMESTAMPDIFF(SECOND, @t0, NOW(6)) AS giay;

  -- ③ ORDERS ─────────────────────────────────────────────────────────────────
  -- 31 giây một đơn (~359 ngày). Đơn trong 48 giờ gần nhất (n >= 994426) đủ
  -- mọi trạng thái đang chạy. Đơn cũ hơn đa số đã giao/huỷ, TRỪ hai nhóm tồn
  -- đọng cố ý cho job huỷ quá hạn: n % 500 = 7 (pending, ~2.000 đơn) và
  -- n % 1000 = 13 (confirmed, ~1.000 đơn), đều COD chưa trả, chưa vận đơn.
  -- Tổng tiền điền sau khi có order_items.
  SET a = 0;
  WHILE a < 1000000 DO
    INSERT INTO orders (id, order_code, total_amount, shipping_fee, final_amount, currency, status,
                        payment_method, is_paid, paid_at, receiver_name, receiver_phone,
                        shipping_address, province, district, tracking_code, created_at, updated_at,
                        user_id, confirmed_at)
    SELECT 100000 + n, CONCAT('ZLD1M', n), 0, 0, 0, 'VND', st,
           pm,
           paid,
           IF(paid = 1, ct + INTERVAL 5 MINUTE, NULL),
           'Nguyễn Văn Mua', '0901234567', '123 Nguyễn Văn Cừ, Quận 5', 'Hồ Chí Minh', 'Quận 5',
           IF(st IN ('shipping', 'delivered'), CONCAT('GHN1M', n), NULL),
           ct, ct,
           IF(n % 500 = 1, 105000, 105000 + (n * 7) % 995000),
           IF(st = 'pending', NULL, ct + INTERVAL 1 HOUR)
      FROM (
        SELECT n, ct, st,
               IF(n % 500 = 7 OR n % 1000 = 13, 'cod', IF(n % 2 = 0, 'cod', 'payos')) AS pm,
               CASE
                 WHEN n % 500 = 7 OR n % 1000 = 13 THEN 0
                 WHEN n % 2 = 0 THEN IF(st = 'delivered', 1, 0)
                 ELSE IF(st IN ('pending', 'cancelled'), 0, 1)
               END AS paid
          FROM (
            SELECT n,
                   NOW(6) - INTERVAL (1000000 - n) * 31 SECOND AS ct,
                   CASE
                     WHEN n >= 994426 THEN
                       CASE WHEN n % 100 < 40 THEN 'pending' WHEN n % 100 < 60 THEN 'confirmed'
                            WHEN n % 100 < 80 THEN 'processing' WHEN n % 100 < 90 THEN 'shipping'
                            ELSE 'delivered' END
                     WHEN n % 500 = 7 THEN 'pending'
                     WHEN n % 1000 = 13 THEN 'confirmed'
                     WHEN n % 100 < 70 THEN 'delivered'
                     WHEN n % 100 < 85 THEN 'cancelled'
                     WHEN n % 100 < 92 THEN 'shipping'
                     WHEN n % 100 < 97 THEN 'processing'
                     ELSE 'delivered'
                   END AS st
              FROM _so WHERE n >= a AND n < a + LO
          ) x
      ) y;
    SET a = a + LO;
  END WHILE;
  SELECT 'orders', TIMESTAMPDIFF(SECOND, @t0, NOW(6)) AS giay;

  -- ④ ORDER_ITEMS: món 1 cho mọi đơn, món 2 cho 30% đơn ───────────────────────
  -- Món 1: sản phẩm (13n) mod 1M; đơn n % 100 = 3 lấy hàng của người bán nặng
  -- (bội của 100). Món 2: n % 10 = 0 lấy sản phẩm kế bên (khác người bán: đơn
  -- nhiều người bán, hai vận đơn), n % 10 IN (1,2) lấy sản phẩm cùng người bán.
  SET a = 0;
  WHILE a < 1000000 DO
    INSERT INTO order_items (order_id, product_id, product_name, product_image, price, quantity, subtotal,
                             created_at, updated_at)
    SELECT 100000 + x.n, p.id, p.name, p.image, p.price, x.q, p.price * x.q, x.ct, x.ct
      FROM (
        SELECT n, 1 + n % 3 AS q, NOW(6) - INTERVAL (1000000 - n) * 31 SECOND AS ct,
               IF(n % 100 = 3, ((n * 13) % 10000) * 100, (n * 13) % 1000000) AS p1
          FROM _so WHERE n >= a AND n < a + LO
      ) x
      JOIN products p ON p.id = 100000 + x.p1;

    INSERT INTO order_items (order_id, product_id, product_name, product_image, price, quantity, subtotal,
                             created_at, updated_at)
    SELECT 100000 + x.n, p.id, p.name, p.image, p.price, 1, p.price, x.ct, x.ct
      FROM (
        SELECT n, NOW(6) - INTERVAL (1000000 - n) * 31 SECOND AS ct,
               IF(n % 10 = 0,
                  (IF(n % 100 = 3, ((n * 13) % 10000) * 100, (n * 13) % 1000000) + 1) % 1000000,
                  (IF(n % 100 = 3, ((n * 13) % 10000) * 100, (n * 13) % 1000000) + 500000) % 1000000) AS p2
          FROM _so WHERE n >= a AND n < a + LO AND n % 10 < 3
      ) x
      JOIN products p ON p.id = 100000 + x.p2;

    UPDATE orders o
      JOIN (SELECT order_id, SUM(subtotal) s FROM order_items
             WHERE order_id >= 100000 + a AND order_id < 100000 + a + LO GROUP BY order_id) t
        ON t.order_id = o.id
       SET o.total_amount = t.s, o.final_amount = t.s, o.updated_at = o.updated_at;
    SET a = a + LO;
  END WHILE;
  SELECT 'order_items', TIMESTAMPDIFF(SECOND, @t0, NOW(6)) AS giay;

  -- ⑤ ORDER_SHIPMENTS: một lô mỗi (đơn, người bán) cho đơn đang giao / đã giao.
  -- shipping  -> lô 'created' (job đồng bộ GHN hỏi các lô này).
  -- delivered -> lô 'received'; riêng n % 1000 = 98 cũ hơn 3 ngày: lô
  --              'delivered' chưa nhận, đơn còn 'shipping' (tồn đọng ~1.000
  --              lô cho job tự xác nhận).
  SET a = 0;
  WHILE a < 1000000 DO
    INSERT INTO order_shipments (order_id, seller_id, tracking_code, cod_amount, status,
                                 created_at, updated_at, delivered_at, received_at, auto_received)
    SELECT o.id, p.seller_id, CONCAT(o.tracking_code, '-', p.seller_id),
           IF(o.payment_method = 'cod', SUM(oi.subtotal), 0),
           CASE
             WHEN o.status = 'shipping' THEN 'created'
             WHEN (o.id - 100000) % 1000 = 98 AND o.created_at < NOW() - INTERVAL 4 DAY THEN 'delivered'
             ELSE 'received'
           END,
           o.created_at + INTERVAL 2 HOUR, o.created_at + INTERVAL 2 HOUR,
           IF(o.status = 'delivered', o.created_at + INTERVAL 2 DAY, NULL),
           IF(o.status = 'delivered' AND NOT ((o.id - 100000) % 1000 = 98 AND o.created_at < NOW() - INTERVAL 4 DAY),
              o.created_at + INTERVAL 3 DAY, NULL),
           0
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      JOIN products p ON p.id = oi.product_id
     WHERE o.id >= 100000 + a AND o.id < 100000 + a + LO
       AND o.status IN ('shipping', 'delivered')
     GROUP BY o.id, p.seller_id;
    SET a = a + LO;
  END WHILE;
  -- Đơn có lô tồn đọng chưa nhận thì đơn vẫn đang giao.
  UPDATE orders o JOIN order_shipments s ON s.order_id = o.id
     SET o.status = 'shipping', o.is_paid = IF(o.payment_method = 'cod', 0, o.is_paid),
         o.paid_at = IF(o.payment_method = 'cod', NULL, o.paid_at), o.updated_at = o.updated_at
   WHERE s.status = 'delivered' AND o.id >= 100000;
  SELECT 'order_shipments', TIMESTAMPDIFF(SECOND, @t0, NOW(6)) AS giay;

  -- ⑥ REVIEWS: cặp (người mua, sản phẩm) không trùng. k % 100 = 0 (k < 995.000)
  -- dồn vào sản phẩm 100005: một trang chi tiết có ~9.950 đánh giá.
  SET a = 0;
  WHILE a < 1000000 DO
    INSERT INTO reviews (rating, comment, created_at, updated_at, user_id, product_id)
    SELECT 1 + n % 5,
           CONCAT(ELT(1 + n % 4, 'Hàng đúng mô tả', 'Giao nhanh, đóng gói kỹ', 'Tạm được', 'Sẽ ủng hộ tiếp'), ' (', n, ')'),
           NOW(6) - INTERVAL (1000000 - n) * 31 SECOND,
           NOW(6) - INTERVAL (1000000 - n) * 31 SECOND,
           105000 + n % 995000,
           IF(n % 100 = 0 AND n < 995000, 100005, 100000 + (n * 7) % 1000000)
      FROM _so WHERE n >= a AND n < a + LO;
    SET a = a + LO;
  END WHILE;
  SELECT 'reviews', TIMESTAMPDIFF(SECOND, @t0, NOW(6)) AS giay;

  -- ⑦ NOTIFICATIONS: trải một năm, 2/3 đã đọc. Người mua nặng 105000 có 5.000.
  SET a = 0;
  WHILE a < 1000000 DO
    INSERT INTO notifications (type, title, content, is_read, created_at, user_id)
    SELECT ELT(1 + n % 6, 'order_status', 'review', 'payment', 'system', 'message', 'new_product'),
           CONCAT('Thông báo số ', n),
           CONCAT('Nội dung thông báo số ', n, ': đơn hàng của bạn có cập nhật mới.'),
           IF(n % 3 < 2, 1, 0),
           NOW(6) - INTERVAL (1000000 - n) * 31 SECOND,
           IF(n % 200 = 0, 105000, IF(n % 10 = 1, 100000 + n % 5000, 105000 + n % 995000))
      FROM _so WHERE n >= a AND n < a + LO;
    SET a = a + LO;
  END WHILE;
  SELECT 'notifications', TIMESTAMPDIFF(SECOND, @t0, NOW(6)) AS giay;

  -- ⑧ CONVERSATIONS 50.000: c < 2.000 của người mua nặng 105000 (với 2.000
  -- người bán khác nhau); 2.000 <= c < 7.000 của người bán nặng 100000.
  INSERT INTO conversations (id, created_at, updated_at, buyer_id, seller_id, product_id)
  SELECT 100000 + n,
         NOW(6) - INTERVAL (50000 - n) * 600 SECOND,
         NOW(6) - INTERVAL (50000 - n) * 600 SECOND,
         CASE WHEN n < 2000 THEN 105000 WHEN n < 7000 THEN 105001 + n ELSE 105000 + (n * 13) % 995000 END,
         CASE WHEN n < 2000 THEN 100001 + n WHEN n < 7000 THEN 100000 ELSE 100000 + n % 5000 END,
         100000 + (n * 37) % 1000000
    FROM _so WHERE n < 50000;

  -- ⑨ MESSAGES 1.000.000: 20 tin mỗi hội thoại, tin chẵn của người mua, lẻ của
  -- người bán; hai tin cuối mỗi hội thoại chưa đọc.
  SET a = 0;
  WHILE a < 1000000 DO
    INSERT INTO messages (content, is_read, created_at, conversation_id, sender_id)
    SELECT CONCAT('Tin nhắn ', x.n DIV 50000, ' của hội thoại ', c.id, ': còn hàng không bạn?'),
           IF(x.n DIV 50000 >= 18, 0, 1),
           c.updated_at - INTERVAL (19 - x.n DIV 50000) MINUTE,
           c.id,
           IF((x.n DIV 50000) % 2 = 0, c.buyer_id, c.seller_id)
      FROM (SELECT n FROM _so WHERE n >= a AND n < a + LO) x
      JOIN conversations c ON c.id = 100000 + x.n % 50000;
    SET a = a + LO;
  END WHILE;
  SELECT 'messages', TIMESTAMPDIFF(SECOND, @t0, NOW(6)) AS giay;

  -- ⑩ FOLLOWS 500.000 (người bán 100000 có 10.000 người theo dõi), CARTS 300.000.
  INSERT INTO follows (follower_id, following_id)
  SELECT 105000 + n, IF(n % 50 = 0, 100000, 100001 + (n * 7) % 4999) FROM _so WHERE n < 500000;
  INSERT INTO carts (quantity, user_id, product_id)
  SELECT 1 + n % 3, 105000 + n, 100000 + (n * 11) % 1000000 FROM _so WHERE n < 300000;
  SELECT 'follows+carts', TIMESTAMPDIFF(SECOND, @t0, NOW(6)) AS giay;
END//
DELIMITER ;

CALL _seed_1m();
DROP PROCEDURE _seed_1m;
DROP TABLE _dm;
DROP TABLE _so;
SET SESSION unique_checks = 1;

ANALYZE TABLE users, products, orders, order_items, order_shipments, reviews, notifications,
              conversations, messages, follows, carts;

SELECT 'XONG', TIMESTAMPDIFF(SECOND, @t0, NOW(6)) AS giay;
