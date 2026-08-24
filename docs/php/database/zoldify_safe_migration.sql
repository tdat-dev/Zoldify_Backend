/*
 Safe Migration SQL - Không xóa dữ liệu, chỉ thêm nếu chưa có
 
 Source Server Type    : MariaDB 10.11.10
 Date: 25/01/2026
*/

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ============================================================================
-- USERS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `full_name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(150) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `password` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `email`(`email` ASC)
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Add columns if not exists
ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `phone_number` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL;
ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `phone_verified` tinyint(1) NULL DEFAULT 0;
ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `gender` enum('male','female','other') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL;
ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `address` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL;
ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `role` enum('buyer','seller','admin','moderator') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT 'buyer';
ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `balance` decimal(15, 2) NULL DEFAULT 0.00;
ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `avatar` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL;
ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `email_verified` tinyint(1) NULL DEFAULT 0;
ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `email_verification_token` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL;
ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `email_verification_expires_at` datetime NULL DEFAULT NULL;
ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `is_locked` tinyint(1) NULL DEFAULT 0;
ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `password_reset_token` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL;
ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `password_reset_expires_at` datetime NULL DEFAULT NULL;
ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `password_reset_attempts` int NULL DEFAULT 0;
ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `password_reset_locked_until` datetime NULL DEFAULT NULL;
ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `last_seen` datetime NULL DEFAULT NULL;

-- ============================================================================
-- CATEGORIES TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS `categories` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

ALTER TABLE `categories` ADD COLUMN IF NOT EXISTS `parent_id` int NULL DEFAULT NULL;
ALTER TABLE `categories` ADD COLUMN IF NOT EXISTS `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL;
ALTER TABLE `categories` ADD COLUMN IF NOT EXISTS `tag` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL;
ALTER TABLE `categories` ADD COLUMN IF NOT EXISTS `icon` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL;
ALTER TABLE `categories` ADD COLUMN IF NOT EXISTS `image` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL;
ALTER TABLE `categories` ADD COLUMN IF NOT EXISTS `sort_order` int NULL DEFAULT 0;

-- Add foreign key if not exists (wrapped in procedure)
DROP PROCEDURE IF EXISTS add_fk_category_parent;
DELIMITER //
CREATE PROCEDURE add_fk_category_parent()
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.TABLE_CONSTRAINTS 
                   WHERE CONSTRAINT_NAME = 'fk_category_parent' 
                   AND TABLE_NAME = 'categories') THEN
        ALTER TABLE `categories` ADD CONSTRAINT `fk_category_parent` 
        FOREIGN KEY (`parent_id`) REFERENCES `categories` (`id`) ON DELETE CASCADE;
    END IF;
END //
DELIMITER ;
CALL add_fk_category_parent();
DROP PROCEDURE IF EXISTS add_fk_category_parent;

-- ============================================================================
-- PRODUCTS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS `products` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `category_id` int NOT NULL,
  `name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp,
  PRIMARY KEY (`id`),
  INDEX `category_id`(`category_id` ASC)
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

ALTER TABLE `products` ADD COLUMN IF NOT EXISTS `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL;
ALTER TABLE `products` ADD COLUMN IF NOT EXISTS `price` decimal(15, 2) NOT NULL DEFAULT 0.00;
ALTER TABLE `products` ADD COLUMN IF NOT EXISTS `is_freeship` tinyint(1) NULL DEFAULT 0;
ALTER TABLE `products` ADD COLUMN IF NOT EXISTS `quantity` int NOT NULL DEFAULT 0;
ALTER TABLE `products` ADD COLUMN IF NOT EXISTS `view_count` int UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Số lượt xem';
ALTER TABLE `products` ADD COLUMN IF NOT EXISTS `image` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL;
ALTER TABLE `products` ADD COLUMN IF NOT EXISTS `status` enum('active','sold','hidden') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT 'active';
ALTER TABLE `products` ADD COLUMN IF NOT EXISTS `product_condition` enum('new','like_new','good','fair','poor') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT 'good';

-- Add indexes if not exists
DROP PROCEDURE IF EXISTS add_products_indexes;
DELIMITER //
CREATE PROCEDURE add_products_indexes()
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_NAME = 'products' AND INDEX_NAME = 'idx_status_created') THEN
        CREATE INDEX `idx_status_created` ON `products`(`status` ASC, `created_at` DESC);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_NAME = 'products' AND INDEX_NAME = 'idx_status_category') THEN
        CREATE INDEX `idx_status_category` ON `products`(`status` ASC, `category_id` ASC);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_NAME = 'products' AND INDEX_NAME = 'idx_status_price') THEN
        CREATE INDEX `idx_status_price` ON `products`(`status` ASC, `price` ASC);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_NAME = 'products' AND INDEX_NAME = 'idx_quantity') THEN
        CREATE INDEX `idx_quantity` ON `products`(`quantity` ASC);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_NAME = 'products' AND INDEX_NAME = 'idx_user_status') THEN
        CREATE INDEX `idx_user_status` ON `products`(`user_id` ASC, `status` ASC);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_NAME = 'products' AND INDEX_NAME = 'idx_view_count') THEN
        CREATE INDEX `idx_view_count` ON `products`(`view_count` ASC);
    END IF;
END //
DELIMITER ;
CALL add_products_indexes();
DROP PROCEDURE IF EXISTS add_products_indexes;

-- ============================================================================
-- PRODUCT_IMAGES TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS `product_images` (
  `id` int NOT NULL AUTO_INCREMENT,
  `product_id` int NOT NULL,
  `image_path` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Đường dẫn ảnh relative to uploads',
  `created_at` timestamp NULL DEFAULT current_timestamp,
  PRIMARY KEY (`id`),
  INDEX `product_id`(`product_id` ASC)
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

ALTER TABLE `product_images` ADD COLUMN IF NOT EXISTS `is_primary` tinyint(1) NULL DEFAULT 0 COMMENT 'Ảnh chính của sản phẩm';
ALTER TABLE `product_images` ADD COLUMN IF NOT EXISTS `sort_order` int NULL DEFAULT 0 COMMENT 'Thứ tự hiển thị';

-- ============================================================================
-- CARTS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS `carts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `product_id` int NOT NULL,
  `quantity` int NOT NULL DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp,
  `updated_at` timestamp NULL DEFAULT current_timestamp ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `product_id`(`product_id` ASC)
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Add unique index if not exists
DROP PROCEDURE IF EXISTS add_carts_unique_index;
DELIMITER //
CREATE PROCEDURE add_carts_unique_index()
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_NAME = 'carts' AND INDEX_NAME = 'unique_user_product') THEN
        CREATE UNIQUE INDEX `unique_user_product` ON `carts`(`user_id` ASC, `product_id` ASC);
    END IF;
END //
DELIMITER ;
CALL add_carts_unique_index();
DROP PROCEDURE IF EXISTS add_carts_unique_index;

-- ============================================================================
-- ORDERS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS `orders` (
  `id` int NOT NULL AUTO_INCREMENT,
  `buyer_id` int NOT NULL COMMENT 'Người mua',
  `seller_id` int NOT NULL COMMENT 'Người bán',
  `total_amount` decimal(10, 2) NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp,
  PRIMARY KEY (`id`),
  INDEX `buyer_id`(`buyer_id` ASC),
  INDEX `seller_id`(`seller_id` ASC)
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

ALTER TABLE `orders` ADD COLUMN IF NOT EXISTS `platform_fee` decimal(15, 2) NOT NULL DEFAULT 0.00 COMMENT 'Phí sàn (VND)';
ALTER TABLE `orders` ADD COLUMN IF NOT EXISTS `seller_amount` decimal(15, 2) NOT NULL DEFAULT 0.00 COMMENT 'Tiền seller nhận sau phí (VND)';
ALTER TABLE `orders` ADD COLUMN IF NOT EXISTS `shipping_address_id` int NULL DEFAULT NULL;
ALTER TABLE `orders` ADD COLUMN IF NOT EXISTS `shipping_address_snapshot` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL;
ALTER TABLE `orders` ADD COLUMN IF NOT EXISTS `shipping_fee` decimal(10, 2) NULL DEFAULT 0.00;
ALTER TABLE `orders` ADD COLUMN IF NOT EXISTS `shipping_note` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL;
ALTER TABLE `orders` ADD COLUMN IF NOT EXISTS `status` enum('pending','pending_payment','paid','confirmed','shipping','received','completed','cancelled','refunded') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending';
ALTER TABLE `orders` ADD COLUMN IF NOT EXISTS `payment_method` enum('cod','bank_transfer','payos') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT 'cod';
ALTER TABLE `orders` ADD COLUMN IF NOT EXISTS `payment_status` enum('pending','paid','failed','refunded') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT 'pending';
ALTER TABLE `orders` ADD COLUMN IF NOT EXISTS `payos_order_code` bigint UNSIGNED NULL DEFAULT NULL;
ALTER TABLE `orders` ADD COLUMN IF NOT EXISTS `shipping_address` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL COMMENT 'Địa chỉ giao hàng đầy đủ';
ALTER TABLE `orders` ADD COLUMN IF NOT EXISTS `shipping_phone` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT 'Số điện thoại người nhận';
ALTER TABLE `orders` ADD COLUMN IF NOT EXISTS `shipping_name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT 'Tên người nhận hàng';
ALTER TABLE `orders` ADD COLUMN IF NOT EXISTS `note` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL COMMENT 'Ghi chú của người mua';
ALTER TABLE `orders` ADD COLUMN IF NOT EXISTS `payment_link_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL;
ALTER TABLE `orders` ADD COLUMN IF NOT EXISTS `paid_at` timestamp NULL DEFAULT NULL;
ALTER TABLE `orders` ADD COLUMN IF NOT EXISTS `received_at` timestamp NULL DEFAULT NULL;
ALTER TABLE `orders` ADD COLUMN IF NOT EXISTS `escrow_release_at` timestamp NULL DEFAULT NULL;
ALTER TABLE `orders` ADD COLUMN IF NOT EXISTS `completed_at` timestamp NULL DEFAULT NULL;
ALTER TABLE `orders` ADD COLUMN IF NOT EXISTS `trial_days` tinyint UNSIGNED NULL DEFAULT 7;
ALTER TABLE `orders` ADD COLUMN IF NOT EXISTS `cancel_reason` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL;
ALTER TABLE `orders` ADD COLUMN IF NOT EXISTS `ghn_order_code` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT 'Mã vận đơn GHN';
ALTER TABLE `orders` ADD COLUMN IF NOT EXISTS `ghn_sort_code` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT 'Mã phân loại kho GHN';
ALTER TABLE `orders` ADD COLUMN IF NOT EXISTS `ghn_expected_delivery` datetime NULL DEFAULT NULL COMMENT 'Ngày giao dự kiến';
ALTER TABLE `orders` ADD COLUMN IF NOT EXISTS `ghn_shipping_fee` int UNSIGNED NULL DEFAULT 0 COMMENT 'Phí ship GHN';
ALTER TABLE `orders` ADD COLUMN IF NOT EXISTS `ghn_status` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT 'Trạng thái GHN';

-- Add indexes for orders
DROP PROCEDURE IF EXISTS add_orders_indexes;
DELIMITER //
CREATE PROCEDURE add_orders_indexes()
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_NAME = 'orders' AND INDEX_NAME = 'idx_payment_link_id') THEN
        CREATE INDEX `idx_payment_link_id` ON `orders`(`payment_link_id` ASC);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_NAME = 'orders' AND INDEX_NAME = 'idx_escrow_release') THEN
        CREATE INDEX `idx_escrow_release` ON `orders`(`escrow_release_at` ASC);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_NAME = 'orders' AND INDEX_NAME = 'idx_orders_ghn_order_code') THEN
        CREATE INDEX `idx_orders_ghn_order_code` ON `orders`(`ghn_order_code` ASC);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_NAME = 'orders' AND INDEX_NAME = 'idx_shipping_address') THEN
        CREATE INDEX `idx_shipping_address` ON `orders`(`shipping_address_id` ASC);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_NAME = 'orders' AND INDEX_NAME = 'idx_payos_order_code') THEN
        CREATE INDEX `idx_payos_order_code` ON `orders`(`payos_order_code` ASC);
    END IF;
END //
DELIMITER ;
CALL add_orders_indexes();
DROP PROCEDURE IF EXISTS add_orders_indexes;

-- ============================================================================
-- ORDER_DETAILS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS `order_details` (
  `id` int NOT NULL AUTO_INCREMENT,
  `order_id` int NOT NULL,
  `product_id` int NOT NULL,
  `quantity` int NOT NULL,
  `price_at_purchase` decimal(10, 2) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `order_id`(`order_id` ASC),
  INDEX `product_id`(`product_id` ASC)
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- ============================================================================
-- ESCROW_HOLDS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS `escrow_holds` (
  `id` bigint UNSIGNED NOT NULL AUTO_INCREMENT,
  `order_id` int NOT NULL,
  `seller_id` int NOT NULL,
  `amount` decimal(15, 2) NOT NULL COMMENT 'Tổng số tiền giữ',
  `seller_amount` decimal(15, 2) NOT NULL COMMENT 'Số tiền seller nhận (amount - fee)',
  `held_at` timestamp NULL DEFAULT current_timestamp COMMENT 'Thời điểm bắt đầu giữ',
  PRIMARY KEY (`id`),
  UNIQUE INDEX `order_id`(`order_id` ASC),
  INDEX `idx_seller_id`(`seller_id` ASC)
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = 'Quản lý tiền escrow (giữ lại)';

ALTER TABLE `escrow_holds` ADD COLUMN IF NOT EXISTS `platform_fee` decimal(15, 2) NULL DEFAULT 0.00 COMMENT 'Phí sàn (nếu có)';
ALTER TABLE `escrow_holds` ADD COLUMN IF NOT EXISTS `status` enum('holding','released','refunded','disputed') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT 'holding';
ALTER TABLE `escrow_holds` ADD COLUMN IF NOT EXISTS `release_scheduled_at` timestamp NULL DEFAULT NULL COMMENT 'Ngày dự kiến giải ngân';
ALTER TABLE `escrow_holds` ADD COLUMN IF NOT EXISTS `released_at` timestamp NULL DEFAULT NULL COMMENT 'Ngày thực tế giải ngân';
ALTER TABLE `escrow_holds` ADD COLUMN IF NOT EXISTS `release_notes` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL COMMENT 'Ghi chú khi giải ngân/hoàn tiền';

-- Add indexes for escrow_holds
DROP PROCEDURE IF EXISTS add_escrow_indexes;
DELIMITER //
CREATE PROCEDURE add_escrow_indexes()
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_NAME = 'escrow_holds' AND INDEX_NAME = 'idx_status') THEN
        CREATE INDEX `idx_status` ON `escrow_holds`(`status` ASC);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_NAME = 'escrow_holds' AND INDEX_NAME = 'idx_release_scheduled') THEN
        CREATE INDEX `idx_release_scheduled` ON `escrow_holds`(`release_scheduled_at` ASC);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_NAME = 'escrow_holds' AND INDEX_NAME = 'idx_held_at') THEN
        CREATE INDEX `idx_held_at` ON `escrow_holds`(`held_at` ASC);
    END IF;
END //
DELIMITER ;
CALL add_escrow_indexes();
DROP PROCEDURE IF EXISTS add_escrow_indexes;

-- ============================================================================
-- FAVORITES TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS `favorites` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `product_id` int NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp,
  PRIMARY KEY (`id`),
  INDEX `user_id`(`user_id` ASC),
  INDEX `product_id`(`product_id` ASC)
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- ============================================================================
-- FOLLOWS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS `follows` (
  `id` int NOT NULL AUTO_INCREMENT,
  `follower_id` int NOT NULL COMMENT 'User đang theo dõi',
  `following_id` int NOT NULL COMMENT 'User được theo dõi',
  `created_at` timestamp NULL DEFAULT current_timestamp,
  PRIMARY KEY (`id`)
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Add unique index and regular indexes for follows
DROP PROCEDURE IF EXISTS add_follows_indexes;
DELIMITER //
CREATE PROCEDURE add_follows_indexes()
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_NAME = 'follows' AND INDEX_NAME = 'unique_follow') THEN
        CREATE UNIQUE INDEX `unique_follow` ON `follows`(`follower_id` ASC, `following_id` ASC);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_NAME = 'follows' AND INDEX_NAME = 'idx_follower') THEN
        CREATE INDEX `idx_follower` ON `follows`(`follower_id` ASC);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_NAME = 'follows' AND INDEX_NAME = 'idx_following') THEN
        CREATE INDEX `idx_following` ON `follows`(`following_id` ASC);
    END IF;
END //
DELIMITER ;
CALL add_follows_indexes();
DROP PROCEDURE IF EXISTS add_follows_indexes;

-- ============================================================================
-- INTERACTIONS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS `interactions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `product_id` int NOT NULL,
  `interaction_type` enum('view','click') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp,
  PRIMARY KEY (`id`),
  INDEX `user_id`(`user_id` ASC),
  INDEX `product_id`(`product_id` ASC)
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

ALTER TABLE `interactions` ADD COLUMN IF NOT EXISTS `score` int NULL DEFAULT 1;

-- ============================================================================
-- MESSAGES TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS `messages` (
  `id` int NOT NULL AUTO_INCREMENT,
  `sender_id` int NOT NULL,
  `receiver_id` int NOT NULL,
  `content` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp,
  PRIMARY KEY (`id`),
  INDEX `sender_id`(`sender_id` ASC),
  INDEX `receiver_id`(`receiver_id` ASC)
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

ALTER TABLE `messages` ADD COLUMN IF NOT EXISTS `is_read` tinyint(1) NULL DEFAULT 0;
ALTER TABLE `messages` ADD COLUMN IF NOT EXISTS `has_attachment` tinyint(1) NULL DEFAULT 0;

-- ============================================================================
-- MESSAGE_ATTACHMENTS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS `message_attachments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `message_id` int NOT NULL,
  `file_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `file_path` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `file_type` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp,
  PRIMARY KEY (`id`),
  INDEX `idx_message_id`(`message_id` ASC)
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

ALTER TABLE `message_attachments` ADD COLUMN IF NOT EXISTS `file_size` int NOT NULL DEFAULT 0;

-- ============================================================================
-- MIGRATIONS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS `migrations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `filename` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `batch` int NOT NULL DEFAULT 1,
  `executed_at` timestamp NULL DEFAULT current_timestamp,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `filename`(`filename` ASC)
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- ============================================================================
-- NOTIFICATIONS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS `notifications` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `content` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp,
  PRIMARY KEY (`id`),
  INDEX `user_id`(`user_id` ASC)
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

ALTER TABLE `notifications` ADD COLUMN IF NOT EXISTS `is_read` tinyint(1) NULL DEFAULT 0;

-- ============================================================================
-- PAYMENT_TRANSACTIONS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS `payment_transactions` (
  `id` bigint UNSIGNED NOT NULL AUTO_INCREMENT,
  `order_id` int NOT NULL,
  `transaction_type` enum('payment','escrow_hold','escrow_release','refund') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `amount` decimal(15, 2) NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp,
  PRIMARY KEY (`id`),
  INDEX `idx_order_id`(`order_id` ASC)
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = 'Lịch sử giao dịch thanh toán PayOS';

ALTER TABLE `payment_transactions` ADD COLUMN IF NOT EXISTS `payment_link_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT 'ID link thanh toán từ PayOS';
ALTER TABLE `payment_transactions` ADD COLUMN IF NOT EXISTS `payos_transaction_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT 'Mã giao dịch từ PayOS';
ALTER TABLE `payment_transactions` ADD COLUMN IF NOT EXISTS `payos_reference` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT 'Reference number từ ngân hàng';
ALTER TABLE `payment_transactions` ADD COLUMN IF NOT EXISTS `payos_order_code` bigint UNSIGNED NULL DEFAULT NULL COMMENT 'Mã đơn hàng gửi cho PayOS';
ALTER TABLE `payment_transactions` ADD COLUMN IF NOT EXISTS `status` enum('pending','processing','success','failed') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT 'pending';
ALTER TABLE `payment_transactions` ADD COLUMN IF NOT EXISTS `metadata` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL COMMENT 'Dữ liệu raw từ PayOS webhook';
ALTER TABLE `payment_transactions` ADD COLUMN IF NOT EXISTS `updated_at` timestamp NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP;

-- Add indexes for payment_transactions
DROP PROCEDURE IF EXISTS add_payment_trans_indexes;
DELIMITER //
CREATE PROCEDURE add_payment_trans_indexes()
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_NAME = 'payment_transactions' AND INDEX_NAME = 'idx_payment_link_id') THEN
        CREATE INDEX `idx_payment_link_id` ON `payment_transactions`(`payment_link_id` ASC);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_NAME = 'payment_transactions' AND INDEX_NAME = 'idx_payos_order_code') THEN
        CREATE INDEX `idx_payos_order_code` ON `payment_transactions`(`payos_order_code` ASC);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_NAME = 'payment_transactions' AND INDEX_NAME = 'idx_status') THEN
        CREATE INDEX `idx_status` ON `payment_transactions`(`status` ASC);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_NAME = 'payment_transactions' AND INDEX_NAME = 'idx_transaction_type') THEN
        CREATE INDEX `idx_transaction_type` ON `payment_transactions`(`transaction_type` ASC);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_NAME = 'payment_transactions' AND INDEX_NAME = 'idx_created_at') THEN
        CREATE INDEX `idx_created_at` ON `payment_transactions`(`created_at` ASC);
    END IF;
END //
DELIMITER ;
CALL add_payment_trans_indexes();
DROP PROCEDURE IF EXISTS add_payment_trans_indexes;

-- ============================================================================
-- REPORTS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS `reports` (
  `id` int NOT NULL AUTO_INCREMENT,
  `reporter_id` int NOT NULL,
  `product_id` int NOT NULL,
  `reason` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp,
  PRIMARY KEY (`id`),
  INDEX `reporter_id`(`reporter_id` ASC),
  INDEX `product_id`(`product_id` ASC)
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

ALTER TABLE `reports` ADD COLUMN IF NOT EXISTS `status` enum('pending','resolved') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT 'pending';
ALTER TABLE `reports` ADD COLUMN IF NOT EXISTS `resolved_at` datetime NULL DEFAULT NULL;

-- ============================================================================
-- REVIEWS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS `reviews` (
  `id` int NOT NULL AUTO_INCREMENT,
  `reviewer_id` int NOT NULL,
  `product_id` int NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp,
  PRIMARY KEY (`id`),
  INDEX `reviewer_id`(`reviewer_id` ASC),
  INDEX `product_id`(`product_id` ASC)
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

ALTER TABLE `reviews` ADD COLUMN IF NOT EXISTS `rating` int NULL DEFAULT NULL;
ALTER TABLE `reviews` ADD COLUMN IF NOT EXISTS `comment` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL;

-- ============================================================================
-- SEARCH_KEYWORDS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS `search_keywords` (
  `id` int NOT NULL AUTO_INCREMENT,
  `keyword` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `keyword`(`keyword` ASC)
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

ALTER TABLE `search_keywords` ADD COLUMN IF NOT EXISTS `search_count` int NULL DEFAULT 1;
ALTER TABLE `search_keywords` ADD COLUMN IF NOT EXISTS `updated_at` timestamp NULL DEFAULT current_timestamp ON UPDATE CURRENT_TIMESTAMP;

-- ============================================================================
-- SETTINGS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS `settings` (
  `id` int NOT NULL AUTO_INCREMENT,
  `setting_key` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `setting_key`(`setting_key` ASC)
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

ALTER TABLE `settings` ADD COLUMN IF NOT EXISTS `setting_value` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL;
ALTER TABLE `settings` ADD COLUMN IF NOT EXISTS `setting_group` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'general';
ALTER TABLE `settings` ADD COLUMN IF NOT EXISTS `updated_at` timestamp NULL DEFAULT current_timestamp ON UPDATE CURRENT_TIMESTAMP;

-- Add indexes for settings
DROP PROCEDURE IF EXISTS add_settings_indexes;
DELIMITER //
CREATE PROCEDURE add_settings_indexes()
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_NAME = 'settings' AND INDEX_NAME = 'idx_setting_key') THEN
        CREATE INDEX `idx_setting_key` ON `settings`(`setting_key` ASC);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_NAME = 'settings' AND INDEX_NAME = 'idx_setting_group') THEN
        CREATE INDEX `idx_setting_group` ON `settings`(`setting_group` ASC);
    END IF;
END //
DELIMITER ;
CALL add_settings_indexes();
DROP PROCEDURE IF EXISTS add_settings_indexes;

-- ============================================================================
-- TRANSACTIONS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS `transactions` (
  `id` int NOT NULL,
  `user_id` int NOT NULL,
  `type` enum('deposit','withdraw','payment','refund') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `amount` decimal(15, 2) NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

ALTER TABLE `transactions` ADD COLUMN IF NOT EXISTS `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL;
ALTER TABLE `transactions` ADD COLUMN IF NOT EXISTS `status` enum('pending','completed','failed') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT 'completed';

-- ============================================================================
-- USER_ADDRESSES TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS `user_addresses` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `label` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Tên gợi nhớ: Nhà riêng, Công ty...',
  `recipient_name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Tên người nhận hàng',
  `phone_number` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'SĐT người nhận',
  `province` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Tỉnh/Thành phố',
  `district` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Quận/Huyện',
  `street_address` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Số nhà, tên đường, tòa nhà...',
  `full_address` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Địa chỉ đầy đủ đã được chuẩn hóa',
  `created_at` timestamp NULL DEFAULT current_timestamp,
  PRIMARY KEY (`id`),
  INDEX `idx_user_id`(`user_id` ASC)
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = 'Bảng lưu địa chỉ giao hàng của users';

ALTER TABLE `user_addresses` ADD COLUMN IF NOT EXISTS `ward` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT 'Phường/Xã (optional vì một số địa chỉ đặc biệt)';
ALTER TABLE `user_addresses` ADD COLUMN IF NOT EXISTS `latitude` decimal(10, 8) NULL DEFAULT NULL COMMENT 'Vĩ độ từ HERE Geocoding';
ALTER TABLE `user_addresses` ADD COLUMN IF NOT EXISTS `longitude` decimal(11, 8) NULL DEFAULT NULL COMMENT 'Kinh độ từ HERE Geocoding';
ALTER TABLE `user_addresses` ADD COLUMN IF NOT EXISTS `here_place_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT 'HERE Place ID để lookup sau';
ALTER TABLE `user_addresses` ADD COLUMN IF NOT EXISTS `ghn_province_id` int NULL DEFAULT NULL COMMENT 'Mã tỉnh GHN';
ALTER TABLE `user_addresses` ADD COLUMN IF NOT EXISTS `ghn_district_id` int NULL DEFAULT NULL COMMENT 'Mã quận GHN';
ALTER TABLE `user_addresses` ADD COLUMN IF NOT EXISTS `ghn_ward_code` varchar(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT 'Mã phường GHN';
ALTER TABLE `user_addresses` ADD COLUMN IF NOT EXISTS `is_default` tinyint(1) NOT NULL DEFAULT 0 COMMENT '1 = địa chỉ mặc định';
ALTER TABLE `user_addresses` ADD COLUMN IF NOT EXISTS `updated_at` timestamp NULL DEFAULT current_timestamp ON UPDATE CURRENT_TIMESTAMP;

-- Add indexes for user_addresses
DROP PROCEDURE IF EXISTS add_user_addresses_indexes;
DELIMITER //
CREATE PROCEDURE add_user_addresses_indexes()
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_NAME = 'user_addresses' AND INDEX_NAME = 'idx_user_default') THEN
        CREATE INDEX `idx_user_default` ON `user_addresses`(`user_id` ASC, `is_default` ASC);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_NAME = 'user_addresses' AND INDEX_NAME = 'idx_here_place_id') THEN
        CREATE INDEX `idx_here_place_id` ON `user_addresses`(`here_place_id` ASC);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_NAME = 'user_addresses' AND INDEX_NAME = 'idx_ghn_district') THEN
        CREATE INDEX `idx_ghn_district` ON `user_addresses`(`ghn_district_id` ASC);
    END IF;
END //
DELIMITER ;
CALL add_user_addresses_indexes();
DROP PROCEDURE IF EXISTS add_user_addresses_indexes;

-- ============================================================================
-- WALLETS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS `wallets` (
  `id` bigint UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `user_id`(`user_id` ASC)
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = 'Ví tiền của seller';

ALTER TABLE `wallets` ADD COLUMN IF NOT EXISTS `balance` decimal(15, 2) NULL DEFAULT 0.00 COMMENT 'Số dư khả dụng';
ALTER TABLE `wallets` ADD COLUMN IF NOT EXISTS `pending_balance` decimal(15, 2) NULL DEFAULT 0.00 COMMENT 'Tiền đang trong escrow';
ALTER TABLE `wallets` ADD COLUMN IF NOT EXISTS `total_earned` decimal(15, 2) NULL DEFAULT 0.00 COMMENT 'Tổng tiền đã nhận từ bán hàng';
ALTER TABLE `wallets` ADD COLUMN IF NOT EXISTS `total_withdrawn` decimal(15, 2) NULL DEFAULT 0.00 COMMENT 'Tổng tiền đã rút';
ALTER TABLE `wallets` ADD COLUMN IF NOT EXISTS `bank_name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT 'Tên ngân hàng';
ALTER TABLE `wallets` ADD COLUMN IF NOT EXISTS `bank_account_number` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT 'Số tài khoản';
ALTER TABLE `wallets` ADD COLUMN IF NOT EXISTS `bank_account_name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT 'Tên chủ tài khoản';
ALTER TABLE `wallets` ADD COLUMN IF NOT EXISTS `bank_bin` varchar(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT 'Mã BIN ngân hàng (VietQR)';
ALTER TABLE `wallets` ADD COLUMN IF NOT EXISTS `updated_at` timestamp NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP;

-- Add indexes for wallets
DROP PROCEDURE IF EXISTS add_wallets_indexes;
DELIMITER //
CREATE PROCEDURE add_wallets_indexes()
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_NAME = 'wallets' AND INDEX_NAME = 'idx_user_id') THEN
        CREATE INDEX `idx_user_id` ON `wallets`(`user_id` ASC);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_NAME = 'wallets' AND INDEX_NAME = 'idx_balance') THEN
        CREATE INDEX `idx_balance` ON `wallets`(`balance` ASC);
    END IF;
END //
DELIMITER ;
CALL add_wallets_indexes();
DROP PROCEDURE IF EXISTS add_wallets_indexes;

-- ============================================================================
-- WALLET_TRANSACTIONS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS `wallet_transactions` (
  `id` bigint UNSIGNED NOT NULL AUTO_INCREMENT,
  `wallet_id` bigint UNSIGNED NOT NULL,
  `transaction_type` enum('credit','debit','withdrawal','refund_debit') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `amount` decimal(15, 2) NOT NULL COMMENT 'Số tiền giao dịch',
  `balance_before` decimal(15, 2) NOT NULL COMMENT 'Số dư trước giao dịch',
  `balance_after` decimal(15, 2) NOT NULL COMMENT 'Số dư sau giao dịch',
  `created_at` timestamp NULL DEFAULT current_timestamp,
  PRIMARY KEY (`id`),
  INDEX `idx_wallet_id`(`wallet_id` ASC)
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = 'Lịch sử giao dịch ví';

ALTER TABLE `wallet_transactions` ADD COLUMN IF NOT EXISTS `order_id` int NULL DEFAULT NULL COMMENT 'Đơn hàng liên quan (nếu có)';
ALTER TABLE `wallet_transactions` ADD COLUMN IF NOT EXISTS `description` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT 'Mô tả giao dịch';
ALTER TABLE `wallet_transactions` ADD COLUMN IF NOT EXISTS `reference_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT 'Mã tham chiếu (VD: payout_id)';
ALTER TABLE `wallet_transactions` ADD COLUMN IF NOT EXISTS `status` enum('pending','completed','failed') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT 'completed';

-- Add indexes for wallet_transactions
DROP PROCEDURE IF EXISTS add_wallet_trans_indexes;
DELIMITER //
CREATE PROCEDURE add_wallet_trans_indexes()
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_NAME = 'wallet_transactions' AND INDEX_NAME = 'idx_order_id') THEN
        CREATE INDEX `idx_order_id` ON `wallet_transactions`(`order_id` ASC);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_NAME = 'wallet_transactions' AND INDEX_NAME = 'idx_transaction_type') THEN
        CREATE INDEX `idx_transaction_type` ON `wallet_transactions`(`transaction_type` ASC);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_NAME = 'wallet_transactions' AND INDEX_NAME = 'idx_status') THEN
        CREATE INDEX `idx_status` ON `wallet_transactions`(`status` ASC);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_NAME = 'wallet_transactions' AND INDEX_NAME = 'idx_created_at') THEN
        CREATE INDEX `idx_created_at` ON `wallet_transactions`(`created_at` ASC);
    END IF;
END //
DELIMITER ;
CALL add_wallet_trans_indexes();
DROP PROCEDURE IF EXISTS add_wallet_trans_indexes;

-- ============================================================================
-- ADD FOREIGN KEYS (Safe - only add if not exists)
-- ============================================================================
DROP PROCEDURE IF EXISTS add_all_foreign_keys;
DELIMITER //
CREATE PROCEDURE add_all_foreign_keys()
BEGIN
    -- Products foreign keys
    IF NOT EXISTS (SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_NAME = 'products_ibfk_1' AND TABLE_NAME = 'products') THEN
        ALTER TABLE `products` ADD CONSTRAINT `products_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_NAME = 'products_ibfk_2' AND TABLE_NAME = 'products') THEN
        ALTER TABLE `products` ADD CONSTRAINT `products_ibfk_2` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`) ON DELETE RESTRICT;
    END IF;
    
    -- Product images foreign key
    IF NOT EXISTS (SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_NAME = 'product_images_ibfk_1' AND TABLE_NAME = 'product_images') THEN
        ALTER TABLE `product_images` ADD CONSTRAINT `product_images_ibfk_1` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE;
    END IF;
    
    -- Carts foreign keys
    IF NOT EXISTS (SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_NAME = 'carts_ibfk_1' AND TABLE_NAME = 'carts') THEN
        ALTER TABLE `carts` ADD CONSTRAINT `carts_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_NAME = 'carts_ibfk_2' AND TABLE_NAME = 'carts') THEN
        ALTER TABLE `carts` ADD CONSTRAINT `carts_ibfk_2` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE;
    END IF;
    
    -- Orders foreign keys
    IF NOT EXISTS (SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_NAME = 'orders_ibfk_1' AND TABLE_NAME = 'orders') THEN
        ALTER TABLE `orders` ADD CONSTRAINT `orders_ibfk_1` FOREIGN KEY (`buyer_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_NAME = 'orders_ibfk_2' AND TABLE_NAME = 'orders') THEN
        ALTER TABLE `orders` ADD CONSTRAINT `orders_ibfk_2` FOREIGN KEY (`seller_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT;
    END IF;
    
    -- Order details foreign keys
    IF NOT EXISTS (SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_NAME = 'order_details_ibfk_1' AND TABLE_NAME = 'order_details') THEN
        ALTER TABLE `order_details` ADD CONSTRAINT `order_details_ibfk_1` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_NAME = 'order_details_ibfk_2' AND TABLE_NAME = 'order_details') THEN
        ALTER TABLE `order_details` ADD CONSTRAINT `order_details_ibfk_2` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE RESTRICT;
    END IF;
    
    -- Escrow holds foreign keys
    IF NOT EXISTS (SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_NAME = 'fk_escrow_order' AND TABLE_NAME = 'escrow_holds') THEN
        ALTER TABLE `escrow_holds` ADD CONSTRAINT `fk_escrow_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_NAME = 'fk_escrow_seller' AND TABLE_NAME = 'escrow_holds') THEN
        ALTER TABLE `escrow_holds` ADD CONSTRAINT `fk_escrow_seller` FOREIGN KEY (`seller_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;
    END IF;
    
    -- Favorites foreign keys
    IF NOT EXISTS (SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_NAME = 'favorites_ibfk_1' AND TABLE_NAME = 'favorites') THEN
        ALTER TABLE `favorites` ADD CONSTRAINT `favorites_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_NAME = 'favorites_ibfk_2' AND TABLE_NAME = 'favorites') THEN
        ALTER TABLE `favorites` ADD CONSTRAINT `favorites_ibfk_2` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE RESTRICT;
    END IF;
    
    -- Follows foreign keys
    IF NOT EXISTS (SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_NAME = 'follows_ibfk_1' AND TABLE_NAME = 'follows') THEN
        ALTER TABLE `follows` ADD CONSTRAINT `follows_ibfk_1` FOREIGN KEY (`follower_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_NAME = 'follows_ibfk_2' AND TABLE_NAME = 'follows') THEN
        ALTER TABLE `follows` ADD CONSTRAINT `follows_ibfk_2` FOREIGN KEY (`following_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;
    END IF;
    
    -- Interactions foreign keys
    IF NOT EXISTS (SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_NAME = 'interactions_ibfk_1' AND TABLE_NAME = 'interactions') THEN
        ALTER TABLE `interactions` ADD CONSTRAINT `interactions_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_NAME = 'interactions_ibfk_2' AND TABLE_NAME = 'interactions') THEN
        ALTER TABLE `interactions` ADD CONSTRAINT `interactions_ibfk_2` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE RESTRICT;
    END IF;
    
    -- Messages foreign keys
    IF NOT EXISTS (SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_NAME = 'messages_ibfk_1' AND TABLE_NAME = 'messages') THEN
        ALTER TABLE `messages` ADD CONSTRAINT `messages_ibfk_1` FOREIGN KEY (`sender_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_NAME = 'messages_ibfk_2' AND TABLE_NAME = 'messages') THEN
        ALTER TABLE `messages` ADD CONSTRAINT `messages_ibfk_2` FOREIGN KEY (`receiver_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT;
    END IF;
    
    -- Message attachments foreign key
    IF NOT EXISTS (SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_NAME = 'message_attachments_ibfk_1' AND TABLE_NAME = 'message_attachments') THEN
        ALTER TABLE `message_attachments` ADD CONSTRAINT `message_attachments_ibfk_1` FOREIGN KEY (`message_id`) REFERENCES `messages` (`id`) ON DELETE CASCADE;
    END IF;
    
    -- Notifications foreign key
    IF NOT EXISTS (SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_NAME = 'notifications_ibfk_1' AND TABLE_NAME = 'notifications') THEN
        ALTER TABLE `notifications` ADD CONSTRAINT `notifications_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT;
    END IF;
    
    -- Payment transactions foreign key
    IF NOT EXISTS (SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_NAME = 'fk_payment_trans_order' AND TABLE_NAME = 'payment_transactions') THEN
        ALTER TABLE `payment_transactions` ADD CONSTRAINT `fk_payment_trans_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE;
    END IF;
    
    -- Reports foreign keys
    IF NOT EXISTS (SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_NAME = 'reports_ibfk_1' AND TABLE_NAME = 'reports') THEN
        ALTER TABLE `reports` ADD CONSTRAINT `reports_ibfk_1` FOREIGN KEY (`reporter_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_NAME = 'reports_ibfk_2' AND TABLE_NAME = 'reports') THEN
        ALTER TABLE `reports` ADD CONSTRAINT `reports_ibfk_2` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE RESTRICT;
    END IF;
    
    -- Reviews foreign keys
    IF NOT EXISTS (SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_NAME = 'reviews_ibfk_1' AND TABLE_NAME = 'reviews') THEN
        ALTER TABLE `reviews` ADD CONSTRAINT `reviews_ibfk_1` FOREIGN KEY (`reviewer_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_NAME = 'reviews_ibfk_2' AND TABLE_NAME = 'reviews') THEN
        ALTER TABLE `reviews` ADD CONSTRAINT `reviews_ibfk_2` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE RESTRICT;
    END IF;
    
    -- User addresses foreign key
    IF NOT EXISTS (SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_NAME = 'fk_user_addresses_user_id' AND TABLE_NAME = 'user_addresses') THEN
        ALTER TABLE `user_addresses` ADD CONSTRAINT `fk_user_addresses_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    
    -- Wallets foreign key
    IF NOT EXISTS (SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_NAME = 'fk_wallet_user' AND TABLE_NAME = 'wallets') THEN
        ALTER TABLE `wallets` ADD CONSTRAINT `fk_wallet_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;
    END IF;
    
    -- Wallet transactions foreign keys
    IF NOT EXISTS (SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_NAME = 'fk_wallet_trans_order' AND TABLE_NAME = 'wallet_transactions') THEN
        ALTER TABLE `wallet_transactions` ADD CONSTRAINT `fk_wallet_trans_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_NAME = 'fk_wallet_trans_wallet' AND TABLE_NAME = 'wallet_transactions') THEN
        ALTER TABLE `wallet_transactions` ADD CONSTRAINT `fk_wallet_trans_wallet` FOREIGN KEY (`wallet_id`) REFERENCES `wallets` (`id`) ON DELETE CASCADE;
    END IF;
END //
DELIMITER ;
CALL add_all_foreign_keys();
DROP PROCEDURE IF EXISTS add_all_foreign_keys;

SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================================
-- DONE! Migration completed safely.
-- ============================================================================
SELECT 'Safe migration completed successfully!' AS status;
