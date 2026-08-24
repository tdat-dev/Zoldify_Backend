-- Tắt kiểm tra khóa ngoại để dọn dẹp bảng
SET FOREIGN_KEY_CHECKS = 0;

TRUNCATE TABLE categories;

INSERT INTO categories (name, icon) VALUES
('Thời Trang Nam', '/images/categories/Item.png'),   -- Áo Polo xanh
('Điện Thoại', '/images/categories/Item-2.png'),      -- iPhone
('Điện Tử', '/images/categories/Item-4.png'),         -- TV
('Laptop', '/images/categories/Item-6.png'),          -- Laptop
('Máy Ảnh', '/images/categories/Item-8.png'),         -- Máy ảnh
('Đồng Hồ', '/images/categories/Item-10.png'),        -- Đồng hồ
('Giày Dép', '/images/categories/Item-12.png'),       -- Giày Nam (Xanh)
('Gia Dụng', '/images/categories/Item-14.png'),       -- Ấm siêu tốc
('Thể Thao', '/images/categories/Item-16.png'),       -- Bóng đá
('Xe Cộ', '/images/categories/Item-18.png'),          -- Xe máy
('Thời Trang Nữ', '/images/categories/Item-1.png'),   -- Áo cam nữ
('Mẹ & Bé', '/images/categories/Item-3.png'),         -- Ghế ăn dặm
('Nhà Cửa', '/images/categories/Item-5.png'),         -- Nồi cam
('Sắc Đẹp', '/images/categories/Item-7.png'),         -- Đồ trang điểm
('Sức Khỏe', '/images/categories/Item-9.png'),        -- Thuốc/Vitamin
('Giày Nữ', '/images/categories/Item-11.png'),        -- Giày cao gót
('Túi Ví', '/images/categories/Item-13.png'),         -- Túi xách đỏ
('Phụ Kiện', '/images/categories/Item-15.png'),       -- Thắt lưng
('Sách', '/images/categories/Item-17.png'),           -- Sách đỏ
('Khác', '/images/categories/Item.png');              -- (Mặc định)

-- Bật lại kiểm tra khóa ngoại
SET FOREIGN_KEY_CHECKS = 1;
