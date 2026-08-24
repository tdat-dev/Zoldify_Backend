-- Migration: Cập nhật password hash ĐÚNG cho tất cả users
-- Hash này vừa được tạo bởi PHP: password_hash('123456', PASSWORD_BCRYPT)
-- Password: 123456

UPDATE users SET password = '$2y$10$6jQawCXuX3vuoSxJiC6Oruuj1xm2MH0WfAxJPHEYYT9wU94hn0uPOy';
