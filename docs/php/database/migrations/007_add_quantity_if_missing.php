<?php

/**
 * Migration: Add quantity column to products
 * 
 * @author  Zoldify Team
 * @date    2025-12-01
 * @version 2.0.0 (refactored)
 */

require_once __DIR__ . '/../BaseMigration.php';

use Database\BaseMigration;

return new class extends BaseMigration {

    protected string $table = 'products';

    public function up(): void
    {
        $this->addColumn($this->table, 'quantity', "INT NOT NULL DEFAULT 0", 'price');
    }

    public function down(): void
    {
        $this->dropColumn($this->table, 'quantity');
    }
};
