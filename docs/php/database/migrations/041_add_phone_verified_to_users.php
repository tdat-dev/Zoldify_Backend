<?php

declare(strict_types=1);

namespace Database\Migrations;

use Database\BaseMigration;

/**
 * Migration: Add phone_verified column to users table
 * 
 * Thêm cột để đánh dấu user đã xác minh số điện thoại chưa.
 * Firebase Phone Auth sẽ xử lý OTP, backend chỉ lưu trạng thái.
 * 
 * @package Database\Migrations
 */
class AddPhoneVerifiedToUsers extends BaseMigration
{
    protected string $table = 'users';

    public function up(): void
    {
        // Thêm cột phone_verified sau phone_number
        $this->addColumn(
            $this->table,
            'phone_verified',
            "TINYINT(1) DEFAULT 0 COMMENT 'Đã xác minh SĐT chưa'",
            'phone_number'
        );

        $this->log("✅ Đã thêm cột 'phone_verified' vào bảng users");
    }

    public function down(): void
    {
        $this->dropColumn($this->table, 'phone_verified');
        $this->log("✅ Đã xóa cột 'phone_verified' khỏi bảng users");
    }
}
