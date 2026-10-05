<?php

/**
 * Migration: Create wallet_transactions table
 * 
 * @author  Zoldify Team
 * @date    2026-01-07
 * @version 2.0.0 (refactored)
 */

require_once __DIR__ . '/../BaseMigration.php';

use Database\BaseMigration;

return new class extends BaseMigration {

    protected string $table = 'wallet_transactions';

    public function up(): void
    {
        if ($this->tableExists($this->table)) {
            $this->skip("Table '{$this->table}' already exists");
            return;
        }

        $this->pdo->exec("
            CREATE TABLE {$this->table} (
                id INT AUTO_INCREMENT PRIMARY KEY,
                wallet_id INT NOT NULL,
                user_id INT NOT NULL,
                type ENUM('deposit', 'withdraw', 'payment', 'refund', 'escrow_hold', 'escrow_release') NOT NULL,
                amount DECIMAL(15,2) NOT NULL,
                balance_before DECIMAL(15,2) NOT NULL,
                balance_after DECIMAL(15,2) NOT NULL,
                reference_type VARCHAR(50) DEFAULT NULL COMMENT 'order, payment, etc.',
                reference_id INT DEFAULT NULL,
                description TEXT DEFAULT NULL,
                status ENUM('pending', 'completed', 'failed') DEFAULT 'completed',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                
                INDEX idx_wallet_id (wallet_id),
                INDEX idx_user_id (user_id),
                INDEX idx_type (type),
                INDEX idx_reference (reference_type, reference_id),
                INDEX idx_created_at (created_at),
                
                CONSTRAINT fk_wallet_trans_wallet FOREIGN KEY (wallet_id) 
                    REFERENCES wallets(id) ON DELETE CASCADE,
                CONSTRAINT fk_wallet_trans_user FOREIGN KEY (user_id) 
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
