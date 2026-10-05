-- Thêm cột quantity nếu thiếu (cho các máy đã chạy migration cũ)
-- Nếu đã có cột này thì sẽ báo lỗi nhưng không sao, bỏ qua được

SET @dbname = DATABASE();
SET @tablename = 'products';
SET @columnname = 'quantity';
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname
    AND TABLE_NAME = @tablename
    AND COLUMN_NAME = @columnname
  ) > 0,
  'SELECT 1',
  'ALTER TABLE products ADD COLUMN quantity INT NOT NULL DEFAULT 1 AFTER image'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;
