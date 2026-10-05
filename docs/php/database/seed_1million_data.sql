-- =====================================================
-- ZOLDIFY - SCRIPT TẠO 1 TRIỆU DỮ LIỆU TEST
-- Chạy từng phần theo thứ tự do có foreign key constraints
-- =====================================================

-- Tắt FK check để insert nhanh hơn
SET FOREIGN_KEY_CHECKS = 0;
SET UNIQUE_CHECKS = 0;
SET AUTOCOMMIT = 0;
SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO';

-- =====================================================
-- 1. CATEGORIES (100 categories)
-- =====================================================
TRUNCATE TABLE categories;

DELIMITER //
DROP PROCEDURE IF EXISTS seed_categories//
CREATE PROCEDURE seed_categories()
BEGIN
    DECLARE i INT DEFAULT 1;
    DECLARE parent INT DEFAULT NULL;
    
    WHILE i <= 100 DO
        -- Parent categories (1-20), còn lại là subcategories
        IF i <= 20 THEN
            SET parent = NULL;
        ELSE
            SET parent = FLOOR(1 + RAND() * 20);
        END IF;
        
        INSERT INTO categories (id, parent_id, name, description, tag, icon, image, sort_order)
        VALUES (
            i,
            parent,
            CONCAT('Danh mục ', i),
            CONCAT('Mô tả cho danh mục số ', i, '. Đây là danh mục chứa nhiều sản phẩm đa dạng.'),
            CONCAT('tag-', i),
            CONCAT('https://placehold.co/64x64/333/fff?text=', i),
            CONCAT('https://picsum.photos/seed/cat', i, '/400/300'),
            i
        );
        
        SET i = i + 1;
    END WHILE;
END//
DELIMITER ;

CALL seed_categories();
DROP PROCEDURE IF EXISTS seed_categories;
COMMIT;

SELECT 'Categories seeded: 100 records' AS Status;

-- =====================================================
-- 2. USERS (1,000,000 users - 1 triệu)
-- =====================================================
TRUNCATE TABLE users;

DELIMITER //
DROP PROCEDURE IF EXISTS seed_users//
CREATE PROCEDURE seed_users()
BEGIN
    DECLARE i INT DEFAULT 1;
    DECLARE batch_size INT DEFAULT 10000;
    DECLARE total INT DEFAULT 1000000;
    DECLARE role_rand INT;
    DECLARE gender_rand INT;
    
    WHILE i <= total DO
        SET role_rand = FLOOR(1 + RAND() * 100);
        SET gender_rand = FLOOR(1 + RAND() * 3);
        
        INSERT INTO users (
            id, full_name, email, password, phone_number, phone_verified,
            gender, address, role, balance, avatar, email_verified, is_locked, last_seen
        ) VALUES (
            i,
            CONCAT('User ', i, ' ', SUBSTRING(MD5(RAND()), 1, 6)),
            CONCAT('user', i, '@zoldify.test'),
            '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', -- password: 'password'
            CONCAT('09', LPAD(FLOOR(RAND() * 100000000), 8, '0')),
            IF(RAND() > 0.3, 1, 0),
            CASE gender_rand
                WHEN 1 THEN 'male'
                WHEN 2 THEN 'female'
                ELSE 'other'
            END,
            CONCAT('Số ', FLOOR(1 + RAND() * 999), ', Đường ', FLOOR(1 + RAND() * 100), ', Quận ', FLOOR(1 + RAND() * 12), ', TP.HCM'),
            CASE
                WHEN role_rand <= 60 THEN 'buyer'
                WHEN role_rand <= 95 THEN 'seller'
                WHEN role_rand <= 99 THEN 'moderator'
                ELSE 'admin'
            END,
            ROUND(RAND() * 50000000, 2),
            CONCAT('https://i.pravatar.cc/150?u=', i),
            IF(RAND() > 0.2, 1, 0),
            IF(RAND() > 0.95, 1, 0),
            DATE_SUB(NOW(), INTERVAL FLOOR(RAND() * 365) DAY)
        );
        
        -- Commit mỗi batch để tránh lock
        IF i MOD batch_size = 0 THEN
            COMMIT;
            SELECT CONCAT('Users inserted: ', i, '/', total) AS Progress;
        END IF;
        
        SET i = i + 1;
    END WHILE;
    
    COMMIT;
END//
DELIMITER ;

CALL seed_users();
DROP PROCEDURE IF EXISTS seed_users;

SELECT 'Users seeded: 1,000,000 records' AS Status;

-- =====================================================
-- 3. PRODUCTS (1,000,000 products - 1 triệu)
-- =====================================================
TRUNCATE TABLE products;

DELIMITER //
DROP PROCEDURE IF EXISTS seed_products//
CREATE PROCEDURE seed_products()
BEGIN
    DECLARE i INT DEFAULT 1;
    DECLARE batch_size INT DEFAULT 10000;
    DECLARE total INT DEFAULT 1000000;
    DECLARE status_rand INT;
    DECLARE condition_rand INT;
    
    WHILE i <= total DO
        SET status_rand = FLOOR(1 + RAND() * 100);
        SET condition_rand = FLOOR(1 + RAND() * 4);
        
        INSERT INTO products (
            id, user_id, category_id, name, description, price, quantity,
            view_count, image, status, created_at, `condition`
        ) VALUES (
            i,
            FLOOR(1 + RAND() * 1000000), -- Random user từ 1 triệu users
            FLOOR(1 + RAND() * 100),      -- Random category từ 100 categories
            CONCAT(
                ELT(FLOOR(1 + RAND() * 10), 'iPhone', 'Samsung', 'Laptop', 'Áo', 'Quần', 'Giày', 'Túi', 'Đồng hồ', 'Tai nghe', 'Máy ảnh'),
                ' ',
                ELT(FLOOR(1 + RAND() * 5), 'Pro', 'Max', 'Plus', 'Mini', 'Ultra'),
                ' #', i
            ),
            CONCAT(
                'Sản phẩm chất lượng cao số ', i, '. ',
                ELT(FLOOR(1 + RAND() * 5),
                    'Hàng chính hãng 100%. Bảo hành 12 tháng.',
                    'Mới 99%, ít sử dụng. Fullbox phụ kiện.',
                    'Đẹp như mới, không trầy xước.',
                    'Thanh lý giá tốt, còn bảo hành.',
                    'Hàng secondhand chất lượng tốt.'
                )
            ),
            ROUND(50000 + RAND() * 50000000, 0), -- Giá từ 50k đến 50 triệu
            FLOOR(1 + RAND() * 100),              -- Số lượng 1-100
            FLOOR(RAND() * 10000),                -- Lượt xem 0-10000
            CONCAT('https://picsum.photos/seed/prod', i, '/800/800'),
            CASE
                WHEN status_rand <= 80 THEN 'active'
                WHEN status_rand <= 95 THEN 'sold'
                ELSE 'hidden'
            END,
            DATE_SUB(NOW(), INTERVAL FLOOR(RAND() * 730) DAY), -- Random trong 2 năm
            CASE condition_rand
                WHEN 1 THEN 'new'
                WHEN 2 THEN 'like_new'
                WHEN 3 THEN 'good'
                ELSE 'fair'
            END
        );
        
        IF i MOD batch_size = 0 THEN
            COMMIT;
            SELECT CONCAT('Products inserted: ', i, '/', total) AS Progress;
        END IF;
        
        SET i = i + 1;
    END WHILE;
    
    COMMIT;
END//
DELIMITER ;

CALL seed_products();
DROP PROCEDURE IF EXISTS seed_products;

SELECT 'Products seeded: 1,000,000 records' AS Status;

-- =====================================================
-- 4. PRODUCT_IMAGES (3,000,000 images - mỗi product 3 ảnh)
-- =====================================================
TRUNCATE TABLE product_images;

DELIMITER //
DROP PROCEDURE IF EXISTS seed_product_images//
CREATE PROCEDURE seed_product_images()
BEGIN
    DECLARE i INT DEFAULT 1;
    DECLARE batch_size INT DEFAULT 30000;
    DECLARE total INT DEFAULT 1000000;
    DECLARE img_idx INT;
    
    WHILE i <= total DO
        -- Mỗi product có 3 ảnh
        SET img_idx = 1;
        WHILE img_idx <= 3 DO
            INSERT INTO product_images (product_id, image_path, is_primary, sort_order)
            VALUES (
                i,
                CONCAT('https://picsum.photos/seed/p', i, 'i', img_idx, '/800/800'),
                IF(img_idx = 1, 1, 0),
                img_idx
            );
            SET img_idx = img_idx + 1;
        END WHILE;
        
        IF i MOD batch_size = 0 THEN
            COMMIT;
            SELECT CONCAT('Product images for products: ', i, '/', total) AS Progress;
        END IF;
        
        SET i = i + 1;
    END WHILE;
    
    COMMIT;
END//
DELIMITER ;

CALL seed_product_images();
DROP PROCEDURE IF EXISTS seed_product_images;

SELECT 'Product images seeded: 3,000,000 records' AS Status;

-- =====================================================
-- 5. ORDERS (1,000,000 orders - 1 triệu)
-- =====================================================
TRUNCATE TABLE orders;

DELIMITER //
DROP PROCEDURE IF EXISTS seed_orders//
CREATE PROCEDURE seed_orders()
BEGIN
    DECLARE i INT DEFAULT 1;
    DECLARE batch_size INT DEFAULT 10000;
    DECLARE total INT DEFAULT 1000000;
    DECLARE buyer INT;
    DECLARE seller INT;
    DECLARE status_rand INT;
    DECLARE payment_rand INT;
    DECLARE order_total DECIMAL(15,2);
    
    WHILE i <= total DO
        SET buyer = FLOOR(1 + RAND() * 1000000);
        SET seller = FLOOR(1 + RAND() * 1000000);
        -- Đảm bảo buyer != seller
        WHILE seller = buyer DO
            SET seller = FLOOR(1 + RAND() * 1000000);
        END WHILE;
        
        SET status_rand = FLOOR(1 + RAND() * 100);
        SET payment_rand = FLOOR(1 + RAND() * 3);
        SET order_total = ROUND(100000 + RAND() * 10000000, 2);
        
        INSERT INTO orders (
            id, buyer_id, seller_id, total_amount, platform_fee, seller_amount,
            shipping_fee, shipping_note, status, payment_method, payment_status,
            shipping_address, shipping_phone, shipping_name, note, created_at
        ) VALUES (
            i,
            buyer,
            seller,
            order_total,
            ROUND(order_total * 0.05, 2), -- 5% platform fee
            ROUND(order_total * 0.95, 2), -- 95% cho seller
            ROUND(15000 + RAND() * 50000, 0), -- Ship từ 15k-65k
            IF(RAND() > 0.7, CONCAT('Ghi chú giao hàng #', i), NULL),
            CASE
                WHEN status_rand <= 10 THEN 'pending'
                WHEN status_rand <= 15 THEN 'pending_payment'
                WHEN status_rand <= 25 THEN 'paid'
                WHEN status_rand <= 35 THEN 'confirmed'
                WHEN status_rand <= 45 THEN 'shipping'
                WHEN status_rand <= 55 THEN 'received'
                WHEN status_rand <= 85 THEN 'completed'
                WHEN status_rand <= 95 THEN 'cancelled'
                ELSE 'refunded'
            END,
            CASE payment_rand
                WHEN 1 THEN 'cod'
                WHEN 2 THEN 'bank_transfer'
                ELSE 'payos'
            END,
            CASE
                WHEN status_rand <= 15 THEN 'pending'
                WHEN status_rand <= 90 THEN 'paid'
                WHEN status_rand <= 95 THEN 'failed'
                ELSE 'refunded'
            END,
            CONCAT('Số ', FLOOR(1 + RAND() * 999), ', Đường ', FLOOR(1 + RAND() * 100), ', Q.', FLOOR(1 + RAND() * 12), ', TP.HCM'),
            CONCAT('09', LPAD(FLOOR(RAND() * 100000000), 8, '0')),
            CONCAT('Nguyen Van ', CHAR(65 + FLOOR(RAND() * 26))),
            IF(RAND() > 0.5, CONCAT('Gọi trước khi giao. Đơn #', i), NULL),
            DATE_SUB(NOW(), INTERVAL FLOOR(RAND() * 365) DAY)
        );
        
        IF i MOD batch_size = 0 THEN
            COMMIT;
            SELECT CONCAT('Orders inserted: ', i, '/', total) AS Progress;
        END IF;
        
        SET i = i + 1;
    END WHILE;
    
    COMMIT;
END//
DELIMITER ;

CALL seed_orders();
DROP PROCEDURE IF EXISTS seed_orders;

SELECT 'Orders seeded: 1,000,000 records' AS Status;

-- =====================================================
-- 6. ORDER_DETAILS (2,000,000 records - trung bình 2 items/order)
-- =====================================================
TRUNCATE TABLE order_details;

DELIMITER //
DROP PROCEDURE IF EXISTS seed_order_details//
CREATE PROCEDURE seed_order_details()
BEGIN
    DECLARE i INT DEFAULT 1;
    DECLARE batch_size INT DEFAULT 20000;
    DECLARE total INT DEFAULT 1000000;
    DECLARE items_count INT;
    DECLARE j INT;
    
    WHILE i <= total DO
        SET items_count = FLOOR(1 + RAND() * 4); -- 1-4 items per order
        SET j = 1;
        
        WHILE j <= items_count DO
            INSERT INTO order_details (order_id, product_id, quantity, price_at_purchase)
            VALUES (
                i,
                FLOOR(1 + RAND() * 1000000),
                FLOOR(1 + RAND() * 5),
                ROUND(50000 + RAND() * 5000000, 2)
            );
            SET j = j + 1;
        END WHILE;
        
        IF i MOD batch_size = 0 THEN
            COMMIT;
            SELECT CONCAT('Order details for orders: ', i, '/', total) AS Progress;
        END IF;
        
        SET i = i + 1;
    END WHILE;
    
    COMMIT;
END//
DELIMITER ;

CALL seed_order_details();
DROP PROCEDURE IF EXISTS seed_order_details;

SELECT 'Order details seeded: ~2,500,000 records' AS Status;

-- =====================================================
-- 7. REVIEWS (1,000,000 reviews)
-- =====================================================
TRUNCATE TABLE reviews;

DELIMITER //
DROP PROCEDURE IF EXISTS seed_reviews//
CREATE PROCEDURE seed_reviews()
BEGIN
    DECLARE i INT DEFAULT 1;
    DECLARE batch_size INT DEFAULT 10000;
    DECLARE total INT DEFAULT 1000000;
    
    WHILE i <= total DO
        INSERT INTO reviews (id, reviewer_id, product_id, rating, comment, created_at)
        VALUES (
            i,
            FLOOR(1 + RAND() * 1000000),
            FLOOR(1 + RAND() * 1000000),
            FLOOR(1 + RAND() * 5), -- Rating 1-5
            ELT(FLOOR(1 + RAND() * 10),
                'Sản phẩm rất tốt, đúng mô tả!',
                'Giao hàng nhanh, đóng gói cẩn thận.',
                'Chất lượng OK với giá tiền.',
                'Seller thân thiện, sẽ ủng hộ tiếp.',
                'Hàng đẹp, giống hình. 5 sao!',
                'Tạm được, có vài lỗi nhỏ.',
                'Không như mong đợi lắm.',
                'Đã mua nhiều lần, rất hài lòng!',
                'Giá hợp lý, chất lượng tốt.',
                'Shop uy tín, giao hàng đúng hẹn.'
            ),
            DATE_SUB(NOW(), INTERVAL FLOOR(RAND() * 365) DAY)
        );
        
        IF i MOD batch_size = 0 THEN
            COMMIT;
            SELECT CONCAT('Reviews inserted: ', i, '/', total) AS Progress;
        END IF;
        
        SET i = i + 1;
    END WHILE;
    
    COMMIT;
END//
DELIMITER ;

CALL seed_reviews();
DROP PROCEDURE IF EXISTS seed_reviews;

SELECT 'Reviews seeded: 1,000,000 records' AS Status;

-- =====================================================
-- 8. FAVORITES (1,000,000 favorites)
-- =====================================================
TRUNCATE TABLE favorites;

DELIMITER //
DROP PROCEDURE IF EXISTS seed_favorites//
CREATE PROCEDURE seed_favorites()
BEGIN
    DECLARE i INT DEFAULT 1;
    DECLARE batch_size INT DEFAULT 10000;
    DECLARE total INT DEFAULT 1000000;
    
    WHILE i <= total DO
        INSERT IGNORE INTO favorites (id, user_id, product_id, created_at)
        VALUES (
            i,
            FLOOR(1 + RAND() * 1000000),
            FLOOR(1 + RAND() * 1000000),
            DATE_SUB(NOW(), INTERVAL FLOOR(RAND() * 365) DAY)
        );
        
        IF i MOD batch_size = 0 THEN
            COMMIT;
            SELECT CONCAT('Favorites inserted: ', i, '/', total) AS Progress;
        END IF;
        
        SET i = i + 1;
    END WHILE;
    
    COMMIT;
END//
DELIMITER ;

CALL seed_favorites();
DROP PROCEDURE IF EXISTS seed_favorites;

SELECT 'Favorites seeded: 1,000,000 records' AS Status;

-- =====================================================
-- 9. MESSAGES (1,000,000 messages)
-- =====================================================
TRUNCATE TABLE messages;

DELIMITER //
DROP PROCEDURE IF EXISTS seed_messages//
CREATE PROCEDURE seed_messages()
BEGIN
    DECLARE i INT DEFAULT 1;
    DECLARE batch_size INT DEFAULT 10000;
    DECLARE total INT DEFAULT 1000000;
    DECLARE sender INT;
    DECLARE receiver INT;
    
    WHILE i <= total DO
        SET sender = FLOOR(1 + RAND() * 1000000);
        SET receiver = FLOOR(1 + RAND() * 1000000);
        WHILE receiver = sender DO
            SET receiver = FLOOR(1 + RAND() * 1000000);
        END WHILE;
        
        INSERT INTO messages (id, sender_id, receiver_id, content, is_read, has_attachment, created_at)
        VALUES (
            i,
            sender,
            receiver,
            ELT(FLOOR(1 + RAND() * 10),
                'Chào bạn, sản phẩm này còn hàng không?',
                'Giá có thể giảm được không ạ?',
                'Bạn ơi, giao hàng được không?',
                'Mình quan tâm sản phẩm này!',
                'OK, mình sẽ đặt hàng nhé.',
                'Cảm ơn bạn, đã nhận được hàng.',
                'Cho mình hỏi thêm về sản phẩm.',
                'Có size/màu khác không ạ?',
                'Bạn có thể gửi thêm ảnh không?',
                'Đã thanh toán rồi nhé!'
            ),
            IF(RAND() > 0.3, 1, 0),
            IF(RAND() > 0.9, 1, 0),
            DATE_SUB(NOW(), INTERVAL FLOOR(RAND() * 180) DAY)
        );
        
        IF i MOD batch_size = 0 THEN
            COMMIT;
            SELECT CONCAT('Messages inserted: ', i, '/', total) AS Progress;
        END IF;
        
        SET i = i + 1;
    END WHILE;
    
    COMMIT;
END//
DELIMITER ;

CALL seed_messages();
DROP PROCEDURE IF EXISTS seed_messages;

SELECT 'Messages seeded: 1,000,000 records' AS Status;

-- =====================================================
-- 10. NOTIFICATIONS (1,000,000 notifications)
-- =====================================================
TRUNCATE TABLE notifications;

DELIMITER //
DROP PROCEDURE IF EXISTS seed_notifications//
CREATE PROCEDURE seed_notifications()
BEGIN
    DECLARE i INT DEFAULT 1;
    DECLARE batch_size INT DEFAULT 10000;
    DECLARE total INT DEFAULT 1000000;
    
    WHILE i <= total DO
        INSERT INTO notifications (id, user_id, content, is_read, created_at)
        VALUES (
            i,
            FLOOR(1 + RAND() * 1000000),
            ELT(FLOOR(1 + RAND() * 10),
                'Bạn có đơn hàng mới!',
                'Đơn hàng của bạn đã được xác nhận.',
                'Sản phẩm của bạn có người quan tâm.',
                'Có tin nhắn mới từ người mua.',
                'Đơn hàng đang được giao.',
                'Bạn nhận được đánh giá 5 sao!',
                'Thanh toán thành công.',
                'Có người theo dõi shop của bạn.',
                'Sản phẩm được thêm vào yêu thích.',
                'Đơn hàng đã hoàn thành!'
            ),
            IF(RAND() > 0.4, 1, 0),
            DATE_SUB(NOW(), INTERVAL FLOOR(RAND() * 90) DAY)
        );
        
        IF i MOD batch_size = 0 THEN
            COMMIT;
            SELECT CONCAT('Notifications inserted: ', i, '/', total) AS Progress;
        END IF;
        
        SET i = i + 1;
    END WHILE;
    
    COMMIT;
END//
DELIMITER ;

CALL seed_notifications();
DROP PROCEDURE IF EXISTS seed_notifications;

SELECT 'Notifications seeded: 1,000,000 records' AS Status;

-- =====================================================
-- 11. FOLLOWS (1,000,000 follows)
-- =====================================================
TRUNCATE TABLE follows;

DELIMITER //
DROP PROCEDURE IF EXISTS seed_follows//
CREATE PROCEDURE seed_follows()
BEGIN
    DECLARE i INT DEFAULT 1;
    DECLARE batch_size INT DEFAULT 10000;
    DECLARE total INT DEFAULT 1000000;
    DECLARE follower INT;
    DECLARE following INT;
    
    WHILE i <= total DO
        SET follower = FLOOR(1 + RAND() * 1000000);
        SET following = FLOOR(1 + RAND() * 1000000);
        WHILE following = follower DO
            SET following = FLOOR(1 + RAND() * 1000000);
        END WHILE;
        
        INSERT IGNORE INTO follows (id, follower_id, following_id, created_at)
        VALUES (
            i,
            follower,
            following,
            DATE_SUB(NOW(), INTERVAL FLOOR(RAND() * 365) DAY)
        );
        
        IF i MOD batch_size = 0 THEN
            COMMIT;
            SELECT CONCAT('Follows inserted: ', i, '/', total) AS Progress;
        END IF;
        
        SET i = i + 1;
    END WHILE;
    
    COMMIT;
END//
DELIMITER ;

CALL seed_follows();
DROP PROCEDURE IF EXISTS seed_follows;

SELECT 'Follows seeded: 1,000,000 records' AS Status;

-- =====================================================
-- 12. INTERACTIONS (1,000,000 interactions)
-- =====================================================
TRUNCATE TABLE interactions;

DELIMITER //
DROP PROCEDURE IF EXISTS seed_interactions//
CREATE PROCEDURE seed_interactions()
BEGIN
    DECLARE i INT DEFAULT 1;
    DECLARE batch_size INT DEFAULT 10000;
    DECLARE total INT DEFAULT 1000000;
    
    WHILE i <= total DO
        INSERT INTO interactions (id, user_id, product_id, interaction_type, score, created_at)
        VALUES (
            i,
            FLOOR(1 + RAND() * 1000000),
            FLOOR(1 + RAND() * 1000000),
            IF(RAND() > 0.3, 'view', 'click'),
            FLOOR(1 + RAND() * 5),
            DATE_SUB(NOW(), INTERVAL FLOOR(RAND() * 90) DAY)
        );
        
        IF i MOD batch_size = 0 THEN
            COMMIT;
            SELECT CONCAT('Interactions inserted: ', i, '/', total) AS Progress;
        END IF;
        
        SET i = i + 1;
    END WHILE;
    
    COMMIT;
END//
DELIMITER ;

CALL seed_interactions();
DROP PROCEDURE IF EXISTS seed_interactions;

SELECT 'Interactions seeded: 1,000,000 records' AS Status;

-- =====================================================
-- 13. WALLETS (cho tất cả sellers - ~350,000)
-- =====================================================
TRUNCATE TABLE wallets;

INSERT INTO wallets (user_id, balance, pending_balance, total_earned, total_withdrawn, bank_name, bank_account_number, bank_account_name)
SELECT 
    id,
    ROUND(RAND() * 50000000, 2),
    ROUND(RAND() * 10000000, 2),
    ROUND(RAND() * 100000000, 2),
    ROUND(RAND() * 20000000, 2),
    ELT(FLOOR(1 + RAND() * 10), 'Vietcombank', 'Techcombank', 'MB Bank', 'VPBank', 'ACB', 'BIDV', 'Agribank', 'Sacombank', 'TPBank', 'VIB'),
    LPAD(FLOOR(RAND() * 10000000000), 14, '0'),
    full_name
FROM users 
WHERE role IN ('seller', 'admin')
LIMIT 400000;

COMMIT;

SELECT 'Wallets seeded for sellers' AS Status;

-- =====================================================
-- 14. SEARCH_KEYWORDS (100,000 keywords)
-- =====================================================
TRUNCATE TABLE search_keywords;

DELIMITER //
DROP PROCEDURE IF EXISTS seed_search_keywords//
CREATE PROCEDURE seed_search_keywords()
BEGIN
    DECLARE i INT DEFAULT 1;
    DECLARE batch_size INT DEFAULT 5000;
    DECLARE total INT DEFAULT 100000;
    
    WHILE i <= total DO
        INSERT IGNORE INTO search_keywords (id, keyword, search_count)
        VALUES (
            i,
            CONCAT(
                ELT(FLOOR(1 + RAND() * 20), 
                    'iphone', 'samsung', 'laptop', 'áo', 'quần', 'giày', 'túi xách', 'đồng hồ',
                    'tai nghe', 'máy ảnh', 'điện thoại', 'máy tính', 'bàn phím', 'chuột',
                    'loa', 'tivi', 'tủ lạnh', 'máy giặt', 'nồi cơm', 'quạt'
                ),
                ' ',
                ELT(FLOOR(1 + RAND() * 10), 'mới', 'cũ', 'secondhand', 'chính hãng', 'giá rẻ', 'cao cấp', 'mini', 'pro', 'max', ''),
                IF(RAND() > 0.5, CONCAT(' ', i), '')
            ),
            FLOOR(1 + RAND() * 10000)
        );
        
        IF i MOD batch_size = 0 THEN
            COMMIT;
            SELECT CONCAT('Keywords inserted: ', i, '/', total) AS Progress;
        END IF;
        
        SET i = i + 1;
    END WHILE;
    
    COMMIT;
END//
DELIMITER ;

CALL seed_search_keywords();
DROP PROCEDURE IF EXISTS seed_search_keywords;

SELECT 'Search keywords seeded: 100,000 records' AS Status;

-- =====================================================
-- 15. USER_ADDRESSES (1,500,000 addresses - avg 1.5 per user)
-- =====================================================
TRUNCATE TABLE user_addresses;

DELIMITER //
DROP PROCEDURE IF EXISTS seed_user_addresses//
CREATE PROCEDURE seed_user_addresses()
BEGIN
    DECLARE i INT DEFAULT 1;
    DECLARE batch_size INT DEFAULT 15000;
    DECLARE total INT DEFAULT 1000000;
    DECLARE addr_count INT;
    DECLARE j INT;
    DECLARE province VARCHAR(100);
    DECLARE district VARCHAR(100);
    
    WHILE i <= total DO
        SET addr_count = FLOOR(1 + RAND() * 3); -- 1-3 addresses per user
        SET j = 1;
        
        WHILE j <= addr_count DO
            SET province = ELT(FLOOR(1 + RAND() * 10), 
                'TP. Hồ Chí Minh', 'Hà Nội', 'Đà Nẵng', 'Cần Thơ', 'Hải Phòng',
                'Bình Dương', 'Đồng Nai', 'Long An', 'Bà Rịa-Vũng Tàu', 'Khánh Hòa');
            SET district = ELT(FLOOR(1 + RAND() * 10),
                'Quận 1', 'Quận 3', 'Quận 7', 'Quận 10', 'Bình Thạnh',
                'Gò Vấp', 'Tân Bình', 'Phú Nhuận', 'Thủ Đức', 'Quận 12');
            
            INSERT INTO user_addresses (
                user_id, label, recipient_name, phone_number,
                province, district, ward, street_address, full_address,
                is_default
            ) VALUES (
                i,
                ELT(j, 'Nhà riêng', 'Công ty', 'Nhà bạn'),
                CONCAT('Người nhận ', i, '-', j),
                CONCAT('09', LPAD(FLOOR(RAND() * 100000000), 8, '0')),
                province,
                district,
                CONCAT('Phường ', FLOOR(1 + RAND() * 20)),
                CONCAT('Số ', FLOOR(1 + RAND() * 999), ', Đường ', FLOOR(1 + RAND() * 50)),
                CONCAT('Số ', FLOOR(1 + RAND() * 999), ', Đường ', FLOOR(1 + RAND() * 50), ', ', district, ', ', province),
                IF(j = 1, 1, 0)
            );
            SET j = j + 1;
        END WHILE;
        
        IF i MOD batch_size = 0 THEN
            COMMIT;
            SELECT CONCAT('Addresses for users: ', i, '/', total) AS Progress;
        END IF;
        
        SET i = i + 1;
    END WHILE;
    
    COMMIT;
END//
DELIMITER ;

CALL seed_user_addresses();
DROP PROCEDURE IF EXISTS seed_user_addresses;

SELECT 'User addresses seeded: ~2,000,000 records' AS Status;

-- =====================================================
-- HOÀN TẤT - BẬT LẠI CHECKS
-- =====================================================

SET FOREIGN_KEY_CHECKS = 1;
SET UNIQUE_CHECKS = 1;
SET AUTOCOMMIT = 1;
SET SQL_MODE=@OLD_SQL_MODE;

-- =====================================================
-- THỐNG KÊ CUỐI CÙNG
-- =====================================================
SELECT 'SEEDING COMPLETED!' AS Status;
SELECT '===================' AS '';
SELECT 'users' AS `Table`, COUNT(*) AS `Records` FROM users
UNION ALL SELECT 'categories', COUNT(*) FROM categories
UNION ALL SELECT 'products', COUNT(*) FROM products
UNION ALL SELECT 'product_images', COUNT(*) FROM product_images
UNION ALL SELECT 'orders', COUNT(*) FROM orders
UNION ALL SELECT 'order_details', COUNT(*) FROM order_details
UNION ALL SELECT 'reviews', COUNT(*) FROM reviews
UNION ALL SELECT 'favorites', COUNT(*) FROM favorites
UNION ALL SELECT 'messages', COUNT(*) FROM messages
UNION ALL SELECT 'notifications', COUNT(*) FROM notifications
UNION ALL SELECT 'follows', COUNT(*) FROM follows
UNION ALL SELECT 'interactions', COUNT(*) FROM interactions
UNION ALL SELECT 'wallets', COUNT(*) FROM wallets
UNION ALL SELECT 'search_keywords', COUNT(*) FROM search_keywords
UNION ALL SELECT 'user_addresses', COUNT(*) FROM user_addresses;
