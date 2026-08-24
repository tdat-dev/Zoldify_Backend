<?php

/**
 * Migration: Add cancel_reason column to orders
 * 
 * @author  Zoldify Team
 * @date    2026-01-10
 * @version 2.0.0 (refactored)
 */

require_once __DIR__ . '/../BaseMigration.php';

use Database\BaseMigration;

return new class extends BaseMigration {

    protected string $table = 'orders';

    public function up(): void
    {
        $this->addColumn($this->table, 'cancel_reason', "VARCHAR(255) DEFAULT NULL", 'status');
    }

    public function down(): void
    {
        $this->dropColumn($this->table, 'cancel_reason');
    }
};
