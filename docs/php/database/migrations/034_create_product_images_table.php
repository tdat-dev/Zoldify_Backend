<?php

/**
 * Migration: Create product_images table
 * 
 * @author  Zoldify Team
 * @date    2026-01-04
 * @version 2.0.0 (refactored)
 */

require_once __DIR__ . '/../BaseMigration.php';

use Database\BaseMigration;

return new class extends BaseMigration {

    protected string $table = 'product_images';

    public function up(): void
    {
        if ($this->tableExists($this->table)) {
            $this->skip("Table '{$this->table}' already exists");
            return;
        }

        $this->pdo->exec("
            CREATE TABLE {$this->table} (
                id INT AUTO_INCREMENT PRIMARY KEY,
                product_id INT NOT NULL,
                image_path VARCHAR(500) NOT NULL,
                is_primary TINYINT(1) DEFAULT 0,
                sort_order INT DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                
                INDEX idx_product_id (product_id),
                INDEX idx_is_primary (is_primary),
                
                CONSTRAINT fk_product_images_product FOREIGN KEY (product_id) 
                    REFERENCES products(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ");

        $this->success("Created table '{$this->table}'");
    }

    public function down(): void
    {
        $this->dropTable($this->table);
    }
};
