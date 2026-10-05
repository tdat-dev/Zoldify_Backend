<?php

/**
 * Migration: Thêm columns GHN vào bảng orders
 * 
 * Columns mới:
 * - ghn_order_code: Mã vận đơn từ GHN (e.g., FFFNL9HH)
 * - ghn_sort_code: Mã phân loại kho
 * - ghn_expected_delivery: Ngày giao dự kiến
 * - ghn_shipping_fee: Phí ship từ GHN
 * - ghn_status: Trạng thái vận chuyển GHN
 * 
 * @date 2026-01-13
 */

namespace Database;

return new class extends BaseMigration {
    protected string $table = 'orders';

    public function up(): void
    {
        // Thêm các columns GHN (idempotent, không dùng AFTER để tránh lỗi)
        $this->addColumn($this->table, 'ghn_order_code', "VARCHAR(20) NULL COMMENT 'Mã vận đơn GHN'");
        $this->addColumn($this->table, 'ghn_sort_code', "VARCHAR(20) NULL COMMENT 'Mã phân loại kho GHN'");
        $this->addColumn($this->table, 'ghn_expected_delivery', "DATETIME NULL COMMENT 'Ngày giao dự kiến'");
        $this->addColumn($this->table, 'ghn_shipping_fee', "INT UNSIGNED DEFAULT 0 COMMENT 'Phí ship GHN (VND)'");
        $this->addColumn($this->table, 'ghn_status', "VARCHAR(50) NULL COMMENT 'Trạng thái GHN'");

        // Thêm index cho mã vận đơn (để tìm kiếm nhanh)
        $this->addIndex($this->table, 'idx_orders_ghn_order_code', 'ghn_order_code');
    }

    public function down(): void
    {
        // Xóa index trước
        $this->dropIndex($this->table, 'idx_orders_ghn_order_code');

        // Xóa các columns
        $this->dropColumn($this->table, 'ghn_status');
        $this->dropColumn($this->table, 'ghn_shipping_fee');
        $this->dropColumn($this->table, 'ghn_expected_delivery');
        $this->dropColumn($this->table, 'ghn_sort_code');
        $this->dropColumn($this->table, 'ghn_order_code');
    }
};
