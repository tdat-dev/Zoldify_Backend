<?php

/**
 * Migration: Fix password hash - ensure all passwords use bcrypt
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
        // Get users with non-bcrypt passwords (bcrypt starts with $2y$)
        $users = $this->pdo->query("
            SELECT id, password FROM users 
            WHERE password NOT LIKE '\$2y\$%' 
            AND password NOT LIKE '\$2a\$%'
            AND password NOT LIKE '\$2b\$%'
        ")->fetchAll(PDO::FETCH_ASSOC);

        if (empty($users)) {
            $this->skip("All passwords already use bcrypt");
            return;
        }

        // Default password for migration
        $defaultHash = password_hash('password123', PASSWORD_BCRYPT);

        $stmt = $this->pdo->prepare("UPDATE users SET password = ? WHERE id = ?");

        foreach ($users as $user) {
            $stmt->execute([$defaultHash, $user['id']]);
        }

        $this->success("Reset " . count($users) . " passwords to bcrypt hash");
        $this->warning("Users need to reset their passwords!");
    }

    public function down(): void
    {
        $this->warning("Cannot rollback password changes");
    }
};
