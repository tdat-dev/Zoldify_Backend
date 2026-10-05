<?php

/**
 * Migration: Create products table
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
        if ($this->tableExists($this->table)) {
            $this->skip("Table '{$this->table}' already exists");
            return;
        }

        $this->pdo->exec("
            CREATE TABLE {$this->table} (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                category_id INT NOT NULL,
                name VARCHAR(255) NOT NULL,
                description TEXT DEFAULT NULL,
                price DECIMAL(10,2) NOT NULL,
                image VARCHAR(255) DEFAULT NULL,
                status ENUM('active', 'sold', 'hidden') DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                `condition` ENUM('new', 'like_new', 'good', 'fair') DEFAULT 'good',
                
                INDEX idx_user_id (user_id),
                INDEX idx_category_id (category_id),
                INDEX idx_status (status),
                INDEX idx_created_at (created_at),
                
                CONSTRAINT fk_products_user FOREIGN KEY (user_id) 
                    REFERENCES users(id) ON DELETE CASCADE,
                CONSTRAINT fk_products_category FOREIGN KEY (category_id) 
                    REFERENCES categories(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ");

        $this->success("Created table '{$this->table}'");
    }

    public function down(): void
    {
        $this->dropTable($this->table);
    }
};
