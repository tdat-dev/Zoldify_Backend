<?php

/**
 * Migration: Create payment_transactions table
 * 
 * @author  Zoldify Team
 * @date    2026-01-07
 * @version 2.0.0 (refactored)
 */

require_once __DIR__ . '/../BaseMigration.php';

use Database\BaseMigration;

return new class extends BaseMigration {

    protected string $table = 'payment_transactions';

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
                user_id INT NOT NULL,
                amount DECIMAL(15,2) NOT NULL,
                payment_method ENUM('cod', 'payos', 'wallet') NOT NULL,
                transaction_type ENUM('payment', 'refund', 'escrow_hold', 'escrow_release') NOT NULL,
                status ENUM('pending', 'success', 'failed', 'cancelled') DEFAULT 'pending',
                payos_transaction_id VARCHAR(100) DEFAULT NULL,
                description TEXT DEFAULT NULL,
                metadata JSON DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                
                INDEX idx_order_id (order_id),
                INDEX idx_user_id (user_id),
                INDEX idx_status (status),
                INDEX idx_created_at (created_at),
                
                CONSTRAINT fk_payment_trans_order FOREIGN KEY (order_id) 
                    REFERENCES orders(id) ON DELETE CASCADE,
                CONSTRAINT fk_payment_trans_user FOREIGN KEY (user_id) 
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
