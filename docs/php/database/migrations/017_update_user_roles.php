<?php

/**
 * Migration: Update user roles - add email_verified column
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
        // Add email_verified column
        $this->addColumn($this->table, 'email_verified', "TINYINT(1) DEFAULT 0", 'avatar');
    }

    public function down(): void
    {
        $this->dropColumn($this->table, 'email_verified');
    }
};
