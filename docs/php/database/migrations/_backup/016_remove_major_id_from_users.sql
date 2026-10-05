-- Migration: Xóa cột major_id (nếu tồn tại)
-- File này chỉ cần thiết khi upgrade từ phiên bản cũ

-- Kiểm tra và xóa cột major_id nếu tồn tại
SET @column_exists = (
    SELECT COUNT(*) 
    FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() 
    AND TABLE_NAME = 'users' 
    AND COLUMN_NAME = 'major_id'
);

-- Chỉ thực hiện nếu cột tồn tại
-- Lưu ý: MySQL không hỗ trợ IF trong ALTER TABLE, nên ta bỏ qua migration này
-- Nếu cột không tồn tại, migration này sẽ được bỏ qua

-- DO NOTHING - File này không cần thiết cho database mới
SELECT 'Migration 016: Skipped - major_id column does not exist' AS status;