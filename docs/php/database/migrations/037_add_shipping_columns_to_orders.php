<?php

/**
 * Migration: Add shipping columns to orders
 * 
 * @author  Zoldify Team
 * @date    2026-01-09
 * @version 2.0.0 (refactored)
 */

require_once __DIR__ . '/../BaseMigration.php';

use Database\BaseMigration;

return new class extends BaseMigration {

    protected string $table = 'orders';

    public function up(): void
    {
        // Shipping address info
        $this->addColumn($this->table, 'shipping_address_id', "INT DEFAULT NULL", 'total_amount');
        $this->addColumn($this->table, 'shipping_address_snapshot', "JSON DEFAULT NULL", 'shipping_address_id');
        $this->addColumn($this->table, 'shipping_fee', "DECIMAL(10,2) DEFAULT 0.00", 'shipping_address_snapshot');
        $this->addColumn($this->table, 'shipping_note', "TEXT DEFAULT NULL", 'shipping_fee');

        // Add index
        if (!$this->indexExists($this->table, 'idx_shipping_address')) {
            $this->addIndex($this->table, 'idx_shipping_address', 'shipping_address_id');
        }
    }

    public function down(): void
    {
        $this->dropIndex($this->table, 'idx_shipping_address');
        $this->dropColumn($this->table, 'shipping_note');
        $this->dropColumn($this->table, 'shipping_fee');
        $this->dropColumn($this->table, 'shipping_address_snapshot');
        $this->dropColumn($this->table, 'shipping_address_id');
    }
};
