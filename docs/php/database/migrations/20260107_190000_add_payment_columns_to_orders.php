<?php

/**
 * Migration: Add payment columns to orders table
 * 
 * Thêm các cột liên quan đến thanh toán PayOS và escrow.
 * 
 * @author  Zoldify Team
 * @date    2026-01-07
 * @version 2.0.0 (refactored)
 */

require_once __DIR__ . '/../BaseMigration.php';

use Database\BaseMigration;

return new class extends BaseMigration {

    protected string $table = 'orders';

    public function up(): void
    {
        // Payment method (COD or PayOS)
        $this->addColumn($this->table, 'payment_method', "ENUM('cod', 'payos') DEFAULT 'cod'", 'status');

        // Payment status
        $this->addColumn($this->table, 'payment_status', "ENUM('pending', 'paid', 'refunded') DEFAULT 'pending'", 'payment_method');

        // PayOS link ID
        $this->addColumn($this->table, 'payment_link_id', "VARCHAR(100) DEFAULT NULL", 'payment_status');

        // PayOS order code (unique)
        $this->addColumn($this->table, 'payos_order_code', "BIGINT UNSIGNED DEFAULT NULL", 'payment_link_id');

        // Timestamps
        $this->addColumn($this->table, 'paid_at', "TIMESTAMP NULL DEFAULT NULL", 'payos_order_code');
        $this->addColumn($this->table, 'received_at', "TIMESTAMP NULL DEFAULT NULL", 'paid_at');
        $this->addColumn($this->table, 'escrow_release_at', "TIMESTAMP NULL DEFAULT NULL", 'received_at');

        // Trial days
        $this->addColumn($this->table, 'trial_days', "TINYINT UNSIGNED DEFAULT 7", 'escrow_release_at');

        // Update order status ENUM to include new statuses
        $this->updateOrderStatusEnum();

        // Add indexes
        $this->addIndex($this->table, 'idx_payment_status', 'payment_status');
        $this->addIndex($this->table, 'idx_payment_link_id', 'payment_link_id');
        $this->addIndex($this->table, 'idx_escrow_release', 'escrow_release_at');
    }

    public function down(): void
    {
        $this->dropIndex($this->table, 'idx_escrow_release');
        $this->dropIndex($this->table, 'idx_payment_link_id');
        $this->dropIndex($this->table, 'idx_payment_status');

        $this->dropColumn($this->table, 'trial_days');
        $this->dropColumn($this->table, 'escrow_release_at');
        $this->dropColumn($this->table, 'received_at');
        $this->dropColumn($this->table, 'paid_at');
        $this->dropColumn($this->table, 'payos_order_code');
        $this->dropColumn($this->table, 'payment_link_id');
        $this->dropColumn($this->table, 'payment_status');
        $this->dropColumn($this->table, 'payment_method');

        // Revert status ENUM
        $this->pdo->exec("ALTER TABLE {$this->table} MODIFY COLUMN status ENUM('pending', 'shipping', 'completed', 'cancelled') DEFAULT 'pending'");
    }

    private function updateOrderStatusEnum(): void
    {
        // Check current ENUM values
        $stmt = $this->pdo->query("SHOW COLUMNS FROM {$this->table} LIKE 'status'");
        $column = $stmt->fetch(PDO::FETCH_ASSOC);
        $currentType = $column['Type'] ?? '';

        // Only update if 'received' is not in the enum
        if (strpos($currentType, 'received') === false) {
            $this->pdo->exec("ALTER TABLE {$this->table} MODIFY COLUMN status ENUM(
                'pending',
                'paid',
                'shipping',
                'received',
                'trial_period',
                'completed',
                'cancelled',
                'refunded'
            ) DEFAULT 'pending'");
            $this->success("Updated status ENUM with new payment statuses");
        } else {
            $this->skip("Status ENUM already updated");
        }
    }
};
