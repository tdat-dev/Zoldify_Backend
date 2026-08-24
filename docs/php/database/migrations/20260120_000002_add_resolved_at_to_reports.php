<?php

/**
 * Migration: Thêm column resolved_at vào bảng reports
 * 
 * Column mới:
 * - resolved_at: Thời điểm xử lý report
 * 
 * @date 2026-01-20
 */

namespace Database;

return new class extends BaseMigration {
    protected string $table = 'reports';

    public function up(): void
    {
        // Thêm column resolved_at sau status
        $this->addColumn(
            $this->table,
            'resolved_at',
            "DATETIME NULL COMMENT 'Thời điểm xử lý'",
            'status'
        );
    }

    public function down(): void
    {
        $this->dropColumn($this->table, 'resolved_at');
    }
};
