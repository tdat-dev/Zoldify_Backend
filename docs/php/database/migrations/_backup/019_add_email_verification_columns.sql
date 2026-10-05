-- Thêm các cột hỗ trợ xác minh email
ALTER TABLE users 
ADD COLUMN email_verified TINYINT(1) DEFAULT 0 AFTER role,
ADD COLUMN email_verification_token VARCHAR(64) NULL AFTER email_verified,
ADD COLUMN email_verification_expires_at DATETIME NULL AFTER email_verification_token;

-- Đánh dấu tất cả user hiện tại là đã xác minh (để không ảnh hưởng user cũ)
UPDATE users SET email_verified = 1 WHERE email_verified = 0;