-- Migration: Thêm dữ liệu mẫu với role mới
-- Mục đích: Tạo user mẫu đa dạng cho marketplace tổng quát

-- Xóa dữ liệu cũ nếu cần (tùy chọn - comment lại nếu muốn giữ data cũ)
-- DELETE FROM users WHERE email LIKE '%@student.edu.vn';

-- Thêm user mẫu mới với các role khác nhau
-- Password tất cả: 123456
INSERT IGNORE INTO users (full_name, email, password, phone_number, address, role) VALUES
-- Admin
('Admin Zoldify', 'admin@zoldify.vn', '$2y$10$e0MYzXyjpJS7Pd0RVvHwHe1MEOVkbWRN9lLVvMqxGPVrjJJhDFWGq', '0901234567', 'Hà Nội', 'admin'),

-- Moderator
('Nguyễn Văn Kiểm', 'moderator@zoldify.vn', '$2y$10$e0MYzXyjpJS7Pd0RVvHwHe1MEOVkbWRN9lLVvMqxGPVrjJJhDFWGq', '0902345678', 'TP HCM', 'moderator'),

-- Sellers (Người bán)
('Trần Thị Hoa', 'hoa.seller@gmail.com', '$2y$10$e0MYzXyjpJS7Pd0RVvHwHe1MEOVkbWRN9lLVvMqxGPVrjJJhDFWGq', '0912345678', 'Quận 1, TP HCM', 'seller'),
('Lê Văn Minh', 'minh.shop@gmail.com', '$2y$10$e0MYzXyjpJS7Pd0RVvHwHe1MEOVkbWRN9lLVvMqxGPVrjJJhDFWGq', '0923456789', 'Hải Châu, Đà Nẵng', 'seller'),
('Phạm Thị Mai', 'mai.vintage@gmail.com', '$2y$10$e0MYzXyjpJS7Pd0RVvHwHe1MEOVkbWRN9lLVvMqxGPVrjJJhDFWGq', '0934567890', 'Lê Chân, Hải Phòng', 'seller'),
('Hoàng Văn Nam', 'nam.secondhand@gmail.com', '$2y$10$e0MYzXyjpJS7Pd0RVvHwHe1MEOVkbWRN9lLVvMqxGPVrjJJhDFWGq', '0945678901', 'Ninh Kiều, Cần Thơ', 'seller'),

-- Buyers (Người mua)
('Ngô Thị Lan', 'lan.buyer@gmail.com', '$2y$10$e0MYzXyjpJS7Pd0RVvHwHe1MEOVkbWRN9lLVvMqxGPVrjJJhDFWGq', '0956789012', 'Đống Đa, Hà Nội', 'buyer'),
('Đặng Văn Tùng', 'tung.customer@gmail.com', '$2y$10$e0MYzXyjpJS7Pd0RVvHwHe1MEOVkbWRN9lLVvMqxGPVrjJJhDFWGq', '0967890123', 'Tân Bình, TP HCM', 'buyer'),
('Vũ Thị Hương', 'huong.buyer@gmail.com', '$2y$10$e0MYzXyjpJS7Pd0RVvHwHe1MEOVkbWRN9lLVvMqxGPVrjJJhDFWGq', '0978901234', 'Thanh Khê, Đà Nẵng', 'buyer');

-- Ghi chú:
-- - Tất cả password đều là: 123456
-- - Email đã đổi từ @student.edu.vn sang @gmail.com để phù hợp với marketplace tổng quát
-- - Có thể thêm nhiều user hơn tùy nhu cầu test
