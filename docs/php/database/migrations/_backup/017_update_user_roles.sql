-- Migration: Cập nhật hệ thống role từ student-based sang marketplace tổng quát
-- Mục đích: Mở rộng từ "marketplace sinh viên" sang "marketplace cho mọi người"

-- Bước 1: Thêm các role mới vào ENUM
-- MySQL không cho phép sửa ENUM trực tiếp, phải tạo lại cột

-- Tạm thời thêm cột mới với role mới
ALTER TABLE users ADD COLUMN new_role ENUM('buyer', 'seller', 'admin', 'moderator') DEFAULT 'buyer';

-- Migrate dữ liệu cũ sang role mới
-- student -> seller (vì trong context cũ, sinh viên vừa mua vừa bán)
-- admin -> admin (giữ nguyên)
UPDATE users SET new_role = CASE
    WHEN role = 'admin' THEN 'admin'
    WHEN role = 'student' THEN 'seller'
    ELSE 'buyer'
END;

-- Xóa cột cũ
ALTER TABLE users DROP COLUMN role;

-- Đổi tên cột mới thành role
ALTER TABLE users CHANGE COLUMN new_role role ENUM('buyer', 'seller', 'admin', 'moderator') DEFAULT 'buyer';

-- Giải thích các role:
-- buyer: Người dùng thông thường, chỉ mua hàng
-- seller: Người dùng đã đăng ký bán hàng (có thể vừa mua vừa bán)
-- admin: Quản trị viên hệ thống
-- moderator: Kiểm duyệt viên (kiểm tra sản phẩm, xử lý báo cáo)
