<?php

/**
 * Migration: Seed new users
 * 
 * @author  Zoldify Team
 * @date    2025-12-31
 * @version 2.0.0 (refactored)
 */

require_once __DIR__ . '/../BaseMigration.php';

use Database\BaseMigration;

return new class extends BaseMigration {

    public function up(): void
    {
        $hash = password_hash('password123', PASSWORD_BCRYPT);

        $users = [
            ['Admin Zoldify', 'admin@zoldify.vn', $hash, '0901234567', 'Hà Nội', 'admin'],
            ['Nguyễn Văn Kiểm', 'moderator@zoldify.vn', $hash, '0902345678', 'TP HCM', 'moderator'],
        ];

        $stmt = $this->pdo->prepare("
            INSERT IGNORE INTO users (full_name, email, password, phone_number, address, role, email_verified) 
            VALUES (?, ?, ?, ?, ?, ?, 1)
        ");

        $inserted = 0;
        foreach ($users as $user) {
            try {
                $stmt->execute($user);
                if ($stmt->rowCount() > 0)
                    $inserted++;
            } catch (PDOException $e) {
                // Ignore duplicate
            }
        }

        if ($inserted > 0) {
            $this->success("Seeded {$inserted} new users");
        } else {
            $this->skip("Users already seeded");
        }
    }

    public function down(): void
    {
        $this->warning("Cannot rollback user seeding to protect data");
    }
};
