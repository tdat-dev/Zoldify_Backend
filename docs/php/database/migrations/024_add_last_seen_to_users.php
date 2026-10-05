<?php

/**
 * Migration: Add last_seen column to users
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
        $this->addColumn($this->table, 'last_seen', "DATETIME DEFAULT NULL", 'is_locked');
    }

    public function down(): void
    {
        $this->dropColumn($this->table, 'last_seen');
    }
};