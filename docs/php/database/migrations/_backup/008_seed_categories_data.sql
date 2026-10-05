-- Cập nhật độ dài cột icon để chứa được đường dẫn ảnh dài hơn
ALTER TABLE categories MODIFY COLUMN icon VARCHAR(255);

-- Tắt kiểm tra khóa ngoại để có thể TRUNCATE bảng đang được tham chiếu
SET FOREIGN_KEY_CHECKS = 0;

-- Xóa dữ liệu cũ và thêm dữ liệu danh mục mới kèm icon/ảnh
TRUNCATE TABLE categories;

INSERT INTO categories (name, icon) VALUES
('Thời Trang Nam', '/images/categories/Item.png'),
('Điện Thoại', '/images/categories/Item-2.png'),
('Điện Tử', '/images/categories/Item-4.png'),
('Laptop', '/images/categories/Item-6.png'),
('Máy Ảnh', '/images/categories/Item-8.png'),
('Đồng Hồ', '/images/categories/Item-10.png'),
('Giày Dép', '/images/categories/Item-12.png'),
('Gia Dụng', '/images/categories/Item-14.png'),
('Thể Thao', '/images/categories/Item-16.png'),
('Xe Cộ', '/images/categories/Item-18.png'),
('Thời Trang Nữ', '/images/categories/Item-1.png'),
('Mẹ & Bé', '/images/categories/Item-3.png'),
('Nhà Cửa', '/images/categories/Item-5.png'),
('Sắc Đẹp', '/images/categories/Item-7.png'),
('Sức Khỏe', '/images/categories/Item-9.png'),
('Giày Nữ', '/images/categories/Item-11.png'),
('Túi Ví', '/images/categories/Item-13.png'),
('Phụ Kiện', '/images/categories/Item-15.png'),
('Sách', '/images/categories/Item-17.png'),
('Khác', '/images/categories/Item.png');

-- Bật lại kiểm tra khóa ngoại
SET FOREIGN_KEY_CHECKS = 1;

