<?php

/**
 * Migration: Thêm column view_count vào bảng products
 * 
 * Column mới:
 * - view_count: Số lượt xem sản phẩm
 * 
 * @date 2026-01-20
 */

namespace Database;

return new class extends BaseMigration {
    protected string $table = 'products';

    public function up(): void
    {
        // Thêm column view_count sau quantity
        $this->addColumn($this->table, 'view_count', "INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Số lượt xem'", 'quantity');

        // Thêm index để tối ưu query sắp xếp theo lượt xem
        $this->addIndex($this->table, 'idx_view_count', 'view_count');
    }

    public function down(): void
    {
        // Xóa index trước
        $this->dropIndex($this->table, 'idx_view_count');

        // Xóa column
        $this->dropColumn($this->table, 'view_count');
    }
};
