-- Migration: Add gender column to users table
-- Date: 2026-01-10

-- Add gender column if not exists
SET @dbname = DATABASE();
SET @tablename = 'users';
SET @columnname = 'gender';

SET @preparedStatement = (SELECT IF(
    (
        SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = @dbname
        AND TABLE_NAME = @tablename
        AND COLUMN_NAME = @columnname
    ) > 0,
    'SELECT "Column already exists"',
    CONCAT('ALTER TABLE `', @tablename, '` ADD COLUMN `', @columnname, "` ENUM('male', 'female', 'other') DEFAULT NULL AFTER `phone_number`")
));

PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;
