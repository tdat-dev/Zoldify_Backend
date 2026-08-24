<?php

/**
 * Migration: Create escrow_holds table
 * 
 * @author  Zoldify Team
 * @date    2026-01-07
 * @version 2.0.0 (refactored)
 */

require_once __DIR__ . '/../BaseMigration.php';

use Database\BaseMigration;

return new class extends BaseMigration {

    protected string $table = 'escrow_holds';

    public function up(): void
    {
        if ($this->tableExists($this->table)) {
            $this->skip("Table '{$this->table}' already exists");
            return;
        }

        $this->pdo->exec("
            CREATE TABLE {$this->table} (
                id INT AUTO_INCREMENT PRIMARY KEY,
                order_id INT NOT NULL,
                seller_id INT NOT NULL,
                buyer_id INT NOT NULL,
                amount DECIMAL(15,2) NOT NULL,
                status ENUM('held', 'released', 'refunded') DEFAULT 'held',
                release_date TIMESTAMP NULL DEFAULT NULL COMMENT 'Ngày dự kiến giải ngân',
                released_at TIMESTAMP NULL DEFAULT NULL,
                refunded_at TIMESTAMP NULL DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                
                INDEX idx_order_id (order_id),
                INDEX idx_seller_id (seller_id),
                INDEX idx_buyer_id (buyer_id),
                INDEX idx_status (status),
                INDEX idx_release_date (release_date),
                
                CONSTRAINT fk_escrow_order FOREIGN KEY (order_id) 
                    REFERENCES orders(id) ON DELETE CASCADE,
                CONSTRAINT fk_escrow_seller FOREIGN KEY (seller_id) 
                    REFERENCES users(id) ON DELETE CASCADE,
                CONSTRAINT fk_escrow_buyer FOREIGN KEY (buyer_id) 
                    REFERENCES users(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ");

        $this->success("Created table '{$this->table}'");
    }

    public function down(): void
    {
        $this->dropTable($this->table);
    }
};
