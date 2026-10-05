<?php

/**
 * Migration: Seed admin user
 * 
 * @author  Zoldify Team
 * @date    2025-12-30
 * @version 2.0.0 (refactored)
 */

require_once __DIR__ . '/../BaseMigration.php';

use Database\BaseMigration;

return new class extends BaseMigration {

    public function up(): void
    {
        $email = 'superadmin@zoldify.vn';

        // Check if admin exists
        $stmt = $this->pdo->prepare("SELECT id FROM users WHERE email = ?");
        $stmt->execute([$email]);

        if ($stmt->rowCount() > 0) {
            $this->skip("Super admin already exists");
            return;
        }

        $hash = password_hash('admin123', PASSWORD_BCRYPT);

        $stmt = $this->pdo->prepare("
            INSERT INTO users (email, password, role, full_name, email_verified) 
            VALUES (?, ?, 'admin', 'Super Admin', 1)
        ");
        $stmt->execute([$email, $hash]);

        $this->success("Created super admin: {$email}");
    }

    public function down(): void
    {
        $email = 'superadmin@zoldify.vn';

        $stmt = $this->pdo->prepare("DELETE FROM users WHERE email = ?");
        $stmt->execute([$email]);

        $this->success("Deleted super admin: {$email}");
    }
};