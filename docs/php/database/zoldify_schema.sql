-- Zoldify Schema Cleaned for MySQL Workbench
-- Removed Data Dumps for clearer schema import

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
SET time_zone = "+00:00";

-- --------------------------------------------------------

--
-- Table structure for table `carts`
--

CREATE TABLE `carts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `product_id` int NOT NULL,
  `quantity` int NOT NULL DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_user_product` (`user_id`,`product_id`),
  KEY `product_id` (`product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `categories`
--

CREATE TABLE `categories` (
  `id` int NOT NULL AUTO_INCREMENT,
  `parent_id` int DEFAULT NULL,
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `tag` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `icon` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `image` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sort_order` int DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `fk_category_parent` (`parent_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `escrow_holds`
--

CREATE TABLE `escrow_holds` (
  `id` bigint UNSIGNED NOT NULL AUTO_INCREMENT,
  `order_id` int NOT NULL,
  `seller_id` int NOT NULL,
  `amount` decimal(15,2) NOT NULL COMMENT 'Tổng số tiền giữ',
  `platform_fee` decimal(15,2) DEFAULT '0.00' COMMENT 'Phí sàn (nếu có)',
  `seller_amount` decimal(15,2) NOT NULL COMMENT 'Số tiền seller nhận (amount - fee)',
  `status` enum('holding','released','refunded','disputed') COLLATE utf8mb4_unicode_ci DEFAULT 'holding',
  `held_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Thời điểm bắt đầu giữ',
  `release_scheduled_at` timestamp NULL DEFAULT NULL COMMENT 'Ngày dự kiến giải ngân',
  `released_at` timestamp NULL DEFAULT NULL COMMENT 'Ngày thực tế giải ngân',
  `release_notes` text COLLATE utf8mb4_unicode_ci COMMENT 'Ghi chú khi giải ngân/hoàn tiền',
  PRIMARY KEY (`id`),
  UNIQUE KEY `order_id` (`order_id`),
  KEY `idx_seller_id` (`seller_id`),
  KEY `idx_status` (`status`),
  KEY `idx_release_scheduled` (`release_scheduled_at`),
  KEY `idx_held_at` (`held_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Quản lý tiền escrow (giữ lại)';

-- --------------------------------------------------------

--
-- Table structure for table `favorites`
--

CREATE TABLE `favorites` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `product_id` int NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  KEY `product_id` (`product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `follows`
--

CREATE TABLE `follows` (
  `id` int NOT NULL AUTO_INCREMENT,
  `follower_id` int NOT NULL COMMENT 'User đang theo dõi',
  `following_id` int NOT NULL COMMENT 'User được theo dõi',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_follow` (`follower_id`,`following_id`),
  KEY `idx_follower` (`follower_id`),
  KEY `idx_following` (`following_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `interactions`
--

CREATE TABLE `interactions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `product_id` int NOT NULL,
  `interaction_type` enum('view','click') COLLATE utf8mb4_unicode_ci NOT NULL,
  `score` int DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  KEY `product_id` (`product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `messages`
--

CREATE TABLE `messages` (
  `id` int NOT NULL AUTO_INCREMENT,
  `sender_id` int NOT NULL,
  `receiver_id` int NOT NULL,
  `content` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_read` tinyint(1) DEFAULT '0',
  `has_attachment` tinyint(1) DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `sender_id` (`sender_id`),
  KEY `receiver_id` (`receiver_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `message_attachments`
--

CREATE TABLE `message_attachments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `message_id` int NOT NULL,
  `file_name` varchar(255) NOT NULL,
  `file_path` varchar(500) NOT NULL,
  `file_type` varchar(50) NOT NULL,
  `file_size` int NOT NULL DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_message_id` (`message_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `migrations`
--

CREATE TABLE `migrations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `filename` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `batch` int NOT NULL DEFAULT '1',
  `executed_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `filename` (`filename`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `notifications`
--

CREATE TABLE `notifications` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `content` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_read` tinyint(1) DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `orders`
--

CREATE TABLE `orders` (
  `id` int NOT NULL AUTO_INCREMENT,
  `buyer_id` int NOT NULL COMMENT 'Người mua',
  `seller_id` int NOT NULL COMMENT 'Người bán - Thêm cái này vào cho dễ code',
  `total_amount` decimal(10,2) NOT NULL,
  `platform_fee` decimal(15,2) NOT NULL DEFAULT '0.00' COMMENT 'Phí sàn (VND)',
  `seller_amount` decimal(15,2) NOT NULL DEFAULT '0.00' COMMENT 'Tiền seller nhận sau phí (VND)',
  `shipping_address_id` int DEFAULT NULL,
  `shipping_address_snapshot` json DEFAULT NULL,
  `shipping_fee` decimal(10,2) DEFAULT '0.00',
  `shipping_note` text COLLATE utf8mb4_unicode_ci,
  `status` enum('pending','pending_payment','paid','confirmed','shipping','received','completed','cancelled','refunded') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `payment_method` enum('cod','bank_transfer','payos') COLLATE utf8mb4_unicode_ci DEFAULT 'cod',
  `payment_status` enum('pending','paid','failed','refunded') COLLATE utf8mb4_unicode_ci DEFAULT 'pending',
  `payos_order_code` bigint UNSIGNED DEFAULT NULL,
  `shipping_address` text COLLATE utf8mb4_unicode_ci COMMENT 'Địa chỉ giao hàng đầy đủ',
  `shipping_phone` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Số điện thoại người nhận',
  `shipping_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Tên người nhận hàng',
  `note` text COLLATE utf8mb4_unicode_ci COMMENT 'Ghi chú của người mua',
  `payment_link_id` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `paid_at` timestamp NULL DEFAULT NULL,
  `received_at` timestamp NULL DEFAULT NULL,
  `escrow_release_at` timestamp NULL DEFAULT NULL,
  `completed_at` timestamp NULL DEFAULT NULL,
  `trial_days` tinyint UNSIGNED DEFAULT '7',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `cancel_reason` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ghn_order_code` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Mã vận đơn GHN',
  `ghn_sort_code` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Mã phân loại kho GHN',
  `ghn_expected_delivery` datetime DEFAULT NULL COMMENT 'Ngày giao dự kiến',
  `ghn_shipping_fee` int UNSIGNED DEFAULT '0' COMMENT 'Phí ship GHN',
  `ghn_status` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Trạng thái GHN',
  PRIMARY KEY (`id`),
  KEY `buyer_id` (`buyer_id`),
  KEY `seller_id` (`seller_id`),
  KEY `idx_payment_link_id` (`payment_link_id`),
  KEY `idx_escrow_release` (`escrow_release_at`),
  KEY `idx_orders_ghn_order_code` (`ghn_order_code`),
  KEY `idx_shipping_address` (`shipping_address_id`),
  KEY `idx_payos_order_code` (`payos_order_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `order_details`
--

CREATE TABLE `order_details` (
  `id` int NOT NULL AUTO_INCREMENT,
  `order_id` int NOT NULL,
  `product_id` int NOT NULL,
  `quantity` int NOT NULL,
  `price_at_purchase` decimal(10,2) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `order_id` (`order_id`),
  KEY `product_id` (`product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `payment_transactions`
--

CREATE TABLE `payment_transactions` (
  `id` bigint UNSIGNED NOT NULL AUTO_INCREMENT,
  `order_id` int NOT NULL,
  `transaction_type` enum('payment','escrow_hold','escrow_release','refund') COLLATE utf8mb4_unicode_ci NOT NULL,
  `amount` decimal(15,2) NOT NULL,
  `payment_link_id` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'ID link thanh toán từ PayOS',
  `payos_transaction_id` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Mã giao dịch từ PayOS',
  `payos_reference` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Reference number từ ngân hàng',
  `payos_order_code` bigint UNSIGNED DEFAULT NULL COMMENT 'Mã đơn hàng gửi cho PayOS',
  `status` enum('pending','processing','success','failed') COLLATE utf8mb4_unicode_ci DEFAULT 'pending',
  `metadata` json DEFAULT NULL COMMENT 'Dữ liệu raw từ PayOS webhook',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_order_id` (`order_id`),
  KEY `idx_payment_link_id` (`payment_link_id`),
  KEY `idx_payos_order_code` (`payos_order_code`),
  KEY `idx_status` (`status`),
  KEY `idx_transaction_type` (`transaction_type`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Lịch sử giao dịch thanh toán PayOS';

-- --------------------------------------------------------

--
-- Table structure for table `products`
--

CREATE TABLE `products` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `category_id` int NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `price` decimal(15,2) NOT NULL DEFAULT '0.00',
  `quantity` int NOT NULL DEFAULT '0',
  `view_count` int UNSIGNED NOT NULL DEFAULT '0' COMMENT 'Số lượt xem',
  `image` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('active','sold','hidden') COLLATE utf8mb4_unicode_ci DEFAULT 'active',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `condition` enum('new','like_new','good','fair') COLLATE utf8mb4_unicode_ci DEFAULT 'good',
  PRIMARY KEY (`id`),
  KEY `category_id` (`category_id`),
  KEY `idx_status_created` (`status`,`created_at` DESC),
  KEY `idx_status_category` (`status`,`category_id`),
  KEY `idx_status_price` (`status`,`price`),
  KEY `idx_quantity` (`quantity`),
  KEY `idx_user_status` (`user_id`,`status`),
  KEY `idx_view_count` (`view_count`),
  FULLTEXT KEY `ft_search` (`name`,`description`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `product_images`
--

CREATE TABLE `product_images` (
  `id` int NOT NULL AUTO_INCREMENT,
  `product_id` int NOT NULL,
  `image_path` varchar(255) NOT NULL COMMENT 'Đường dẫn ảnh relative to uploads',
  `is_primary` tinyint(1) DEFAULT '0' COMMENT 'Ảnh chính của sản phẩm',
  `sort_order` int DEFAULT '0' COMMENT 'Thứ tự hiển thị',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `product_id` (`product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `reports`
--

CREATE TABLE `reports` (
  `id` int NOT NULL AUTO_INCREMENT,
  `reporter_id` int NOT NULL,
  `product_id` int NOT NULL,
  `reason` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('pending','resolved') COLLATE utf8mb4_unicode_ci DEFAULT 'pending',
  `resolved_at` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `reporter_id` (`reporter_id`),
  KEY `product_id` (`product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `reviews`
--

CREATE TABLE `reviews` (
  `id` int NOT NULL AUTO_INCREMENT,
  `reviewer_id` int NOT NULL,
  `product_id` int NOT NULL,
  `rating` int DEFAULT NULL,
  `comment` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `reviewer_id` (`reviewer_id`),
  KEY `product_id` (`product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `search_keywords`
--

CREATE TABLE `search_keywords` (
  `id` int NOT NULL AUTO_INCREMENT,
  `keyword` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `search_count` int DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `keyword` (`keyword`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `settings`
--

CREATE TABLE `settings` (
  `id` int NOT NULL AUTO_INCREMENT,
  `setting_key` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `setting_value` text COLLATE utf8mb4_unicode_ci,
  `setting_group` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'general',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `setting_key` (`setting_key`),
  KEY `idx_setting_key` (`setting_key`),
  KEY `idx_setting_group` (`setting_group`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `transactions`
--

CREATE TABLE `transactions` (
  `id` int NOT NULL,
  `user_id` int NOT NULL,
  `type` enum('deposit','withdraw','payment','refund') NOT NULL,
  `amount` decimal(15,2) NOT NULL,
  `description` text,
  `status` enum('pending','completed','failed') DEFAULT 'completed',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `users`
--

CREATE TABLE `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `full_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `password` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `phone_number` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `phone_verified` tinyint(1) DEFAULT '0',
  `gender` enum('male','female','other') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `address` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `role` enum('buyer','seller','admin','moderator') COLLATE utf8mb4_unicode_ci DEFAULT 'buyer',
  `balance` decimal(15,2) DEFAULT '0.00',
  `avatar` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `email_verified` tinyint(1) DEFAULT '0',
  `email_verification_token` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `email_verification_expires_at` datetime DEFAULT NULL,
  `is_locked` tinyint(1) DEFAULT '0',
  `last_seen` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `user_addresses`
--

CREATE TABLE `user_addresses` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `label` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Tên gợi nhớ: Nhà riêng, Công ty...',
  `recipient_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Tên người nhận hàng',
  `phone_number` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'SĐT người nhận',
  `province` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Tỉnh/Thành phố',
  `district` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Quận/Huyện',
  `ward` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Phường/Xã (optional vì một số địa chỉ đặc biệt)',
  `street_address` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Số nhà, tên đường, tòa nhà...',
  `full_address` text COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Địa chỉ đầy đủ đã được chuẩn hóa',
  `latitude` decimal(10,8) DEFAULT NULL COMMENT 'Vĩ độ từ HERE Geocoding',
  `longitude` decimal(11,8) DEFAULT NULL COMMENT 'Kinh độ từ HERE Geocoding',
  `here_place_id` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'HERE Place ID để lookup sau',
  `ghn_province_id` int DEFAULT NULL COMMENT 'Mã tỉnh GHN',
  `ghn_district_id` int DEFAULT NULL COMMENT 'Mã quận GHN',
  `ghn_ward_code` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Mã phường GHN',
  `is_default` tinyint(1) NOT NULL DEFAULT '0' COMMENT '1 = địa chỉ mặc định',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_user_default` (`user_id`,`is_default`),
  KEY `idx_here_place_id` (`here_place_id`),
  KEY `idx_ghn_district` (`ghn_district_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Bảng lưu địa chỉ giao hàng của users';

-- --------------------------------------------------------

--
-- Table structure for table `wallets`
--

CREATE TABLE `wallets` (
  `id` bigint UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `balance` decimal(15,2) DEFAULT '0.00' COMMENT 'Số dư khả dụng',
  `pending_balance` decimal(15,2) DEFAULT '0.00' COMMENT 'Tiền đang trong escrow',
  `total_earned` decimal(15,2) DEFAULT '0.00' COMMENT 'Tổng tiền đã nhận từ bán hàng',
  `total_withdrawn` decimal(15,2) DEFAULT '0.00' COMMENT 'Tổng tiền đã rút',
  `bank_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Tên ngân hàng',
  `bank_account_number` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Số tài khoản',
  `bank_account_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Tên chủ tài khoản',
  `bank_bin` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Mã BIN ngân hàng (VietQR)',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `user_id` (`user_id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_balance` (`balance`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Ví tiền của seller';

-- --------------------------------------------------------

--
-- Table structure for table `wallet_transactions`
--

CREATE TABLE `wallet_transactions` (
  `id` bigint UNSIGNED NOT NULL AUTO_INCREMENT,
  `wallet_id` bigint UNSIGNED NOT NULL,
  `order_id` int DEFAULT NULL COMMENT 'Đơn hàng liên quan (nếu có)',
  `transaction_type` enum('credit','debit','withdrawal','refund_debit') COLLATE utf8mb4_unicode_ci NOT NULL,
  `amount` decimal(15,2) NOT NULL COMMENT 'Số tiền giao dịch',
  `balance_before` decimal(15,2) NOT NULL COMMENT 'Số dư trước giao dịch',
  `balance_after` decimal(15,2) NOT NULL COMMENT 'Số dư sau giao dịch',
  `description` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Mô tả giao dịch',
  `reference_id` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Mã tham chiếu (VD: payout_id)',
  `status` enum('pending','completed','failed') COLLATE utf8mb4_unicode_ci DEFAULT 'completed',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_wallet_id` (`wallet_id`),
  KEY `idx_order_id` (`order_id`),
  KEY `idx_transaction_type` (`transaction_type`),
  KEY `idx_status` (`status`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Lịch sử giao dịch ví';

-- --------------------------------------------------------
-- FOREIGN KEYS
-- --------------------------------------------------------

--
-- Constraints for table `carts`
--
ALTER TABLE `carts`
  ADD CONSTRAINT `carts_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `carts_ibfk_2` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `categories`
--
ALTER TABLE `categories`
  ADD CONSTRAINT `fk_category_parent` FOREIGN KEY (`parent_id`) REFERENCES `categories` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `escrow_holds`
--
ALTER TABLE `escrow_holds`
  ADD CONSTRAINT `fk_escrow_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_escrow_seller` FOREIGN KEY (`seller_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `favorites`
--
ALTER TABLE `favorites`
  ADD CONSTRAINT `favorites_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  ADD CONSTRAINT `favorites_ibfk_2` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`);

--
-- Constraints for table `follows`
--
ALTER TABLE `follows`
  ADD CONSTRAINT `follows_ibfk_1` FOREIGN KEY (`follower_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `follows_ibfk_2` FOREIGN KEY (`following_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `interactions`
--
ALTER TABLE `interactions`
  ADD CONSTRAINT `interactions_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  ADD CONSTRAINT `interactions_ibfk_2` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`);

--
-- Constraints for table `messages`
--
ALTER TABLE `messages`
  ADD CONSTRAINT `messages_ibfk_1` FOREIGN KEY (`sender_id`) REFERENCES `users` (`id`),
  ADD CONSTRAINT `messages_ibfk_2` FOREIGN KEY (`receiver_id`) REFERENCES `users` (`id`);

--
-- Constraints for table `message_attachments`
--
ALTER TABLE `message_attachments`
  ADD CONSTRAINT `message_attachments_ibfk_1` FOREIGN KEY (`message_id`) REFERENCES `messages` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `notifications`
--
ALTER TABLE `notifications`
  ADD CONSTRAINT `notifications_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`);

--
-- Constraints for table `orders`
--
ALTER TABLE `orders`
  ADD CONSTRAINT `orders_ibfk_1` FOREIGN KEY (`buyer_id`) REFERENCES `users` (`id`),
  ADD CONSTRAINT `orders_ibfk_2` FOREIGN KEY (`seller_id`) REFERENCES `users` (`id`);

--
-- Constraints for table `order_details`
--
ALTER TABLE `order_details`
  ADD CONSTRAINT `order_details_ibfk_1` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`),
  ADD CONSTRAINT `order_details_ibfk_2` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`);

--
-- Constraints for table `payment_transactions`
--
ALTER TABLE `payment_transactions`
  ADD CONSTRAINT `fk_payment_trans_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `products`
--
ALTER TABLE `products`
  ADD CONSTRAINT `products_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  ADD CONSTRAINT `products_ibfk_2` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`);

--
-- Constraints for table `product_images`
--
ALTER TABLE `product_images`
  ADD CONSTRAINT `product_images_ibfk_1` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `reports`
--
ALTER TABLE `reports`
  ADD CONSTRAINT `reports_ibfk_1` FOREIGN KEY (`reporter_id`) REFERENCES `users` (`id`),
  ADD CONSTRAINT `reports_ibfk_2` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`);

--
-- Constraints for table `reviews`
--
ALTER TABLE `reviews`
  ADD CONSTRAINT `reviews_ibfk_1` FOREIGN KEY (`reviewer_id`) REFERENCES `users` (`id`),
  ADD CONSTRAINT `reviews_ibfk_2` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`);

--
-- Constraints for table `user_addresses`
--
ALTER TABLE `user_addresses`
  ADD CONSTRAINT `fk_user_addresses_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `wallets`
--
ALTER TABLE `wallets`
  ADD CONSTRAINT `fk_wallet_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `wallet_transactions`
--
ALTER TABLE `wallet_transactions`
  ADD CONSTRAINT `fk_wallet_trans_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_wallet_trans_wallet` FOREIGN KEY (`wallet_id`) REFERENCES `wallets` (`id`) ON DELETE CASCADE;

