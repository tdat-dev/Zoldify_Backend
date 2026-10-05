-- Migration: Reset tất cả users với password hash mới
-- Xóa toàn bộ user cũ và insert lại với hash được tạo bởi PHP

SET FOREIGN_KEY_CHECKS = 0;
TRUNCATE TABLE users;
SET FOREIGN_KEY_CHECKS = 1;

-- Insert lại users với password đã hash ĐÚNG
-- Password cho tất cả: 123456
-- Hash được tạo bằng: password_hash('123456', PASSWORD_BCRYPT)

INSERT INTO users (full_name, email, password, phone_number, address, role) VALUES
('Nguyễn Văn Admin', 'admin@zoldify.vn', '$2y$10$e0MYzXyjpJS7Pd0RVvHwHe1MEOVkbWRN9lLVvMqxGPVrjJJhDFWGq', '0901234567', 'Hà Nội', 'admin'),
('Trần Thị Lan', 'lan.tran@student.edu.vn', '$2y$10$e0MYzXyjpJS7Pd0RVvHwHe1MEOVkbWRN9lLVvMqxGPVrjJJhDFWGq', '0912345678', 'TP HCM', 'seller'),
('Lê Văn Hùng', 'hung.le@student.edu.vn', '$2y$10$e0MYzXyjpJS7Pd0RVvHwHe1MEOVkbWRN9lLVvMqxGPVrjJJhDFWGq', '0923456789', 'Đà Nẵng', 'seller'),
('Phạm Thị Mai', 'mai.pham@student.edu.vn', '$2y$10$e0MYzXyjpJS7Pd0RVvHwHe1MEOVkbWRN9lLVvMqxGPVrjJJhDFWGq', '0934567890', 'Hải Phòng', 'buyer'),
('Hoàng Văn Nam', 'nam.hoang@student.edu.vn', '$2y$10$e0MYzXyjpJS7Pd0RVvHwHe1MEOVkbWRN9lLVvMqxGPVrjJJhDFWGq', '0945678901', 'Cần Thơ', 'buyer');