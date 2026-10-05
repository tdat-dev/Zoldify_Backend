<?php

/**
 * Migration: Add resolved_at column to reports table
 * 
 * @author  GitHub Copilot
 * @date    2026-01-18
 * @version 1.0.0
 */

require_once __DIR__ . '/../BaseMigration.php';

use Database\BaseMigration;

return new class extends BaseMigration {

    /**
     * Tên bảng chính
     */
    protected string $table = 'reports';

    /**
     * Chạy migration
     */
    public function up(): void
    {
        // Thêm cột resolved_at
        $this->addColumn($this->table, 'resolved_at', "DATETIME NULL DEFAULT NULL", 'status');
    }

    /**
     * Rollback migration
     */
    public function down(): void
    {
        // Xóa cột resolved_at
        $this->dropColumn($this->table, 'resolved_at');
    }
};
