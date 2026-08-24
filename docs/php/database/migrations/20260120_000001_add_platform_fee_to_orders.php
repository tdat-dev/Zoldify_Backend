<?php

/**
 * Migration: Thêm column platform_fee và seller_amount vào bảng orders
 * 
 * Columns mới:
 * - platform_fee: Phí sàn (5% tổng đơn)
 * - seller_amount: Số tiền seller nhận được (total - platform_fee)
 * 
 * @date 2026-01-20
 */

namespace Database;

return new class extends BaseMigration {
    protected string $table = 'orders';

    public function up(): void
    {
        // Thêm column platform_fee (phí sàn thu được)
        $this->addColumn(
            $this->table,
            'platform_fee',
            "DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT 'Phí sàn (VND)'",
            'total_amount'
        );

        // Thêm column seller_amount (số tiền seller nhận)
        $this->addColumn(
            $this->table,
            'seller_amount',
            "DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT 'Tiền seller nhận sau phí (VND)'",
            'platform_fee'
        );

        // Cập nhật các đơn hàng cũ: tính lại platform_fee và seller_amount
        // Phí sàn = 5%
        $this->pdo->exec("
            UPDATE {$this->table} 
            SET platform_fee = ROUND(total_amount * 0.05, 2),
                seller_amount = ROUND(total_amount * 0.95, 2)
            WHERE platform_fee = 0
        ");
    }

    public function down(): void
    {
        $this->dropColumn($this->table, 'seller_amount');
        $this->dropColumn($this->table, 'platform_fee');
    }
};
