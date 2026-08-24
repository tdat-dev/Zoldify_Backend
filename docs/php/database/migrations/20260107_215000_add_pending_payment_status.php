<?php

/**
 * Migration: Add pending payment status to orders
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
        // Check current ENUM values
        $stmt = $this->pdo->query("SHOW COLUMNS FROM {$this->table} LIKE 'status'");
        $column = $stmt->fetch(PDO::FETCH_ASSOC);
        $currentType = $column['Type'] ?? '';

        // Only update if 'pending_payment' is not in the enum
        if (strpos($currentType, 'pending_payment') === false) {
            $this->pdo->exec("ALTER TABLE {$this->table} MODIFY COLUMN status ENUM(
                'pending',
                'pending_payment',
                'paid',
                'shipping',
                'received',
                'trial_period',
                'completed',
                'cancelled',
                'refunded'
            ) DEFAULT 'pending'");
            $this->success("Added 'pending_payment' to status ENUM");
        } else {
            $this->skip("Status ENUM already has 'pending_payment'");
        }
    }

    public function down(): void
    {
        // Revert to previous ENUM (without pending_payment)
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
        $this->success("Removed 'pending_payment' from status ENUM");
    }
};
