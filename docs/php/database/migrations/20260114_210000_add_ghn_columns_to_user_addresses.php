<?php

/**
 * Migration: Thêm columns GHN vào bảng user_addresses
 * 
 * Columns mới:
 * - ghn_province_id: Mã tỉnh GHN
 * - ghn_district_id: Mã quận GHN  
 * - ghn_ward_code: Mã phường GHN
 * 
 * Dùng để tạo đơn GHN với địa chỉ seller/buyer chính xác.
 * 
 * @date 2026-01-14
 */

namespace Database;

return new class extends BaseMigration {
    protected string $table = 'user_addresses';

    public function up(): void
    {
        // Thêm các columns GHN codes
        $this->addColumn($this->table, 'ghn_province_id', "INT NULL COMMENT 'Mã tỉnh GHN'", 'here_place_id');
        $this->addColumn($this->table, 'ghn_district_id', "INT NULL COMMENT 'Mã quận GHN'", 'ghn_province_id');
        $this->addColumn($this->table, 'ghn_ward_code', "VARCHAR(10) NULL COMMENT 'Mã phường GHN'", 'ghn_district_id');

        // Thêm index cho district_id (dùng khi tính phí ship)
        $this->addIndex($this->table, 'idx_ghn_district', 'ghn_district_id');
    }

    public function down(): void
    {
        // Xóa index trước
        $this->dropIndex($this->table, 'idx_ghn_district');

        // Xóa các columns
        $this->dropColumn($this->table, 'ghn_ward_code');
        $this->dropColumn($this->table, 'ghn_district_id');
        $this->dropColumn($this->table, 'ghn_province_id');
    }
};
