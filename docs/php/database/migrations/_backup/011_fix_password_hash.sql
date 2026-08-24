-- Migration: Fix password hash cho tất cả users
-- Password mặc định: 123456
-- Hash: $2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi

-- Cập nhật password cho tất cả user về hash chuẩn của "123456"
UPDATE users 
SET password = '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi'
WHERE password NOT LIKE '$2y$%';

-- Hoặc cập nhật tất cả (kể cả đã hash) để đảm bảo 100%
-- Uncomment dòng dưới nếu muốn reset tất cả về password "123456"
-- UPDATE users SET password = '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi';
