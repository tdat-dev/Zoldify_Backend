<?php

/**
 * Migration: Add is_freeship column to products table
 * 
 * Column này cho phép người bán chọn ai trả phí ship:
 * - 0: Người mua trả (default)
 * - 1: Người bán trả (Freeship)
 */

use Database\BaseMigration;

return new class extends BaseMigration {
    public function up(): void
    {
        // Check if column already exists
        $stmt = $this->pdo->query("SHOW COLUMNS FROM products LIKE 'is_freeship'");
        if ($stmt->rowCount() > 0) {
            return; // Column already exists
        }

        $this->pdo->exec("ALTER TABLE products ADD COLUMN is_freeship TINYINT(1) DEFAULT 0 AFTER price");
    }

    public function down(): void
    {
        $this->pdo->exec("ALTER TABLE products DROP COLUMN is_freeship");
    }
};
