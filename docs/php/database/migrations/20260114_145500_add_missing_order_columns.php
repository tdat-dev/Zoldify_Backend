<?php

/**
 * Migration: Add missing columns to orders table
 * 
 * Thêm các cột còn thiếu: shipping, payment, payos
 * 
 * @author  Zoldify Team
 * @date    2026-01-14
 */

require_once __DIR__ . '/../BaseMigration.php';

use Database\BaseMigration;

return new class extends BaseMigration {

    protected string $table = 'orders';

    public function up(): void
    {
        // Shipping columns
        if (!$this->columnExists($this->table, 'shipping_address_id')) {
            $this->addColumn($this->table, 'shipping_address_id', "INT DEFAULT NULL", 'total_amount');
        }
        
        if (!$this->columnExists($this->table, 'shipping_address_snapshot')) {
            $this->addColumn($this->table, 'shipping_address_snapshot', "JSON DEFAULT NULL", 'shipping_address_id');
        }
        
        if (!$this->columnExists($this->table, 'shipping_fee')) {
            $this->addColumn($this->table, 'shipping_fee', "DECIMAL(10,2) DEFAULT 0.00", 'shipping_address_snapshot');
        }
        
        if (!$this->columnExists($this->table, 'shipping_note')) {
            $this->addColumn($this->table, 'shipping_note', "TEXT DEFAULT NULL", 'shipping_fee');
        }

        // Payment columns
        if (!$this->columnExists($this->table, 'payment_method')) {
            $this->addColumn($this->table, 'payment_method', "ENUM('cod', 'bank_transfer', 'payos') DEFAULT 'cod'", 'status');
        }
        
        if (!$this->columnExists($this->table, 'payment_status')) {
            $this->addColumn($this->table, 'payment_status', "ENUM('pending', 'paid', 'failed', 'refunded') DEFAULT 'pending'", 'payment_method');
        }
        
        if (!$this->columnExists($this->table, 'payos_order_code')) {
            $this->addColumn($this->table, 'payos_order_code', "BIGINT UNSIGNED DEFAULT NULL", 'payment_status');
        }

        // Completed timestamp
        if (!$this->columnExists($this->table, 'completed_at')) {
            $this->addColumn($this->table, 'completed_at', "TIMESTAMP NULL DEFAULT NULL", 'escrow_release_at');
        }

        // Add index for shipping_address_id
        if (!$this->indexExists($this->table, 'idx_shipping_address')) {
            $this->addIndex($this->table, 'idx_shipping_address', 'shipping_address_id');
        }
        
        // Add index for payos_order_code
        if (!$this->indexExists($this->table, 'idx_payos_order_code')) {
            $this->addIndex($this->table, 'idx_payos_order_code', 'payos_order_code');
        }
    }

    public function down(): void
    {
        $this->dropIndex($this->table, 'idx_payos_order_code');
        $this->dropIndex($this->table, 'idx_shipping_address');
        
        $this->dropColumn($this->table, 'completed_at');
        $this->dropColumn($this->table, 'payos_order_code');
        $this->dropColumn($this->table, 'payment_status');
        $this->dropColumn($this->table, 'payment_method');
        $this->dropColumn($this->table, 'shipping_note');
        $this->dropColumn($this->table, 'shipping_fee');
        $this->dropColumn($this->table, 'shipping_address_snapshot');
        $this->dropColumn($this->table, 'shipping_address_id');
    }
};
