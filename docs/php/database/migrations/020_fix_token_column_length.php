<?php

/**
 * Migration: Fix token column length
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
        if (!$this->columnExists($this->table, 'email_verification_token')) {
            $this->skip("Column 'email_verification_token' does not exist");
            return;
        }

        $this->modifyColumn($this->table, 'email_verification_token', "VARCHAR(100) DEFAULT NULL");
    }

    public function down(): void
    {
        // No-op, same as up
    }
};
