<?php

/**
 * Migration: Tạo bảng user_addresses
 * 
 * Bảng này lưu trữ nhiều địa chỉ giao hàng cho mỗi user.
 * Mỗi user có thể có nhiều địa chỉ (nhà riêng, công ty, nhà bạn...)
 * và đặt 1 địa chỉ làm mặc định.
 * 
 * Tích hợp với HERE Maps để lấy tọa độ và địa chỉ chuẩn hóa.
 * 
 * @author Zoldify Team
 * @version 1.0.0
 * @date 2026-01-09
 */

use App\Core\Database;

return new class {
    /**
     * Tên bảng
     */
    private const TABLE_NAME = 'user_addresses';

    /**
     * Tên bảng liên kết
     */
    private const USERS_TABLE = 'users';

    /**
     * Chạy migration - tạo bảng
     */
    public function up(): void
    {
        $db = Database::getInstance()->getConnection();

        // Kiểm tra bảng đã tồn tại chưa
        if ($this->tableExists($db, self::TABLE_NAME)) {
            echo "⏭️ Bảng '" . self::TABLE_NAME . "' đã tồn tại\n";
            return;
        }

        $sql = "CREATE TABLE " . self::TABLE_NAME . " (
            -- Primary Key
            id INT AUTO_INCREMENT PRIMARY KEY,
            
            -- Foreign Key: liên kết với users (match users.id type)
            user_id INT NOT NULL,
            
            -- Thông tin nhận hàng
            label VARCHAR(50) NOT NULL COMMENT 'Tên gợi nhớ: Nhà riêng, Công ty...',
            recipient_name VARCHAR(100) NOT NULL COMMENT 'Tên người nhận hàng',
            phone_number VARCHAR(20) NOT NULL COMMENT 'SĐT người nhận',
            
            -- Địa chỉ chi tiết (cấu trúc Việt Nam)
            province VARCHAR(100) NOT NULL COMMENT 'Tỉnh/Thành phố',
            district VARCHAR(100) NOT NULL COMMENT 'Quận/Huyện',
            ward VARCHAR(100) DEFAULT NULL COMMENT 'Phường/Xã (optional vì một số địa chỉ đặc biệt)',
            street_address VARCHAR(255) NOT NULL COMMENT 'Số nhà, tên đường, tòa nhà...',
            
            -- Địa chỉ đầy đủ (từ HERE Maps hoặc tổng hợp)
            full_address TEXT NOT NULL COMMENT 'Địa chỉ đầy đủ đã được chuẩn hóa',
            
            -- Tọa độ từ HERE Maps (hỗ trợ tính phí ship, hiển thị map)
            latitude DECIMAL(10, 8) DEFAULT NULL COMMENT 'Vĩ độ từ HERE Geocoding',
            longitude DECIMAL(11, 8) DEFAULT NULL COMMENT 'Kinh độ từ HERE Geocoding',
            
            -- HERE Maps metadata (optional, để cache)
            here_place_id VARCHAR(100) DEFAULT NULL COMMENT 'HERE Place ID để lookup sau',
            
            -- Flags
            is_default TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = địa chỉ mặc định',
            
            -- Timestamps
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            
            -- Indexes
            INDEX idx_user_id (user_id),
            INDEX idx_user_default (user_id, is_default),
            INDEX idx_here_place_id (here_place_id),
            
            -- Foreign Key Constraint
            CONSTRAINT fk_user_addresses_user_id 
                FOREIGN KEY (user_id) 
                REFERENCES " . self::USERS_TABLE . "(id) 
                ON DELETE CASCADE 
                ON UPDATE CASCADE
        ) ENGINE=InnoDB 
          DEFAULT CHARSET=utf8mb4 
          COLLATE=utf8mb4_unicode_ci 
          COMMENT='Bảng lưu địa chỉ giao hàng của users'";

        try {
            $db->exec($sql);
            echo "✅ Đã tạo bảng '" . self::TABLE_NAME . "'\n";

            // Migrate dữ liệu cũ từ users.address (nếu có)
            $this->migrateOldAddresses($db);
        } catch (PDOException $e) {
            echo "❌ Lỗi tạo bảng: " . $e->getMessage() . "\n";
            throw $e;
        }
    }

    /**
     * Rollback migration - xóa bảng
     */
    public function down(): void
    {
        $db = Database::getInstance()->getConnection();

        if (!$this->tableExists($db, self::TABLE_NAME)) {
            echo "⏭️ Bảng '" . self::TABLE_NAME . "' không tồn tại\n";
            return;
        }

        try {
            $db->exec("DROP TABLE " . self::TABLE_NAME);
            echo "✅ Đã xóa bảng '" . self::TABLE_NAME . "'\n";
        } catch (PDOException $e) {
            echo "❌ Lỗi xóa bảng: " . $e->getMessage() . "\n";
            throw $e;
        }
    }

    /**
     * Kiểm tra bảng đã tồn tại chưa
     */
    private function tableExists(PDO $db, string $tableName): bool
    {
        // MySQL không hỗ trợ prepared statement với SHOW TABLES
        // Sử dụng query trực tiếp với tên bảng đã được sanitize (là constant)
        $result = $db->query("SHOW TABLES LIKE '{$tableName}'");
        return $result->rowCount() > 0;
    }

    /**
     * Migrate dữ liệu địa chỉ cũ từ users.address
     * 
     * Logic: Với mỗi user có address không rỗng,
     * tạo 1 bản ghi trong user_addresses và đặt làm mặc định.
     */
    private function migrateOldAddresses(PDO $db): void
    {
        // Kiểm tra cột address có tồn tại trong users không
        $stmt = $db->prepare("SHOW COLUMNS FROM " . self::USERS_TABLE . " LIKE 'address'");
        $stmt->execute();

        if ($stmt->rowCount() === 0) {
            echo "ℹ️ Không có cột 'address' trong bảng users, skip migration dữ liệu cũ\n";
            return;
        }

        // Lấy tất cả users có địa chỉ
        $users = $db->query("
            SELECT id, full_name, phone_number, address 
            FROM " . self::USERS_TABLE . " 
            WHERE address IS NOT NULL AND address != ''
        ")->fetchAll(PDO::FETCH_ASSOC);

        if (empty($users)) {
            echo "ℹ️ Không có dữ liệu địa chỉ cũ để migrate\n";
            return;
        }

        $insertSql = "INSERT INTO " . self::TABLE_NAME . " 
            (user_id, label, recipient_name, phone_number, province, district, street_address, full_address, is_default) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)";

        $insertStmt = $db->prepare($insertSql);
        $migratedCount = 0;

        foreach ($users as $user) {
            try {
                // Parse địa chỉ cũ (best effort - format không chuẩn)
                $fullAddress = $user['address'];

                $insertStmt->execute([
                    $user['id'],
                    'Địa chỉ cũ',                    // label
                    $user['full_name'] ?? 'Người nhận', // recipient_name
                    $user['phone_number'] ?? '',      // phone_number
                    'Chưa cập nhật',                  // province (placeholder)
                    'Chưa cập nhật',                  // district (placeholder)
                    $fullAddress,                     // street_address
                    $fullAddress,                     // full_address
                ]);
                $migratedCount++;
            } catch (PDOException $e) {
                echo "⚠️ Không thể migrate địa chỉ cho user #{$user['id']}: " . $e->getMessage() . "\n";
            }
        }

        echo "✅ Đã migrate {$migratedCount}/" . count($users) . " địa chỉ cũ từ bảng users\n";
    }
};
