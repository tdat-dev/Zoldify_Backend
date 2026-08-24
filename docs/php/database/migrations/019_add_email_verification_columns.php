<?php

/**
 * Migration: Add email verification columns to users
 * 
 * @author  Zoldify Team
 * @date    2025-12-31
 * @version 2.0.0 (refactored)
 */

require_once __DIR__ . '/../BaseMigration.php';

use Database\BaseMigration;

return new class extends BaseMigration {

    protected string $table = 'users';

    public function up(): void
    {
        $this->addColumn($this->table, 'email_verification_token', "VARCHAR(100) DEFAULT NULL", 'email_verified');
        $this->addColumn($this->table, 'email_verification_expires_at', "DATETIME DEFAULT NULL", 'email_verification_token');
    }

    public function down(): void
    {
        $this->dropColumn($this->table, 'email_verification_expires_at');
        $this->dropColumn($this->table, 'email_verification_token');
    }
};
