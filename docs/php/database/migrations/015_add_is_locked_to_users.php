<?php

/**
 * Migration: Add is_locked column to users
 * 
 * @author  Zoldify Team
 * @date    2026-01-01
 * @version 2.0.0 (refactored)
 */

require_once __DIR__ . '/../BaseMigration.php';

use Database\BaseMigration;

return new class extends BaseMigration {

    protected string $table = 'users';

    public function up(): void
    {
        $this->addColumn($this->table, 'is_locked', "TINYINT(1) DEFAULT 0", 'role');
    }

    public function down(): void
    {
        $this->dropColumn($this->table, 'is_locked');
    }
};