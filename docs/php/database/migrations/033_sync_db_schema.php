<?php
/**
 * Migration: Sync database schema
 * Thêm các cột và bảng còn thiếu để đồng bộ với db.sql
 */

require_once __DIR__ . '/../../vendor/autoload.php';

use App\Core\Database;

try {
    $db = Database::getInstance();
    $pdo = $db->getConnection();

    echo "🔄 Đang đồng bộ database schema...\n";

    // 1. Thêm cột last_seen vào users (nếu chưa có)
    $stmt = $pdo->query("SHOW COLUMNS FROM users LIKE 'last_seen'");
    if ($stmt->rowCount() === 0) {
        $pdo->exec("ALTER TABLE users ADD COLUMN last_seen DATETIME DEFAULT NULL");
        echo "✅ Đã thêm cột 'last_seen' vào bảng users\n";
    } else {
        echo "⏭️ Cột 'last_seen' đã tồn tại trong bảng users\n";
    }

    // 2. Thêm cột description vào categories (nếu chưa có)
    $stmt = $pdo->query("SHOW COLUMNS FROM categories LIKE 'description'");
    if ($stmt->rowCount() === 0) {
        $pdo->exec("ALTER TABLE categories ADD COLUMN description TEXT DEFAULT NULL");
        echo "✅ Đã thêm cột 'description' vào bảng categories\n";
    } else {
        echo "⏭️ Cột 'description' đã tồn tại trong bảng categories\n";
    }

    // 3. Thêm cột parent_id vào categories (nếu chưa có)
    $stmt = $pdo->query("SHOW COLUMNS FROM categories LIKE 'parent_id'");
    if ($stmt->rowCount() === 0) {
        $pdo->exec("ALTER TABLE categories ADD COLUMN parent_id INT DEFAULT NULL");
        $pdo->exec("ALTER TABLE categories ADD FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE SET NULL");
        echo "✅ Đã thêm cột 'parent_id' vào bảng categories\n";
    } else {
        echo "⏭️ Cột 'parent_id' đã tồn tại trong bảng categories\n";
    }

    // 4. Thêm cột condition vào products (nếu chưa có)
    $stmt = $pdo->query("SHOW COLUMNS FROM products LIKE 'condition'");
    if ($stmt->rowCount() === 0) {
        $pdo->exec("ALTER TABLE products ADD COLUMN `condition` ENUM('new', 'like_new', 'good', 'fair') DEFAULT 'good'");
        echo "✅ Đã thêm cột 'condition' vào bảng products\n";
    } else {
        echo "⏭️ Cột 'condition' đã tồn tại trong bảng products\n";
    }

    // 5. Tạo bảng message_attachments (nếu chưa có)
    $stmt = $pdo->query("SHOW TABLES LIKE 'message_attachments'");
    if ($stmt->rowCount() === 0) {
        $pdo->exec("
            CREATE TABLE IF NOT EXISTS message_attachments (
                id INT AUTO_INCREMENT PRIMARY KEY,
                message_id INT NOT NULL,
                filename VARCHAR(255) NOT NULL,
                original_name VARCHAR(255) NOT NULL,
                file_type VARCHAR(50) NOT NULL,
                file_size INT NOT NULL,
                file_path VARCHAR(500) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        ");
        echo "✅ Đã tạo bảng 'message_attachments'\n";
    } else {
        echo "⏭️ Bảng 'message_attachments' đã tồn tại\n";
    }

    echo "\n🎉 Đồng bộ database schema hoàn tất!\n";

} catch (PDOException $e) {
    echo "❌ Lỗi: " . $e->getMessage() . "\n";
    exit(1);
}
