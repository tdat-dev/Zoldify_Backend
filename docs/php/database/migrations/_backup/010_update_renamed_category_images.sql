-- Tắt kiểm tra khóa ngoại để dọn dẹp bảng
SET FOREIGN_KEY_CHECKS = 0;

TRUNCATE TABLE categories;

INSERT INTO categories (name, icon) VALUES
('Thời Trang Nam', '/images/categories/item.png'),
('Điện Thoại', '/images/categories/dienthoai.png'),
('Điện Tử', '/images/categories/manhinh.png'),
('Laptop', '/images/categories/laptop.png'),
('Máy Ảnh', '/images/categories/camera.png'),
('Đồng Hồ', '/images/categories/dongho.png'),
('Giày Dép', '/images/categories/giay.png'),
('Gia Dụng', '/images/categories/amsieutoc.png'),
('Thể Thao', '/images/categories/bongda.png'),
('Xe Cộ', '/images/categories/xemay.png'),
('Thời Trang Nữ', '/images/categories/aonu.png'),
('Mẹ & Bé', '/images/categories/banghetreem.png'),
('Nhà Cửa', '/images/categories/noicanh.png'),
('Sắc Đẹp', '/images/categories/sonphan.png'),
('Sức Khỏe', '/images/categories/thuockhautrang.png'),
('Giày Nữ', '/images/categories/guoc.png'),
('Túi Ví', '/images/categories/tuida.png'),
('Phụ Kiện', '/images/categories/thatlung.png'),
('Sách', '/images/categories/sach.png'),
('Khác', '/images/categories/item.png');

-- Bật lại kiểm tra khóa ngoại
SET FOREIGN_KEY_CHECKS = 1;
