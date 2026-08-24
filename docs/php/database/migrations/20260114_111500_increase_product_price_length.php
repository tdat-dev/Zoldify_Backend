<?php

/**
 * Migration: Increase price column length in products table
 * 
 * Change:
 * - price: decimal(10,2) -> decimal(15,2)
 * 
 * @date 2026-01-14
 */

use Database\BaseMigration;

return new class extends BaseMigration {
    public function up(): void
    {
        $this->pdo->exec("
            ALTER TABLE products
            MODIFY COLUMN price DECIMAL(15, 2) NOT NULL DEFAULT 0
        ");
        echo "Increased products.price text length to DECIMAL(15,2)\n";
    }

    public function down(): void
    {
        $this->pdo->exec("
            ALTER TABLE products
            MODIFY COLUMN price DECIMAL(10, 2) NOT NULL DEFAULT 0
        ");
        echo "Reverted products.price text length to DECIMAL(10,2)\n";
    }
};
