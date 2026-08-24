<?php
/**
 * Migration: 035_create_follows_table
 * Tạo bảng follows để lưu quan hệ theo dõi giữa các user
 */

require_once __DIR__ . '/../../app/Core/Database.php';

use App\Core\Database;

$db = Database::getInstance();

$sql = "
CREATE TABLE IF NOT EXISTS follows (
    id INT AUTO_INCREMENT PRIMARY KEY,
    follower_id INT NOT NULL COMMENT 'User đang theo dõi',
    following_id INT NOT NULL COMMENT 'User được theo dõi',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (following_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_follow (follower_id, following_id),
    INDEX idx_follower (follower_id),
    INDEX idx_following (following_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
";

try {
    $db->query($sql);
    echo "✅ Đã tạo bảng follows thành công!\n";
} catch (Exception $e) {
    echo "❌ Lỗi: " . $e->getMessage() . "\n";
}
