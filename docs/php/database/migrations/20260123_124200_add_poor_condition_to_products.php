<?php

/**
 * Migration: Add 'poor' condition to products table
 * 
 * Fixes issue where Product::getConditions() returns 5 values 
 * but database ENUM only has 4 values, causing condition to always 
 * default to 'good'.
 * 
 * @author  Zoldify Team
 * @date    2026-01-23
 * @version 1.0.0
 */

require_once __DIR__ . '/../BaseMigration.php';

use Database\BaseMigration;

return new class extends BaseMigration {

    protected string $table = 'products';

    public function up(): void
    {
        // Check if 'poor' already exists in ENUM
        $result = $this->pdo->query("
            SELECT COLUMN_TYPE 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = DATABASE() 
            AND TABLE_NAME = '{$this->table}' 
            AND COLUMN_NAME = 'condition'
        ")->fetch();

        if ($result && str_contains($result['COLUMN_TYPE'], 'poor')) {
            $this->skip("Column 'condition' already contains 'poor' value");
            return;
        }

        // ALTER TABLE to add 'poor' to ENUM
        $this->pdo->exec("
            ALTER TABLE {$this->table} 
            MODIFY COLUMN `condition` ENUM('new', 'like_new', 'good', 'fair', 'poor') 
            DEFAULT 'good'
        ");

        $this->success("Added 'poor' value to {$this->table}.condition ENUM");
    }

    public function down(): void
    {
        // Remove 'poor' from ENUM (rollback)
        $this->pdo->exec("
            ALTER TABLE {$this->table} 
            MODIFY COLUMN `condition` ENUM('new', 'like_new', 'good', 'fair') 
            DEFAULT 'good'
        ");

        $this->success("Removed 'poor' value from {$this->table}.condition ENUM");
    }
};
