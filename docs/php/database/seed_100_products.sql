-- =====================================================
-- ZOLDIFY - SEED 100 SẢN PHẨM TEST
-- Mỗi sản phẩm có ảnh placeholder và phù hợp danh mục
-- =====================================================

SET FOREIGN_KEY_CHECKS = 0;
SET NAMES utf8mb4;

-- Đảm bảo có ít nhất 1 user seller để gán sản phẩm
INSERT IGNORE INTO users (id, full_name, email, password, role, email_verified)
VALUES (1, 'Test Seller', 'seller@test.com', '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'seller', 1);

-- Đảm bảo có các categories cần thiết
INSERT IGNORE INTO categories (id, name, icon, parent_id) VALUES
(1, 'Điện thoại', 'fa-mobile-screen', NULL),
(2, 'Laptop', 'fa-laptop', NULL),
(3, 'Máy ảnh', 'fa-camera', NULL),
(4, 'Đồng hồ', 'fa-clock', NULL),
(5, 'Giày dép', 'fa-shoe-prints', NULL),
(6, 'Túi xách & Ví', 'fa-bag-shopping', NULL),
(7, 'Nhà cửa & Đời sống', 'fa-house', NULL),
(8, 'Thể thao & Du lịch', 'fa-dumbbell', NULL),
(9, 'Sắc đẹp', 'fa-spa', NULL),
(10, 'Sức khỏe', 'fa-heart-pulse', NULL),
(11, 'Mẹ & Bé', 'fa-baby', NULL),
(12, 'Xe cộ', 'fa-motorcycle', NULL),
(13, 'Thú cưng', 'fa-paw', NULL),
(14, 'Âm thanh', 'fa-headphones', NULL);

-- =====================================================
-- INSERT 100 SẢN PHẨM
-- =====================================================

INSERT INTO products (user_id, category_id, name, description, price, quantity, status, product_condition, image, is_freeship, view_count) VALUES

-- ===================== ĐIỆN THOẠI (category_id = 1) =====================
(1, 1, 'iPhone 15 Pro Max 256GB', 'iPhone 15 Pro Max chính hãng, còn bảo hành 10 tháng, fullbox', 28500000, 3, 'active', 'like_new', 'https://placehold.co/600x600/3498db/fff?text=iPhone15', 0, FLOOR(RAND()*1000)),
(1, 1, 'iPhone 14 Pro 128GB Tím', 'Máy đẹp 99%, pin 92%, không trầy xước', 22000000, 2, 'active', 'like_new', 'https://placehold.co/600x600/9b59b6/fff?text=iPhone14', 1, FLOOR(RAND()*1000)),
(1, 1, 'Samsung Galaxy S24 Ultra', 'Galaxy S24 Ultra 512GB, Titanium Gray, mới 100%', 32000000, 1, 'active', 'new', 'https://placehold.co/600x600/1abc9c/fff?text=S24Ultra', 0, FLOOR(RAND()*1000)),
(1, 1, 'Samsung Galaxy Z Fold 5', 'Z Fold 5 256GB, màu kem, đã qua sử dụng 3 tháng', 35000000, 1, 'active', 'like_new', 'https://placehold.co/600x600/e74c3c/fff?text=ZFold5', 0, FLOOR(RAND()*1000)),
(1, 1, 'Xiaomi 14 Pro 512GB', 'Xiaomi 14 Pro bản China, đã unlock, còn BH 6 tháng', 18500000, 2, 'active', 'good', 'https://placehold.co/600x600/f39c12/fff?text=Xiaomi14', 1, FLOOR(RAND()*1000)),
(1, 1, 'OPPO Find X7 Ultra', 'Find X7 Ultra, camera Hasselblad, pin 5000mAh', 24000000, 1, 'active', 'new', 'https://placehold.co/600x600/2ecc71/fff?text=FindX7', 0, FLOOR(RAND()*1000)),
(1, 1, 'iPhone 13 128GB Xanh', 'iPhone 13 xanh lá, máy Việt Nam, còn BH Apple Care', 15500000, 4, 'active', 'good', 'https://placehold.co/600x600/27ae60/fff?text=iPhone13', 1, FLOOR(RAND()*1000)),
(1, 1, 'Google Pixel 8 Pro', 'Pixel 8 Pro 256GB, màu Obsidian, mới seal', 21000000, 2, 'active', 'new', 'https://placehold.co/600x600/34495e/fff?text=Pixel8', 0, FLOOR(RAND()*1000)),

-- ===================== LAPTOP (category_id = 2) =====================
(1, 2, 'MacBook Pro M3 Max 16 inch', 'MacBook Pro M3 Max, 36GB RAM, 1TB SSD, màu Space Black', 85000000, 1, 'active', 'new', 'https://placehold.co/600x600/7f8c8d/fff?text=MacBookM3', 0, FLOOR(RAND()*1000)),
(1, 2, 'MacBook Air M2 15 inch', 'MacBook Air M2, 8GB RAM, 256GB, màu Starlight, fullbox', 32000000, 2, 'active', 'like_new', 'https://placehold.co/600x600/bdc3c7/fff?text=AirM2', 1, FLOOR(RAND()*1000)),
(1, 2, 'Dell XPS 15 2024', 'Dell XPS 15, Core i7-13700H, RTX 4060, 32GB RAM', 45000000, 1, 'active', 'new', 'https://placehold.co/600x600/2980b9/fff?text=XPS15', 0, FLOOR(RAND()*1000)),
(1, 2, 'ThinkPad X1 Carbon Gen 11', 'Lenovo ThinkPad X1 Carbon, i7, 16GB, 512GB, màn 2K', 38000000, 1, 'active', 'like_new', 'https://placehold.co/600x600/c0392b/fff?text=X1Carbon', 0, FLOOR(RAND()*1000)),
(1, 2, 'ASUS ROG Strix G16', 'ROG Strix G16, i9-13980HX, RTX 4080, 32GB, chuyên gaming', 55000000, 1, 'active', 'new', 'https://placehold.co/600x600/8e44ad/fff?text=ROGStrix', 0, FLOOR(RAND()*1000)),
(1, 2, 'HP Spectre x360', 'HP Spectre x360 14, OLED, i7, 16GB RAM, màn cảm ứng', 35000000, 2, 'active', 'good', 'https://placehold.co/600x600/16a085/fff?text=Spectre', 1, FLOOR(RAND()*1000)),
(1, 2, 'Surface Laptop 5', 'Microsoft Surface Laptop 5, 13.5 inch, i5, 8GB RAM', 28000000, 3, 'active', 'like_new', 'https://placehold.co/600x600/2c3e50/fff?text=Surface5', 0, FLOOR(RAND()*1000)),

-- ===================== MÁY ẢNH (category_id = 3) =====================
(1, 3, 'Sony A7 IV Body', 'Sony Alpha 7 IV body, 33MP, ít chụp, còn BH 18 tháng', 48000000, 1, 'active', 'like_new', 'https://placehold.co/600x600/e67e22/fff?text=A7IV', 0, FLOOR(RAND()*1000)),
(1, 3, 'Canon EOS R6 Mark II', 'Canon R6 Mark II, 24.2MP, quay 4K 60fps, fullbox', 55000000, 1, 'active', 'new', 'https://placehold.co/600x600/d35400/fff?text=R6II', 0, FLOOR(RAND()*1000)),
(1, 3, 'Nikon Z8 Body', 'Nikon Z8 45.7MP, quay 8K, sensor full-frame', 95000000, 1, 'active', 'new', 'https://placehold.co/600x600/f1c40f/fff?text=Z8', 0, FLOOR(RAND()*1000)),
(1, 3, 'Fujifilm X-T5 Kit 18-55mm', 'Fujifilm X-T5 màu bạc, kèm lens 18-55mm f/2.8-4', 42000000, 2, 'active', 'like_new', 'https://placehold.co/600x600/1abc9c/fff?text=XT5', 0, FLOOR(RAND()*1000)),
(1, 3, 'GoPro Hero 12 Black', 'GoPro Hero 12, chống nước 10m, quay 5.3K', 12000000, 5, 'active', 'new', 'https://placehold.co/600x600/3498db/fff?text=GoPro12', 1, FLOOR(RAND()*1000)),
(1, 3, 'DJI Osmo Pocket 3', 'DJI Pocket 3 Creator Combo, gimbal 3 trục, 4K/120fps', 15000000, 3, 'active', 'new', 'https://placehold.co/600x600/9b59b6/fff?text=Pocket3', 1, FLOOR(RAND()*1000)),
(1, 3, 'Sony ZV-E10 Vlog Camera', 'Sony ZV-E10, lens 16-50mm, chuyên quay vlog', 18000000, 2, 'active', 'good', 'https://placehold.co/600x600/e74c3c/fff?text=ZVE10', 0, FLOOR(RAND()*1000)),

-- ===================== ĐỒNG HỒ (category_id = 4) =====================
(1, 4, 'Apple Watch Ultra 2', 'Apple Watch Ultra 2, GPS + Cellular, Titanium', 22000000, 2, 'active', 'new', 'https://placehold.co/600x600/f39c12/fff?text=WatchU2', 0, FLOOR(RAND()*1000)),
(1, 4, 'Samsung Galaxy Watch 6 Classic', 'Galaxy Watch 6 Classic 47mm, màu bạc, dây da', 9500000, 3, 'active', 'like_new', 'https://placehold.co/600x600/2ecc71/fff?text=GW6', 1, FLOOR(RAND()*1000)),
(1, 4, 'Garmin Fenix 7X Solar', 'Garmin Fenix 7X Sapphire Solar, bản đồ VN, pin 28 ngày', 25000000, 1, 'active', 'like_new', 'https://placehold.co/600x600/27ae60/fff?text=Fenix7', 0, FLOOR(RAND()*1000)),
(1, 4, 'Rolex Submariner Date', 'Rolex Submariner 126610LN, mặt đen, fullset 2023', 350000000, 1, 'active', 'like_new', 'https://placehold.co/600x600/34495e/fff?text=Rolex', 0, FLOOR(RAND()*1000)),
(1, 4, 'Omega Seamaster 300M', 'Omega Seamaster Diver 300M, mặt xanh, dây kim loại', 120000000, 1, 'active', 'good', 'https://placehold.co/600x600/7f8c8d/fff?text=Omega', 0, FLOOR(RAND()*1000)),
(1, 4, 'Casio G-Shock GA-2100', 'G-Shock CasiOak GA-2100-1A1, màu đen, mới 100%', 3500000, 8, 'active', 'new', 'https://placehold.co/600x600/bdc3c7/fff?text=GShock', 1, FLOOR(RAND()*1000)),
(1, 4, 'Tissot PRX Powermatic 80', 'Tissot PRX tự động, mặt xanh, kính sapphire', 18000000, 2, 'active', 'new', 'https://placehold.co/600x600/2980b9/fff?text=Tissot', 0, FLOOR(RAND()*1000)),

-- ===================== GIÀY DÉP (category_id = 5) =====================
(1, 5, 'Nike Air Jordan 1 Retro High', 'Jordan 1 Chicago, size 42, DS chưa qua sử dụng', 8500000, 2, 'active', 'new', 'https://placehold.co/600x600/c0392b/fff?text=AJ1', 0, FLOOR(RAND()*1000)),
(1, 5, 'Adidas Yeezy Boost 350 V2', 'Yeezy 350 Zebra, size 43, fullbox', 6500000, 3, 'active', 'new', 'https://placehold.co/600x600/8e44ad/fff?text=Yeezy350', 1, FLOOR(RAND()*1000)),
(1, 5, 'Nike Air Force 1 Low White', 'AF1 trắng, size 41, mới 99%, đi 2 lần', 2800000, 4, 'active', 'like_new', 'https://placehold.co/600x600/ecf0f1/333?text=AF1', 1, FLOOR(RAND()*1000)),
(1, 5, 'New Balance 550', 'NB 550 trắng xanh, size 42.5, authentic', 3500000, 5, 'active', 'new', 'https://placehold.co/600x600/16a085/fff?text=NB550', 1, FLOOR(RAND()*1000)),
(1, 5, 'Converse Chuck 70 High', 'Converse Chuck 70 đen, size 40, classic', 1800000, 6, 'active', 'good', 'https://placehold.co/600x600/2c3e50/fff?text=Chuck70', 1, FLOOR(RAND()*1000)),
(1, 5, 'Vans Old Skool', 'Vans Old Skool đen trắng, size 41, mới 100%', 1500000, 8, 'active', 'new', 'https://placehold.co/600x600/1a1a1a/fff?text=VansOS', 1, FLOOR(RAND()*1000)),
(1, 5, 'Dép Birkenstock Arizona', 'Birkenstock Arizona da thật, size 42, màu nâu', 2800000, 3, 'active', 'new', 'https://placehold.co/600x600/8b4513/fff?text=Birken', 0, FLOOR(RAND()*1000)),

-- ===================== TÚI XÁCH & VÍ (category_id = 6) =====================
(1, 6, 'Louis Vuitton Neverfull MM', 'LV Neverfull MM Monogram, fullset, date code 2023', 45000000, 1, 'active', 'like_new', 'https://placehold.co/600x600/d4a574/fff?text=LVNever', 0, FLOOR(RAND()*1000)),
(1, 6, 'Gucci GG Marmont', 'Gucci Marmont mini, màu đen, da thật, có hóa đơn', 38000000, 1, 'active', 'like_new', 'https://placehold.co/600x600/1a1a1a/fff?text=Gucci', 0, FLOOR(RAND()*1000)),
(1, 6, 'Coach Tabby 26', 'Coach Tabby màu kem, da bê, mới 95%', 8500000, 2, 'active', 'good', 'https://placehold.co/600x600/f5deb3/333?text=Coach', 0, FLOOR(RAND()*1000)),
(1, 6, 'Ví Montblanc Meisterstück', 'Montblanc Meisterstück 6cc, da bê đen, fullbox', 12000000, 2, 'active', 'new', 'https://placehold.co/600x600/2c3e50/fff?text=MB', 0, FLOOR(RAND()*1000)),
(1, 6, 'Balo Peak Design Everyday', 'Peak Design Everyday V2 30L, màu đen, cho nhiếp ảnh', 7500000, 3, 'active', 'like_new', 'https://placehold.co/600x600/34495e/fff?text=PD30L', 0, FLOOR(RAND()*1000)),
(1, 6, 'Túi đeo chéo Uniqlo', 'Túi Uniqlo mini, màu đen, chống nước', 450000, 10, 'active', 'new', 'https://placehold.co/600x600/7f8c8d/fff?text=Uniqlo', 1, FLOOR(RAND()*1000)),

-- ===================== NHÀ CỬA & ĐỜI SỐNG (category_id = 7) =====================
(1, 7, 'Robot hút bụi Roborock S8 Pro', 'Roborock S8 Pro Ultra, tự giặt giẻ, sấy nóng', 32000000, 2, 'active', 'new', 'https://placehold.co/600x600/3498db/fff?text=S8Pro', 0, FLOOR(RAND()*1000)),
(1, 7, 'Máy lọc không khí Xiaomi 4 Pro', 'Xiaomi Air Purifier 4 Pro, lọc HEPA, 60m²', 5500000, 5, 'active', 'new', 'https://placehold.co/600x600/ecf0f1/333?text=AirPuri', 1, FLOOR(RAND()*1000)),
(1, 7, 'Nồi chiên không dầu Philips', 'Philips Airfryer XXL, 7.3L, màn cảm ứng', 8500000, 3, 'active', 'like_new', 'https://placehold.co/600x600/1a1a1a/fff?text=Airfryer', 0, FLOOR(RAND()*1000)),
(1, 7, 'Máy pha cà phê DeLonghi', 'DeLonghi Magnifica S, tự động, xay hạt', 15000000, 2, 'active', 'good', 'https://placehold.co/600x600/6f4e37/fff?text=DeLonghi', 0, FLOOR(RAND()*1000)),
(1, 7, 'Quạt không cánh Dyson', 'Dyson Pure Cool TP07, lọc không khí, điều khiển app', 18000000, 1, 'active', 'like_new', 'https://placehold.co/600x600/9b59b6/fff?text=Dyson', 0, FLOOR(RAND()*1000)),
(1, 7, 'Máy xay sinh tố Vitamix', 'Vitamix E310, 1400W, xay mịn, nhập Mỹ', 12000000, 2, 'active', 'new', 'https://placehold.co/600x600/e74c3c/fff?text=Vitamix', 0, FLOOR(RAND()*1000)),
(1, 7, 'Bộ chăn ga gối Everon', 'Everon cotton lụa, size 1m8, màu xám', 2500000, 5, 'active', 'new', 'https://placehold.co/600x600/bdc3c7/333?text=Everon', 1, FLOOR(RAND()*1000)),

-- ===================== THỂ THAO & DU LỊCH (category_id = 8) =====================
(1, 8, 'Xe đạp Giant Escape 3', 'Giant Escape 3 2024, size M, màu đen, còn mới', 9500000, 2, 'active', 'like_new', 'https://placehold.co/600x600/2ecc71/fff?text=Giant', 0, FLOOR(RAND()*1000)),
(1, 8, 'Vợt tennis Wilson Pro Staff', 'Wilson Pro Staff 97, 315g, grip size 3', 5500000, 3, 'active', 'good', 'https://placehold.co/600x600/e74c3c/fff?text=Wilson', 0, FLOOR(RAND()*1000)),
(1, 8, 'Bộ gậy golf Callaway', 'Callaway Paradym, bộ 12 gậy, túi da, fullset', 85000000, 1, 'active', 'like_new', 'https://placehold.co/600x600/27ae60/fff?text=Callaway', 0, FLOOR(RAND()*1000)),
(1, 8, 'Giày chạy bộ Nike Vaporfly', 'Nike Vaporfly 3, size 42, màu trắng xanh', 6500000, 2, 'active', 'new', 'https://placehold.co/600x600/3498db/fff?text=Vaporfly', 0, FLOOR(RAND()*1000)),
(1, 8, 'Vali Rimowa Original', 'Rimowa Original Cabin, nhôm, 21 inch', 35000000, 1, 'active', 'like_new', 'https://placehold.co/600x600/bdc3c7/333?text=Rimowa', 0, FLOOR(RAND()*1000)),
(1, 8, 'Lều cắm trại Naturehike', 'Naturehike Cloud Up 2, 2 người, siêu nhẹ 1.8kg', 3500000, 4, 'active', 'new', 'https://placehold.co/600x600/f39c12/fff?text=Tent', 1, FLOOR(RAND()*1000)),
(1, 8, 'Đồng hồ Garmin Forerunner 265', 'Garmin FR265, GPS, đo nhịp tim, pin 13 ngày', 12000000, 2, 'active', 'new', 'https://placehold.co/600x600/1abc9c/fff?text=FR265', 0, FLOOR(RAND()*1000)),

-- ===================== SẮC ĐẸP (category_id = 9) =====================
(1, 9, 'Son Dior Rouge 999', 'Dior Rouge Dior 999 Matte, fullsize, seal', 1200000, 8, 'active', 'new', 'https://placehold.co/600x600/c0392b/fff?text=Dior999', 1, FLOOR(RAND()*1000)),
(1, 9, 'Nước hoa Chanel No.5', 'Chanel No.5 EDP 100ml, fullbox, date 2024', 4500000, 3, 'active', 'new', 'https://placehold.co/600x600/f5deb3/333?text=No5', 0, FLOOR(RAND()*1000)),
(1, 9, 'Kem chống nắng Anessa', 'Anessa Perfect UV 60ml, SPF50+, Nhật Bản', 650000, 15, 'active', 'new', 'https://placehold.co/600x600/f1c40f/fff?text=Anessa', 1, FLOOR(RAND()*1000)),
(1, 9, 'Máy rửa mặt Foreo Luna', 'Foreo Luna 3, màu hồng, cho da nhạy cảm', 4500000, 4, 'active', 'like_new', 'https://placehold.co/600x600/ff69b4/fff?text=Luna3', 0, FLOOR(RAND()*1000)),
(1, 9, 'Serum The Ordinary Niacinamide', 'The Ordinary Niacinamide 10% 30ml, date 2025', 280000, 20, 'active', 'new', 'https://placehold.co/600x600/7f8c8d/fff?text=Ordinary', 1, FLOOR(RAND()*1000)),
(1, 9, 'Phấn nước Laneige', 'Laneige Neo Cushion Matte, tone 21N, mới 100%', 1100000, 6, 'active', 'new', 'https://placehold.co/600x600/3498db/fff?text=Laneige', 1, FLOOR(RAND()*1000)),
(1, 9, 'Bộ cọ trang điểm Sigma', 'Sigma Essential Kit, 12 cọ, lông tự nhiên', 3500000, 3, 'active', 'new', 'https://placehold.co/600x600/9b59b6/fff?text=Sigma', 0, FLOOR(RAND()*1000)),

-- ===================== SỨC KHỎE (category_id = 10) =====================
(1, 10, 'Máy chạy bộ Kingsport', 'Kingsport G6, 3.5HP, màn LCD, đến 16km/h', 18000000, 2, 'active', 'like_new', 'https://placehold.co/600x600/e74c3c/fff?text=Treadmill', 0, FLOOR(RAND()*1000)),
(1, 10, 'Ghế massage Ogawa', 'Ogawa Master Drive AI, full body, zero gravity', 120000000, 1, 'active', 'good', 'https://placehold.co/600x600/8e44ad/fff?text=Massage', 0, FLOOR(RAND()*1000)),
(1, 10, 'Máy đo huyết áp Omron', 'Omron HEM-7156, tự động, lưu 60 kết quả', 1800000, 5, 'active', 'new', 'https://placehold.co/600x600/ecf0f1/333?text=Omron', 1, FLOOR(RAND()*1000)),
(1, 10, 'Whey Protein Optimum Nutrition', 'ON Gold Standard 100% Whey, 2.27kg, vị Chocolate', 1800000, 8, 'active', 'new', 'https://placehold.co/600x600/8b4513/fff?text=Whey', 1, FLOOR(RAND()*1000)),
(1, 10, 'Vitamin tổng hợp Centrum', 'Centrum Adults 50+, 200 viên, date 2026', 850000, 10, 'active', 'new', 'https://placehold.co/600x600/f39c12/fff?text=Centrum', 1, FLOOR(RAND()*1000)),
(1, 10, 'Dầu cá Omega-3 Kirkland', 'Kirkland Fish Oil 1000mg, 400 viên, Mỹ', 650000, 12, 'active', 'new', 'https://placehold.co/600x600/3498db/fff?text=Omega3', 1, FLOOR(RAND()*1000)),

-- ===================== MẸ & BÉ (category_id = 11) =====================
(1, 11, 'Xe đẩy Combi', 'Combi Mechacal Handy, siêu nhẹ 4.5kg, Nhật', 8500000, 2, 'active', 'like_new', 'https://placehold.co/600x600/ff69b4/fff?text=Combi', 0, FLOOR(RAND()*1000)),
(1, 11, 'Ghế ngồi ô tô Joie', 'Joie Every Stage FX, 0-12 tuổi, xoay 360°', 9500000, 2, 'active', 'good', 'https://placehold.co/600x600/2ecc71/fff?text=Joie', 0, FLOOR(RAND()*1000)),
(1, 11, 'Máy hút sữa Medela', 'Medela Swing Maxi, đôi, không dây, mới 100%', 8500000, 3, 'active', 'new', 'https://placehold.co/600x600/3498db/fff?text=Medela', 0, FLOOR(RAND()*1000)),
(1, 11, 'Bỉm Merries size L', 'Merries tape L54, thùng 4 bịch, date mới', 1200000, 15, 'active', 'new', 'https://placehold.co/600x600/87ceeb/333?text=Merries', 1, FLOOR(RAND()*1000)),
(1, 11, 'Sữa Aptamil số 2', 'Aptamil Profutura 2, 800g, Đức, date 2026', 750000, 10, 'active', 'new', 'https://placehold.co/600x600/1abc9c/fff?text=Aptamil', 1, FLOOR(RAND()*1000)),
(1, 11, 'Địu em bé Ergobaby', 'Ergobaby Omni 360, màu xám, 4 tư thế địu', 4500000, 3, 'active', 'like_new', 'https://placehold.co/600x600/7f8c8d/fff?text=Ergo', 0, FLOOR(RAND()*1000)),
(1, 11, 'Bình sữa Comotomo', 'Comotomo 250ml, silicone, set 2 bình', 850000, 8, 'active', 'new', 'https://placehold.co/600x600/27ae60/fff?text=Comotomo', 1, FLOOR(RAND()*1000)),

-- ===================== XE CỘ (category_id = 12) =====================
(1, 12, 'Xe máy Honda SH 350i', 'SH 350i 2024, màu đen, ODO 500km, fullbox', 185000000, 1, 'active', 'like_new', 'https://placehold.co/600x600/1a1a1a/fff?text=SH350', 0, FLOOR(RAND()*1000)),
(1, 12, 'Xe máy Vespa GTS 300', 'Vespa GTS 300 SuperTech, đỏ Racing, ODO 2000km', 145000000, 1, 'active', 'good', 'https://placehold.co/600x600/c0392b/fff?text=Vespa', 0, FLOOR(RAND()*1000)),
(1, 12, 'Mũ bảo hiểm Arai', 'Arai RX-7V Evo, size L, màu trắng, ECE 22.06', 18000000, 2, 'active', 'new', 'https://placehold.co/600x600/ecf0f1/333?text=Arai', 0, FLOOR(RAND()*1000)),
(1, 12, 'Áo giáp Dainese', 'Dainese Racing 3 Leather, size 50, đen đỏ', 25000000, 1, 'active', 'like_new', 'https://placehold.co/600x600/e74c3c/fff?text=Dainese', 0, FLOOR(RAND()*1000)),
(1, 12, 'Camera hành trình Xiaomi', 'Xiaomi 70mai A800S 4K, GPS, đêm rõ nét', 2500000, 5, 'active', 'new', 'https://placehold.co/600x600/2c3e50/fff?text=70mai', 1, FLOOR(RAND()*1000)),
(1, 12, 'Lốp xe Michelin', 'Michelin Pilot Street 2, 120/70-17, mới 100%', 1200000, 6, 'active', 'new', 'https://placehold.co/600x600/f39c12/fff?text=Michelin', 1, FLOOR(RAND()*1000)),

-- ===================== THÚ CƯNG (category_id = 13) =====================
(1, 13, 'Thức ăn Royal Canin', 'Royal Canin Maxi Adult 15kg, date 2026', 1650000, 8, 'active', 'new', 'https://placehold.co/600x600/8e44ad/fff?text=RoyalC', 1, FLOOR(RAND()*1000)),
(1, 13, 'Chuồng mèo 3 tầng', 'Chuồng inox 3 tầng, 90x60x150cm, mới 100%', 3500000, 3, 'active', 'new', 'https://placehold.co/600x600/bdc3c7/333?text=CatCage', 0, FLOOR(RAND()*1000)),
(1, 13, 'Máy lọc nước cho mèo', 'Petkit Eversweet 3 Pro, 1.8L, tự tuần hoàn', 1800000, 4, 'active', 'new', 'https://placehold.co/600x600/3498db/fff?text=Petkit', 1, FLOOR(RAND()*1000)),
(1, 13, 'Cát vệ sinh Tofu', 'Cát đậu phụ Kit Cat, 6L, không bụi, xả toilet', 180000, 30, 'active', 'new', 'https://placehold.co/600x600/f5deb3/333?text=Tofu', 1, FLOOR(RAND()*1000)),
(1, 13, 'Dây dắt chó tự cuộn', 'Flexi Giant L, 8m, cho chó đến 50kg', 850000, 5, 'active', 'new', 'https://placehold.co/600x600/e74c3c/fff?text=Flexi', 1, FLOOR(RAND()*1000)),
(1, 13, 'Balo phi hành gia cho mèo', 'Balo trong suốt, có quạt, cho mèo đến 6kg', 650000, 6, 'active', 'new', 'https://placehold.co/600x600/9b59b6/fff?text=CatBag', 1, FLOOR(RAND()*1000)),

-- ===================== ÂM THANH (category_id = 14) =====================
(1, 14, 'AirPods Pro 2', 'Apple AirPods Pro 2 USB-C, ANC, mới seal', 5800000, 5, 'active', 'new', 'https://placehold.co/600x600/ecf0f1/333?text=AirPods', 1, FLOOR(RAND()*1000)),
(1, 14, 'Sony WH-1000XM5', 'Sony XM5, màu đen, ANC, pin 30h, fullbox', 7500000, 3, 'active', 'like_new', 'https://placehold.co/600x600/2c3e50/fff?text=XM5', 0, FLOOR(RAND()*1000)),
(1, 14, 'Loa JBL Partybox 310', 'JBL Partybox 310, 240W, đèn LED, có mic', 12000000, 2, 'active', 'good', 'https://placehold.co/600x600/e67e22/fff?text=JBL310', 0, FLOOR(RAND()*1000)),
(1, 14, 'Marshall Stanmore III', 'Marshall Stanmore III, Bluetooth 5.2, màu đen', 12500000, 2, 'active', 'new', 'https://placehold.co/600x600/1a1a1a/fff?text=Marshall', 0, FLOOR(RAND()*1000)),
(1, 14, 'Bose SoundLink Flex', 'Bose Flex, chống nước IP67, màu xanh', 3500000, 4, 'active', 'new', 'https://placehold.co/600x600/3498db/fff?text=BoseFlex', 1, FLOOR(RAND()*1000)),
(1, 14, 'Tai nghe Sennheiser HD 660S', 'Sennheiser HD 660S2, over-ear, audiophile', 15000000, 1, 'active', 'like_new', 'https://placehold.co/600x600/7f8c8d/fff?text=HD660S', 0, FLOOR(RAND()*1000)),
(1, 14, 'DAC/AMP FiiO K7', 'FiiO K7, desktop DAC, THX AAA, 4.4mm balanced', 6500000, 2, 'active', 'new', 'https://placehold.co/600x600/2ecc71/fff?text=FiiOK7', 0, FLOOR(RAND()*1000)),
(1, 14, 'Loa soundbar Samsung Q990C', 'Samsung Q990C 11.1.4ch, Dolby Atmos, sub không dây', 35000000, 1, 'active', 'new', 'https://placehold.co/600x600/1abc9c/fff?text=Q990C', 0, FLOOR(RAND()*1000));

SET FOREIGN_KEY_CHECKS = 1;

-- Cập nhật created_at ngẫu nhiên trong 30 ngày qua
UPDATE products SET created_at = DATE_SUB(NOW(), INTERVAL FLOOR(RAND() * 30) DAY) WHERE created_at IS NULL OR created_at = NOW();

SELECT CONCAT('Đã tạo ', COUNT(*), ' sản phẩm test!') AS result FROM products;
