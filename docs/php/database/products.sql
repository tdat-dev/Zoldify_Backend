/*
 Navicat Premium Dump SQL

 Source Server         : zoldify
 Source Server Type    : MySQL
 Source Server Version : 101110 (10.11.10-MariaDB-log)
 Source Host           : 136.110.53.93:3306
 Source Schema         : zoldify

 Target Server Type    : MySQL
 Target Server Version : 101110 (10.11.10-MariaDB-log)
 File Encoding         : 65001

 Date: 26/01/2026 00:42:59
*/

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ----------------------------
-- Table structure for products
-- ----------------------------
DROP TABLE IF EXISTS `products`;
CREATE TABLE `products`  (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `category_id` int NOT NULL,
  `name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `price` decimal(15, 2) NOT NULL DEFAULT 0.00,
  `is_freeship` tinyint(1) NULL DEFAULT 0,
  `quantity` int NOT NULL DEFAULT 0,
  `view_count` int UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Số lượt xem',
  `image` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `status` enum('active','sold','hidden') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT 'active',
  `created_at` timestamp NULL DEFAULT current_timestamp,
  `product_condition` enum('new','like_new','good','fair','poor') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT 'good',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `category_id`(`category_id` ASC) USING BTREE,
  INDEX `idx_status_created`(`status` ASC, `created_at` DESC) USING BTREE,
  INDEX `idx_status_category`(`status` ASC, `category_id` ASC) USING BTREE,
  INDEX `idx_status_price`(`status` ASC, `price` ASC) USING BTREE,
  INDEX `idx_quantity`(`quantity` ASC) USING BTREE,
  INDEX `idx_user_status`(`user_id` ASC, `status` ASC) USING BTREE,
  INDEX `idx_view_count`(`view_count` ASC) USING BTREE,
  FULLTEXT INDEX `ft_search`(`name`, `description`),
  CONSTRAINT `products_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `products_ibfk_2` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 131 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Records of products
-- ----------------------------
INSERT INTO `products` VALUES (1, 2, 2, 'Giáo trình Lập trình C++', 'Sách mới 95%, không gạch chú. Phù hợp cho sinh viên năm 1-2 IT.', 85000.00, 0, 9, 9, 'products/product_1.png', 'active', '2025-12-26 14:57:03', 'good');
INSERT INTO `products` VALUES (2, 3, 4, 'Kinh tế vi mô - N. Gregory Mankiw', 'Bản tiếng Việt, đã dùng 1 kỳ, còn mới.', 120000.00, 0, 10, 4, 'products/product_2.png', 'active', '2025-12-26 14:57:03', 'good');
INSERT INTO `products` VALUES (3, 4, 7, 'Oxford Advanced Learner Dictionary', 'Từ điển Anh-Việt bìa cứng, không rách.', 150000.00, 0, 10, 0, 'products/product_3.png', 'active', '2025-12-26 14:57:03', 'good');
INSERT INTO `products` VALUES (4, 2, 10, 'Chuột Logitech G102', 'Dùng 6 tháng, còn nguyên hộp. Bảo hành 18 tháng.', 250000.00, 0, 10, 0, 'products/product_4.png', 'active', '2025-12-26 14:57:03', 'good');
INSERT INTO `products` VALUES (5, 5, 51, 'Tai nghe Sony WH-1000XM4', 'Chống ồn cực tốt, pin 8/10. Không hộp.', 4500000.00, 0, 9, 11, 'products/product_5.png', 'active', '2025-12-26 14:57:03', 'good');
INSERT INTO `products` VALUES (6, 3, 10, 'USB SanDisk 32GB', 'Mới 100%, chưa bóc seal.', 80000.00, 0, 10, 0, 'products/product_6.png', 'sold', '2025-12-26 14:57:03', 'good');
INSERT INTO `products` VALUES (7, 4, 25, 'Áo hoodie Uniqlo màu đen', 'Size M, giặt 2 lần. Form rộng unisex.', 180000.00, 0, 10, 3, 'products/product_7.png', 'active', '2025-12-26 14:57:03', 'good');
INSERT INTO `products` VALUES (8, 5, 42, 'Giày Converse Chuck Taylor', 'Size 40, màu trắng. Mua tháng trước nhưng không vừa.', 550000.00, 0, 10, 2, 'products/product_8.png', 'active', '2025-12-26 14:57:03', 'good');
INSERT INTO `products` VALUES (9, 2, 16, 'Combo 10 bút bi Thiên Long', 'Mực xanh, mới 100%.', 25000.00, 0, 10, 3, 'products/product_9.png', 'hidden', '2025-12-26 14:57:03', 'good');
INSERT INTO `products` VALUES (10, 3, 19, 'Máy tính Casio FX-580VN X', 'Dùng 1 năm, còn tốt. Có hướng dẫn sử dụng.', 350000.00, 0, 10, 0, 'products/product_10.png', 'active', '2025-12-26 14:57:03', 'good');
INSERT INTO `products` VALUES (11, 4, 20, 'Ba lô The North Face 20L', 'Màu xám, chống nước. Dùng 1 năm nhưng còn mới 90%.', 650000.00, 0, 10, 0, 'products/product_11.png', 'active', '2025-12-26 14:57:03', 'good');
INSERT INTO `products` VALUES (12, 5, 34, 'Bình giữ nhiệt Lock&Lock 500ml', 'Màu hồng pastel, chưa sử dụng.', 120000.00, 0, 10, 2, 'products/product_12.png', 'active', '2025-12-26 14:57:03', 'good');
INSERT INTO `products` VALUES (13, 2, 36, 'Bóng đá Mikasa size 5', 'Dùng tập luyện 3 tháng, còn bơm tốt.', 180000.00, 0, 10, 0, 'products/product_13.png', 'hidden', '2025-12-26 14:57:03', 'good');
INSERT INTO `products` VALUES (14, 3, 45, 'Thảm tập Yoga Nike 6mm', 'Màu xanh dương, có túi đựng. Mua nhầm size.', 300000.00, 0, 10, 3, 'products/product_14.png', 'active', '2025-12-26 14:57:03', 'good');
INSERT INTO `products` VALUES (15, 11, 2, 'Lập trình hướng đối tượng C++', '\n\nTình trạng: Như mới', 50000.00, 0, 0, 8, 'products/product_15.png', 'active', '2026-01-04 23:03:03', 'good');
INSERT INTO `products` VALUES (16, 11, 2, 'Huy Ngu', '\n\nTình trạng: Như mới', 2000.00, 0, 0, 6, 'products/1768204062_0_ChatGPT Image 02_51_36 18 thg 6, 2025.png', 'hidden', '2026-01-12 14:47:42', 'good');
INSERT INTO `products` VALUES (31, 11, 37, 'Ảnh', 'Ngon, bổ, rẻ\n\nTình trạng: Mới 100%', 1000000.00, 0, 99, 4, 'products/1769357460_0_screenshot_2025-12-20_230028.png', 'hidden', '2026-01-25 16:11:00', 'new');
INSERT INTO `products` VALUES (32, 34, 34, 'Gương', 'Ngon\n\nTình trạng: Trung bình', 2000.00, 0, 199, 2, 'products/1769358685_0_screenshot_2025-11-23_224654.png', 'hidden', '2026-01-25 16:31:25', 'fair');
INSERT INTO `products` VALUES (34, 1, 38, 'iPhone 15 Pro Max 256GB', 'iPhone 15 Pro Max chính hãng, còn bảo hành 10 tháng, fullbox', 28500000.00, 0, 3, 538, 'https://placehold.co/600x600/3498db/fff?text=iPhone15', 'active', '2026-01-12 17:01:28', 'like_new');
INSERT INTO `products` VALUES (35, 1, 38, 'iPhone 14 Pro 128GB Tím', 'Máy đẹp 99%, pin 92%, không trầy xước', 22000000.00, 1, 2, 33, 'https://placehold.co/600x600/9b59b6/fff?text=iPhone14', 'active', '2025-12-29 17:01:28', 'like_new');
INSERT INTO `products` VALUES (36, 1, 38, 'Samsung Galaxy S24 Ultra', 'Galaxy S24 Ultra 512GB, Titanium Gray, mới 100%', 32000000.00, 0, 1, 554, 'https://placehold.co/600x600/1abc9c/fff?text=S24Ultra', 'active', '2026-01-19 17:01:28', 'new');
INSERT INTO `products` VALUES (37, 1, 38, 'Samsung Galaxy Z Fold 5', 'Z Fold 5 256GB, màu kem, đã qua sử dụng 3 tháng', 35000000.00, 0, 1, 670, 'https://placehold.co/600x600/e74c3c/fff?text=ZFold5', 'active', '2026-01-15 17:01:28', 'like_new');
INSERT INTO `products` VALUES (38, 1, 38, 'Xiaomi 14 Pro 512GB', 'Xiaomi 14 Pro bản China, đã unlock, còn BH 6 tháng', 18500000.00, 1, 2, 688, 'https://placehold.co/600x600/f39c12/fff?text=Xiaomi14', 'active', '2026-01-22 17:01:28', 'good');
INSERT INTO `products` VALUES (39, 1, 38, 'OPPO Find X7 Ultra', 'Find X7 Ultra, camera Hasselblad, pin 5000mAh', 24000000.00, 0, 1, 433, 'https://placehold.co/600x600/2ecc71/fff?text=FindX7', 'active', '2026-01-12 17:01:28', 'new');
INSERT INTO `products` VALUES (40, 1, 38, 'iPhone 13 128GB Xanh', 'iPhone 13 xanh lá, máy Việt Nam, còn BH Apple Care', 15500000.00, 1, 4, 100, 'https://placehold.co/600x600/27ae60/fff?text=iPhone13', 'active', '2025-12-27 17:01:28', 'good');
INSERT INTO `products` VALUES (41, 1, 38, 'Google Pixel 8 Pro', 'Pixel 8 Pro 256GB, màu Obsidian, mới seal', 21000000.00, 0, 2, 200, 'https://placehold.co/600x600/34495e/fff?text=Pixel8', 'active', '2026-01-11 17:01:28', 'new');
INSERT INTO `products` VALUES (42, 1, 39, 'MacBook Pro M3 Max 16 inch', 'MacBook Pro M3 Max, 36GB RAM, 1TB SSD, màu Space Black', 85000000.00, 0, 1, 703, 'https://placehold.co/600x600/7f8c8d/fff?text=MacBookM3', 'active', '2026-01-08 17:01:28', 'new');
INSERT INTO `products` VALUES (43, 1, 39, 'MacBook Air M2 15 inch', 'MacBook Air M2, 8GB RAM, 256GB, màu Starlight, fullbox', 32000000.00, 1, 2, 912, 'https://placehold.co/600x600/bdc3c7/fff?text=AirM2', 'active', '2026-01-14 17:01:28', 'like_new');
INSERT INTO `products` VALUES (44, 1, 39, 'Dell XPS 15 2024', 'Dell XPS 15, Core i7-13700H, RTX 4060, 32GB RAM', 45000000.00, 0, 1, 455, 'https://placehold.co/600x600/2980b9/fff?text=XPS15', 'active', '2026-01-19 17:01:28', 'new');
INSERT INTO `products` VALUES (45, 1, 39, 'ThinkPad X1 Carbon Gen 11', 'Lenovo ThinkPad X1 Carbon, i7, 16GB, 512GB, màn 2K', 38000000.00, 0, 1, 539, 'https://placehold.co/600x600/c0392b/fff?text=X1Carbon', 'active', '2025-12-31 17:01:28', 'like_new');
INSERT INTO `products` VALUES (46, 1, 39, 'ASUS ROG Strix G16', 'ROG Strix G16, i9-13980HX, RTX 4080, 32GB, chuyên gaming', 55000000.00, 0, 1, 332, 'https://placehold.co/600x600/8e44ad/fff?text=ROGStrix', 'active', '2026-01-07 17:01:28', 'new');
INSERT INTO `products` VALUES (47, 1, 39, 'HP Spectre x360', 'HP Spectre x360 14, OLED, i7, 16GB RAM, màn cảm ứng', 35000000.00, 1, 2, 40, 'https://placehold.co/600x600/16a085/fff?text=Spectre', 'active', '2026-01-08 17:01:28', 'good');
INSERT INTO `products` VALUES (48, 1, 39, 'Surface Laptop 5', 'Microsoft Surface Laptop 5, 13.5 inch, i5, 8GB RAM', 28000000.00, 0, 3, 207, 'https://placehold.co/600x600/2c3e50/fff?text=Surface5', 'active', '2026-01-25 17:01:28', 'like_new');
INSERT INTO `products` VALUES (49, 1, 40, 'Sony A7 IV Body', 'Sony Alpha 7 IV body, 33MP, ít chụp, còn BH 18 tháng', 48000000.00, 0, 1, 914, 'https://placehold.co/600x600/e67e22/fff?text=A7IV', 'active', '2026-01-13 17:01:28', 'like_new');
INSERT INTO `products` VALUES (50, 1, 40, 'Canon EOS R6 Mark II', 'Canon R6 Mark II, 24.2MP, quay 4K 60fps, fullbox', 55000000.00, 0, 1, 951, 'https://placehold.co/600x600/d35400/fff?text=R6II', 'active', '2025-12-27 17:01:28', 'new');
INSERT INTO `products` VALUES (51, 1, 40, 'Nikon Z8 Body', 'Nikon Z8 45.7MP, quay 8K, sensor full-frame', 95000000.00, 0, 1, 12, 'https://placehold.co/600x600/f1c40f/fff?text=Z8', 'active', '2026-01-04 17:01:28', 'new');
INSERT INTO `products` VALUES (52, 1, 40, 'Fujifilm X-T5 Kit 18-55mm', 'Fujifilm X-T5 màu bạc, kèm lens 18-55mm f/2.8-4', 42000000.00, 0, 2, 208, 'https://placehold.co/600x600/1abc9c/fff?text=XT5', 'active', '2026-01-06 17:01:28', 'like_new');
INSERT INTO `products` VALUES (53, 1, 40, 'GoPro Hero 12 Black', 'GoPro Hero 12, chống nước 10m, quay 5.3K', 12000000.00, 1, 5, 4, 'https://placehold.co/600x600/3498db/fff?text=GoPro12', 'active', '2026-01-22 17:01:28', 'new');
INSERT INTO `products` VALUES (54, 1, 40, 'DJI Osmo Pocket 3', 'DJI Pocket 3 Creator Combo, gimbal 3 trục, 4K/120fps', 15000000.00, 1, 3, 399, 'https://placehold.co/600x600/9b59b6/fff?text=Pocket3', 'active', '2026-01-06 17:01:28', 'new');
INSERT INTO `products` VALUES (55, 1, 40, 'Sony ZV-E10 Vlog Camera', 'Sony ZV-E10, lens 16-50mm, chuyên quay vlog', 18000000.00, 0, 2, 982, 'https://placehold.co/600x600/e74c3c/fff?text=ZVE10', 'active', '2025-12-30 17:01:28', 'good');
INSERT INTO `products` VALUES (56, 1, 41, 'Apple Watch Ultra 2', 'Apple Watch Ultra 2, GPS + Cellular, Titanium', 22000000.00, 0, 2, 714, 'https://placehold.co/600x600/f39c12/fff?text=WatchU2', 'active', '2026-01-12 17:01:28', 'new');
INSERT INTO `products` VALUES (57, 1, 41, 'Samsung Galaxy Watch 6 Classic', 'Galaxy Watch 6 Classic 47mm, màu bạc, dây da', 9500000.00, 1, 3, 624, 'https://placehold.co/600x600/2ecc71/fff?text=GW6', 'active', '2026-01-06 17:01:28', 'like_new');
INSERT INTO `products` VALUES (58, 1, 41, 'Garmin Fenix 7X Solar', 'Garmin Fenix 7X Sapphire Solar, bản đồ VN, pin 28 ngày', 25000000.00, 0, 1, 980, 'https://placehold.co/600x600/27ae60/fff?text=Fenix7', 'active', '2026-01-01 17:01:28', 'like_new');
INSERT INTO `products` VALUES (59, 1, 41, 'Rolex Submariner Date', 'Rolex Submariner 126610LN, mặt đen, fullset 2023', 350000000.00, 0, 1, 27, 'https://placehold.co/600x600/34495e/fff?text=Rolex', 'active', '2026-01-20 17:01:28', 'like_new');
INSERT INTO `products` VALUES (60, 1, 41, 'Omega Seamaster 300M', 'Omega Seamaster Diver 300M, mặt xanh, dây kim loại', 120000000.00, 0, 1, 196, 'https://placehold.co/600x600/7f8c8d/fff?text=Omega', 'active', '2026-01-11 17:01:28', 'good');
INSERT INTO `products` VALUES (61, 1, 41, 'Casio G-Shock GA-2100', 'G-Shock CasiOak GA-2100-1A1, màu đen, mới 100%', 3500000.00, 1, 8, 900, 'https://placehold.co/600x600/bdc3c7/fff?text=GShock', 'active', '2025-12-30 17:01:28', 'new');
INSERT INTO `products` VALUES (62, 1, 41, 'Tissot PRX Powermatic 80', 'Tissot PRX tự động, mặt xanh, kính sapphire', 18000000.00, 0, 2, 913, 'https://placehold.co/600x600/2980b9/fff?text=Tissot', 'active', '2025-12-27 17:01:28', 'new');
INSERT INTO `products` VALUES (63, 1, 42, 'Nike Air Jordan 1 Retro High', 'Jordan 1 Chicago, size 42, DS chưa qua sử dụng', 8500000.00, 0, 2, 865, 'https://placehold.co/600x600/c0392b/fff?text=AJ1', 'active', '2026-01-18 17:01:28', 'new');
INSERT INTO `products` VALUES (64, 1, 42, 'Adidas Yeezy Boost 350 V2', 'Yeezy 350 Zebra, size 43, fullbox', 6500000.00, 1, 3, 586, 'https://placehold.co/600x600/8e44ad/fff?text=Yeezy350', 'active', '2026-01-17 17:01:28', 'new');
INSERT INTO `products` VALUES (65, 1, 42, 'Nike Air Force 1 Low White', 'AF1 trắng, size 41, mới 99%, đi 2 lần', 2800000.00, 1, 4, 336, 'https://placehold.co/600x600/ecf0f1/333?text=AF1', 'active', '2026-01-03 17:01:28', 'like_new');
INSERT INTO `products` VALUES (66, 1, 42, 'New Balance 550', 'NB 550 trắng xanh, size 42.5, authentic', 3500000.00, 1, 5, 924, 'https://placehold.co/600x600/16a085/fff?text=NB550', 'active', '2026-01-01 17:01:28', 'new');
INSERT INTO `products` VALUES (67, 1, 42, 'Converse Chuck 70 High', 'Converse Chuck 70 đen, size 40, classic', 1800000.00, 1, 6, 610, 'https://placehold.co/600x600/2c3e50/fff?text=Chuck70', 'active', '2025-12-31 17:01:28', 'good');
INSERT INTO `products` VALUES (68, 1, 42, 'Vans Old Skool', 'Vans Old Skool đen trắng, size 41, mới 100%', 1500000.00, 1, 8, 279, 'https://placehold.co/600x600/1a1a1a/fff?text=VansOS', 'active', '2025-12-31 17:01:28', 'new');
INSERT INTO `products` VALUES (69, 1, 42, 'Dép Birkenstock Arizona', 'Birkenstock Arizona da thật, size 42, màu nâu', 2800000.00, 0, 3, 566, 'https://placehold.co/600x600/8b4513/fff?text=Birken', 'active', '2026-01-04 17:01:28', 'new');
INSERT INTO `products` VALUES (70, 1, 43, 'Louis Vuitton Neverfull MM', 'LV Neverfull MM Monogram, fullset, date code 2023', 45000000.00, 0, 1, 988, 'https://placehold.co/600x600/d4a574/fff?text=LVNever', 'active', '2026-01-24 17:01:28', 'like_new');
INSERT INTO `products` VALUES (71, 1, 43, 'Gucci GG Marmont', 'Gucci Marmont mini, màu đen, da thật, có hóa đơn', 38000000.00, 0, 1, 245, 'https://placehold.co/600x600/1a1a1a/fff?text=Gucci', 'active', '2026-01-24 17:01:28', 'like_new');
INSERT INTO `products` VALUES (72, 1, 43, 'Coach Tabby 26', 'Coach Tabby màu kem, da bê, mới 95%', 8500000.00, 0, 2, 263, 'https://placehold.co/600x600/f5deb3/333?text=Coach', 'active', '2026-01-21 17:01:28', 'good');
INSERT INTO `products` VALUES (73, 1, 43, 'Ví Montblanc Meisterstück', 'Montblanc Meisterstück 6cc, da bê đen, fullbox', 12000000.00, 0, 2, 579, 'https://placehold.co/600x600/2c3e50/fff?text=MB', 'active', '2026-01-07 17:01:28', 'new');
INSERT INTO `products` VALUES (74, 1, 43, 'Balo Peak Design Everyday', 'Peak Design Everyday V2 30L, màu đen, cho nhiếp ảnh', 7500000.00, 0, 3, 109, 'https://placehold.co/600x600/34495e/fff?text=PD30L', 'active', '2026-01-05 17:01:28', 'like_new');
INSERT INTO `products` VALUES (75, 1, 43, 'Túi đeo chéo Uniqlo', 'Túi Uniqlo mini, màu đen, chống nước', 450000.00, 1, 10, 802, 'https://placehold.co/600x600/7f8c8d/fff?text=Uniqlo', 'active', '2026-01-12 17:01:28', 'new');
INSERT INTO `products` VALUES (76, 1, 44, 'Robot hút bụi Roborock S8 Pro', 'Roborock S8 Pro Ultra, tự giặt giẻ, sấy nóng', 32000000.00, 0, 2, 686, 'https://placehold.co/600x600/3498db/fff?text=S8Pro', 'active', '2026-01-19 17:01:28', 'new');
INSERT INTO `products` VALUES (77, 1, 44, 'Máy lọc không khí Xiaomi 4 Pro', 'Xiaomi Air Purifier 4 Pro, lọc HEPA, 60m²', 5500000.00, 1, 5, 27, 'https://placehold.co/600x600/ecf0f1/333?text=AirPuri', 'active', '2026-01-04 17:01:28', 'new');
INSERT INTO `products` VALUES (78, 1, 44, 'Nồi chiên không dầu Philips', 'Philips Airfryer XXL, 7.3L, màn cảm ứng', 8500000.00, 0, 3, 78, 'https://placehold.co/600x600/1a1a1a/fff?text=Airfryer', 'active', '2025-12-28 17:01:28', 'like_new');
INSERT INTO `products` VALUES (79, 1, 44, 'Máy pha cà phê DeLonghi', 'DeLonghi Magnifica S, tự động, xay hạt', 15000000.00, 0, 2, 306, 'https://placehold.co/600x600/6f4e37/fff?text=DeLonghi', 'active', '2026-01-05 17:01:28', 'good');
INSERT INTO `products` VALUES (80, 1, 44, 'Quạt không cánh Dyson', 'Dyson Pure Cool TP07, lọc không khí, điều khiển app', 18000000.00, 0, 1, 299, 'https://placehold.co/600x600/9b59b6/fff?text=Dyson', 'active', '2026-01-12 17:01:28', 'like_new');
INSERT INTO `products` VALUES (81, 1, 44, 'Máy xay sinh tố Vitamix', 'Vitamix E310, 1400W, xay mịn, nhập Mỹ', 12000000.00, 0, 2, 577, 'https://placehold.co/600x600/e74c3c/fff?text=Vitamix', 'active', '2026-01-18 17:01:28', 'new');
INSERT INTO `products` VALUES (82, 1, 44, 'Bộ chăn ga gối Everon', 'Everon cotton lụa, size 1m8, màu xám', 2500000.00, 1, 5, 987, 'https://placehold.co/600x600/bdc3c7/333?text=Everon', 'active', '2025-12-31 17:01:28', 'new');
INSERT INTO `products` VALUES (83, 1, 45, 'Xe đạp Giant Escape 3', 'Giant Escape 3 2024, size M, màu đen, còn mới', 9500000.00, 0, 2, 207, 'https://placehold.co/600x600/2ecc71/fff?text=Giant', 'active', '2026-01-09 17:01:28', 'like_new');
INSERT INTO `products` VALUES (84, 1, 45, 'Vợt tennis Wilson Pro Staff', 'Wilson Pro Staff 97, 315g, grip size 3', 5500000.00, 0, 3, 73, 'https://placehold.co/600x600/e74c3c/fff?text=Wilson', 'active', '2026-01-22 17:01:28', 'good');
INSERT INTO `products` VALUES (85, 1, 45, 'Bộ gậy golf Callaway', 'Callaway Paradym, bộ 12 gậy, túi da, fullset', 85000000.00, 0, 1, 746, 'https://placehold.co/600x600/27ae60/fff?text=Callaway', 'active', '2026-01-24 17:01:28', 'like_new');
INSERT INTO `products` VALUES (86, 1, 45, 'Giày chạy bộ Nike Vaporfly', 'Nike Vaporfly 3, size 42, màu trắng xanh', 6500000.00, 0, 2, 509, 'https://placehold.co/600x600/3498db/fff?text=Vaporfly', 'active', '2025-12-31 17:01:28', 'new');
INSERT INTO `products` VALUES (87, 1, 45, 'Vali Rimowa Original', 'Rimowa Original Cabin, nhôm, 21 inch', 35000000.00, 0, 1, 309, 'https://placehold.co/600x600/bdc3c7/333?text=Rimowa', 'active', '2026-01-24 17:01:28', 'like_new');
INSERT INTO `products` VALUES (88, 1, 45, 'Lều cắm trại Naturehike', 'Naturehike Cloud Up 2, 2 người, siêu nhẹ 1.8kg', 3500000.00, 1, 4, 17, 'https://placehold.co/600x600/f39c12/fff?text=Tent', 'active', '2026-01-04 17:01:28', 'new');
INSERT INTO `products` VALUES (89, 1, 45, 'Đồng hồ Garmin Forerunner 265', 'Garmin FR265, GPS, đo nhịp tim, pin 13 ngày', 12000000.00, 0, 2, 160, 'https://placehold.co/600x600/1abc9c/fff?text=FR265', 'active', '2026-01-13 17:01:28', 'new');
INSERT INTO `products` VALUES (90, 1, 46, 'Son Dior Rouge 999', 'Dior Rouge Dior 999 Matte, fullsize, seal', 1200000.00, 1, 8, 750, 'https://placehold.co/600x600/c0392b/fff?text=Dior999', 'active', '2026-01-25 17:01:28', 'new');
INSERT INTO `products` VALUES (91, 1, 46, 'Nước hoa Chanel No.5', 'Chanel No.5 EDP 100ml, fullbox, date 2024', 4500000.00, 0, 3, 272, 'https://placehold.co/600x600/f5deb3/333?text=No5', 'active', '2026-01-01 17:01:28', 'new');
INSERT INTO `products` VALUES (92, 1, 46, 'Kem chống nắng Anessa', 'Anessa Perfect UV 60ml, SPF50+, Nhật Bản', 650000.00, 1, 15, 109, 'https://placehold.co/600x600/f1c40f/fff?text=Anessa', 'active', '2025-12-28 17:01:28', 'new');
INSERT INTO `products` VALUES (93, 1, 46, 'Máy rửa mặt Foreo Luna', 'Foreo Luna 3, màu hồng, cho da nhạy cảm', 4500000.00, 0, 4, 727, 'https://placehold.co/600x600/ff69b4/fff?text=Luna3', 'active', '2026-01-15 17:01:28', 'like_new');
INSERT INTO `products` VALUES (94, 1, 46, 'Serum The Ordinary Niacinamide', 'The Ordinary Niacinamide 10% 30ml, date 2025', 280000.00, 1, 20, 312, 'https://placehold.co/600x600/7f8c8d/fff?text=Ordinary', 'active', '2025-12-29 17:01:28', 'new');
INSERT INTO `products` VALUES (95, 1, 46, 'Phấn nước Laneige', 'Laneige Neo Cushion Matte, tone 21N, mới 100%', 1100000.00, 1, 6, 377, 'https://placehold.co/600x600/3498db/fff?text=Laneige', 'active', '2026-01-12 17:01:28', 'new');
INSERT INTO `products` VALUES (96, 1, 46, 'Bộ cọ trang điểm Sigma', 'Sigma Essential Kit, 12 cọ, lông tự nhiên', 3500000.00, 0, 3, 952, 'https://placehold.co/600x600/9b59b6/fff?text=Sigma', 'active', '2026-01-09 17:01:28', 'new');
INSERT INTO `products` VALUES (97, 1, 47, 'Máy chạy bộ Kingsport', 'Kingsport G6, 3.5HP, màn LCD, đến 16km/h', 18000000.00, 0, 2, 626, 'https://placehold.co/600x600/e74c3c/fff?text=Treadmill', 'active', '2026-01-14 17:01:28', 'like_new');
INSERT INTO `products` VALUES (98, 1, 47, 'Ghế massage Ogawa', 'Ogawa Master Drive AI, full body, zero gravity', 120000000.00, 0, 1, 278, 'https://placehold.co/600x600/8e44ad/fff?text=Massage', 'active', '2026-01-19 17:01:28', 'good');
INSERT INTO `products` VALUES (99, 1, 47, 'Máy đo huyết áp Omron', 'Omron HEM-7156, tự động, lưu 60 kết quả', 1800000.00, 1, 5, 511, 'https://placehold.co/600x600/ecf0f1/333?text=Omron', 'active', '2025-12-28 17:01:28', 'new');
INSERT INTO `products` VALUES (100, 1, 47, 'Whey Protein Optimum Nutrition', 'ON Gold Standard 100% Whey, 2.27kg, vị Chocolate', 1800000.00, 1, 8, 722, 'https://placehold.co/600x600/8b4513/fff?text=Whey', 'active', '2026-01-21 17:01:28', 'new');
INSERT INTO `products` VALUES (101, 1, 47, 'Vitamin tổng hợp Centrum', 'Centrum Adults 50+, 200 viên, date 2026', 850000.00, 1, 10, 76, 'https://placehold.co/600x600/f39c12/fff?text=Centrum', 'active', '2025-12-30 17:01:28', 'new');
INSERT INTO `products` VALUES (102, 1, 47, 'Dầu cá Omega-3 Kirkland', 'Kirkland Fish Oil 1000mg, 400 viên, Mỹ', 650000.00, 1, 12, 214, 'https://placehold.co/600x600/3498db/fff?text=Omega3', 'active', '2025-12-28 17:01:28', 'new');
INSERT INTO `products` VALUES (103, 1, 48, 'Xe đẩy Combi', 'Combi Mechacal Handy, siêu nhẹ 4.5kg, Nhật', 8500000.00, 0, 2, 844, 'https://placehold.co/600x600/ff69b4/fff?text=Combi', 'active', '2026-01-22 17:01:28', 'like_new');
INSERT INTO `products` VALUES (104, 1, 48, 'Ghế ngồi ô tô Joie', 'Joie Every Stage FX, 0-12 tuổi, xoay 360°', 9500000.00, 0, 2, 578, 'https://placehold.co/600x600/2ecc71/fff?text=Joie', 'active', '2026-01-03 17:01:28', 'good');
INSERT INTO `products` VALUES (105, 1, 48, 'Máy hút sữa Medela', 'Medela Swing Maxi, đôi, không dây, mới 100%', 8500000.00, 0, 3, 361, 'https://placehold.co/600x600/3498db/fff?text=Medela', 'active', '2026-01-13 17:01:28', 'new');
INSERT INTO `products` VALUES (106, 1, 48, 'Bỉm Merries size L', 'Merries tape L54, thùng 4 bịch, date mới', 1200000.00, 1, 15, 68, 'https://placehold.co/600x600/87ceeb/333?text=Merries', 'active', '2025-12-31 17:01:28', 'new');
INSERT INTO `products` VALUES (107, 1, 48, 'Sữa Aptamil số 2', 'Aptamil Profutura 2, 800g, Đức, date 2026', 750000.00, 1, 10, 258, 'https://placehold.co/600x600/1abc9c/fff?text=Aptamil', 'active', '2025-12-28 17:01:28', 'new');
INSERT INTO `products` VALUES (108, 1, 48, 'Địu em bé Ergobaby', 'Ergobaby Omni 360, màu xám, 4 tư thế địu', 4500000.00, 0, 3, 86, 'https://placehold.co/600x600/7f8c8d/fff?text=Ergo', 'active', '2026-01-19 17:01:28', 'like_new');
INSERT INTO `products` VALUES (109, 1, 48, 'Bình sữa Comotomo', 'Comotomo 250ml, silicone, set 2 bình', 850000.00, 1, 8, 659, 'https://placehold.co/600x600/27ae60/fff?text=Comotomo', 'active', '2026-01-18 17:01:28', 'new');
INSERT INTO `products` VALUES (110, 1, 49, 'Xe máy Honda SH 350i', 'SH 350i 2024, màu đen, ODO 500km, fullbox', 185000000.00, 0, 1, 38, 'https://placehold.co/600x600/1a1a1a/fff?text=SH350', 'active', '2026-01-08 17:01:28', 'like_new');
INSERT INTO `products` VALUES (111, 1, 49, 'Xe máy Vespa GTS 300', 'Vespa GTS 300 SuperTech, đỏ Racing, ODO 2000km', 145000000.00, 0, 1, 211, 'https://placehold.co/600x600/c0392b/fff?text=Vespa', 'active', '2026-01-22 17:01:28', 'good');
INSERT INTO `products` VALUES (112, 1, 49, 'Mũ bảo hiểm Arai', 'Arai RX-7V Evo, size L, màu trắng, ECE 22.06', 18000000.00, 0, 2, 944, 'https://placehold.co/600x600/ecf0f1/333?text=Arai', 'active', '2025-12-31 17:01:28', 'new');
INSERT INTO `products` VALUES (113, 1, 49, 'Áo giáp Dainese', 'Dainese Racing 3 Leather, size 50, đen đỏ', 25000000.00, 0, 1, 88, 'https://placehold.co/600x600/e74c3c/fff?text=Dainese', 'active', '2025-12-28 17:01:28', 'like_new');
INSERT INTO `products` VALUES (114, 1, 49, 'Camera hành trình Xiaomi', 'Xiaomi 70mai A800S 4K, GPS, đêm rõ nét', 2500000.00, 1, 5, 608, 'https://placehold.co/600x600/2c3e50/fff?text=70mai', 'active', '2026-01-18 17:01:28', 'new');
INSERT INTO `products` VALUES (115, 1, 49, 'Lốp xe Michelin', 'Michelin Pilot Street 2, 120/70-17, mới 100%', 1200000.00, 1, 6, 776, 'https://placehold.co/600x600/f39c12/fff?text=Michelin', 'active', '2026-01-16 17:01:28', 'new');
INSERT INTO `products` VALUES (116, 1, 50, 'Thức ăn Royal Canin', 'Royal Canin Maxi Adult 15kg, date 2026', 1650000.00, 1, 8, 55, 'https://placehold.co/600x600/8e44ad/fff?text=RoyalC', 'active', '2026-01-01 17:01:28', 'new');
INSERT INTO `products` VALUES (117, 1, 50, 'Chuồng mèo 3 tầng', 'Chuồng inox 3 tầng, 90x60x150cm, mới 100%', 3500000.00, 0, 3, 948, 'https://placehold.co/600x600/bdc3c7/333?text=CatCage', 'active', '2026-01-19 17:01:28', 'new');
INSERT INTO `products` VALUES (118, 1, 50, 'Máy lọc nước cho mèo', 'Petkit Eversweet 3 Pro, 1.8L, tự tuần hoàn', 1800000.00, 1, 4, 574, 'https://placehold.co/600x600/3498db/fff?text=Petkit', 'active', '2026-01-07 17:01:28', 'new');
INSERT INTO `products` VALUES (119, 1, 50, 'Cát vệ sinh Tofu', 'Cát đậu phụ Kit Cat, 6L, không bụi, xả toilet', 180000.00, 1, 30, 27, 'https://placehold.co/600x600/f5deb3/333?text=Tofu', 'active', '2026-01-13 17:01:28', 'new');
INSERT INTO `products` VALUES (120, 1, 50, 'Dây dắt chó tự cuộn', 'Flexi Giant L, 8m, cho chó đến 50kg', 850000.00, 1, 5, 413, 'https://placehold.co/600x600/e74c3c/fff?text=Flexi', 'active', '2026-01-17 17:01:28', 'new');
INSERT INTO `products` VALUES (121, 1, 50, 'Balo phi hành gia cho mèo', 'Balo trong suốt, có quạt, cho mèo đến 6kg', 650000.00, 1, 6, 985, 'https://placehold.co/600x600/9b59b6/fff?text=CatBag', 'active', '2026-01-20 17:01:28', 'new');
INSERT INTO `products` VALUES (122, 1, 51, 'AirPods Pro 2', 'Apple AirPods Pro 2 USB-C, ANC, mới seal', 5800000.00, 1, 5, 688, 'https://placehold.co/600x600/ecf0f1/333?text=AirPods', 'active', '2026-01-22 17:01:28', 'new');
INSERT INTO `products` VALUES (123, 1, 51, 'Sony WH-1000XM5', 'Sony XM5, màu đen, ANC, pin 30h, fullbox', 7500000.00, 0, 3, 486, 'https://placehold.co/600x600/2c3e50/fff?text=XM5', 'active', '2025-12-29 17:01:28', 'like_new');
INSERT INTO `products` VALUES (124, 1, 51, 'Loa JBL Partybox 310', 'JBL Partybox 310, 240W, đèn LED, có mic', 12000000.00, 0, 2, 367, 'https://placehold.co/600x600/e67e22/fff?text=JBL310', 'active', '2026-01-19 17:01:28', 'good');
INSERT INTO `products` VALUES (125, 1, 51, 'Marshall Stanmore III', 'Marshall Stanmore III, Bluetooth 5.2, màu đen', 12500000.00, 0, 2, 378, 'https://placehold.co/600x600/1a1a1a/fff?text=Marshall', 'active', '2026-01-13 17:01:28', 'new');
INSERT INTO `products` VALUES (126, 1, 51, 'Bose SoundLink Flex', 'Bose Flex, chống nước IP67, màu xanh', 3500000.00, 1, 4, 790, 'https://placehold.co/600x600/3498db/fff?text=BoseFlex', 'active', '2026-01-13 17:01:28', 'new');
INSERT INTO `products` VALUES (127, 1, 51, 'Tai nghe Sennheiser HD 660S', 'Sennheiser HD 660S2, over-ear, audiophile', 15000000.00, 0, 1, 817, 'https://placehold.co/600x600/7f8c8d/fff?text=HD660S', 'active', '2026-01-01 17:01:28', 'like_new');
INSERT INTO `products` VALUES (128, 1, 51, 'DAC/AMP FiiO K7', 'FiiO K7, desktop DAC, THX AAA, 4.4mm balanced', 6500000.00, 0, 2, 714, 'https://placehold.co/600x600/2ecc71/fff?text=FiiOK7', 'active', '2026-01-01 17:01:28', 'new');
INSERT INTO `products` VALUES (129, 1, 51, 'Loa soundbar Samsung Q990C', 'Samsung Q990C 11.1.4ch, Dolby Atmos, sub không dây', 35000000.00, 0, 1, 119, 'https://placehold.co/600x600/1abc9c/fff?text=Q990C', 'active', '2026-01-07 17:01:28', 'new');
INSERT INTO `products` VALUES (130, 11, 37, 'Ảnh full hd', '\n\nTình trạng: Mới 100%', 2000.00, 0, 10, 0, 'products/1769361833_0_screenshot_2025-11-17_230104.png', 'active', '2026-01-25 17:23:53', 'new');

SET FOREIGN_KEY_CHECKS = 1;
