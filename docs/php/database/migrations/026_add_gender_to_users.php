<?php

/**
 * Migration: Add gender column to users
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
        $this->addColumn($this->table, 'gender', "ENUM('male', 'female', 'other') DEFAULT NULL", 'phone_number');
    }

    public function down(): void
    {
        $this->dropColumn($this->table, 'gender');
    }
};
