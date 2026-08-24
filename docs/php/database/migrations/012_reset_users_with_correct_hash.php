<?php

/**
 * Migration: Reset users with correct password hash
 * 
 * @author  Zoldify Team
 * @date    2025-12-01
 * @version 2.0.0 (refactored)
 */

require_once __DIR__ . '/../BaseMigration.php';

use Database\BaseMigration;

return new class extends BaseMigration {

    public function up(): void
    {
        // Seed default users if table is empty or reset test users
        $count = $this->pdo->query("SELECT COUNT(*) FROM users")->fetchColumn();

        if ($count > 0) {
            $this->skip("Users table already has data ({$count} records)");
            return;
        }

        $hash = password_hash('admin123', PASSWORD_BCRYPT);

        $users = [
            ['Nguyễn Văn Admin', 'admin@unizify.vn', $hash, '0901234567', 'Hà Nội', 'admin'],
            ['Trần Thị Lan', 'lan.tran@student.edu.vn', $hash, '0912345678', 'TP HCM', 'seller'],
            ['Lê Văn Hùng', 'hung.le@student.edu.vn', $hash, '0923456789', 'Đà Nẵng', 'seller'],
            ['Phạm Thị Mai', 'mai.pham@student.edu.vn', $hash, '0934567890', 'Hải Phòng', 'seller'],
            ['Hoàng Văn Nam', 'nam.hoang@student.edu.vn', $hash, '0945678901', 'Cần Thơ', 'seller'],
        ];

        $stmt = $this->pdo->prepare("
            INSERT INTO users (full_name, email, password, phone_number, address, role) 
            VALUES (?, ?, ?, ?, ?, ?)
        ");

        foreach ($users as $user) {
            $stmt->execute($user);
        }

        $this->success("Seeded " . count($users) . " default users");
    }

    public function down(): void
    {
        $this->warning("Cannot rollback user seeding to protect data");
    }
};
