<?php

/**
 * Migration: Add balance and avatar columns to users
 * 
 * @author  Zoldify Team
 * @date    2026-01-03
 * @version 2.0.0 (refactored)
 */

require_once __DIR__ . '/../BaseMigration.php';

use Database\BaseMigration;

return new class extends BaseMigration {

    protected string $table = 'users';

    public function up(): void
    {
        $this->addColumn($this->table, 'balance', "DECIMAL(15,2) DEFAULT 0.00", 'role');
        $this->addColumn($this->table, 'avatar', "VARCHAR(255) DEFAULT NULL", 'balance');
    }

    public function down(): void
    {
        $this->dropColumn($this->table, 'avatar');
        $this->dropColumn($this->table, 'balance');
    }
};
