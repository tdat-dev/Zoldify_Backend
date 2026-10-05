<?php

/**
 * Migration: Add performance indexes to products table
 * 
 * Indexes được thêm để tối ưu:
 * 1. FULLTEXT index cho tìm kiếm name và description
 * 2. Composite index (status, created_at) cho listing sản phẩm mới
 * 3. Composite index (status, category_id) cho filter theo category
 * 4. Composite index (status, price) cho sort theo giá
 * 5. Index cho quantity (để lọc sản phẩm còn hàng)
 * 
 * @author  Zoldify Team
 * @date    2026-01-15
 * @version 1.0.0
 */

require_once __DIR__ . '/../BaseMigration.php';

use Database\BaseMigration;

return new class extends BaseMigration {

    protected string $table = 'products';

    public function up(): void
    {
        if (!$this->tableExists($this->table)) {
            $this->skip("Table '{$this->table}' does not exist");
            return;
        }

        // 1. FULLTEXT index cho tìm kiếm (name + description)
        // Giúp tìm kiếm nhanh hơn nhiều so với LIKE '%keyword%'
        if (!$this->indexExists($this->table, 'ft_search')) {
            $this->pdo->exec("
                ALTER TABLE {$this->table} 
                ADD FULLTEXT INDEX ft_search (name, description)
            ");
            $this->success("Added FULLTEXT index 'ft_search' on (name, description)");
        }

        // 2. Composite index (status, created_at DESC) 
        // Tối ưu query: WHERE status = 'active' ORDER BY created_at DESC
        if (!$this->indexExists($this->table, 'idx_status_created')) {
            $this->pdo->exec("
                ALTER TABLE {$this->table} 
                ADD INDEX idx_status_created (status, created_at DESC)
            ");
            $this->success("Added composite index 'idx_status_created'");
        }

        // 3. Composite index (status, category_id)
        // Tối ưu query: WHERE status = 'active' AND category_id = ?
        if (!$this->indexExists($this->table, 'idx_status_category')) {
            $this->pdo->exec("
                ALTER TABLE {$this->table} 
                ADD INDEX idx_status_category (status, category_id)
            ");
            $this->success("Added composite index 'idx_status_category'");
        }

        // 4. Composite index (status, price)
        // Tối ưu query: WHERE status = 'active' ORDER BY price ASC/DESC
        if (!$this->indexExists($this->table, 'idx_status_price')) {
            $this->pdo->exec("
                ALTER TABLE {$this->table} 
                ADD INDEX idx_status_price (status, price)
            ");
            $this->success("Added composite index 'idx_status_price'");
        }

        // 5. Index cho quantity
        // Tối ưu query: WHERE quantity > 0 (sản phẩm còn hàng)
        if (!$this->indexExists($this->table, 'idx_quantity')) {
            $this->pdo->exec("
                ALTER TABLE {$this->table} 
                ADD INDEX idx_quantity (quantity)
            ");
            $this->success("Added index 'idx_quantity'");
        }

        // 6. Composite index (user_id, status)
        // Tối ưu query: WHERE user_id = ? AND status = ? (shop của seller)
        if (!$this->indexExists($this->table, 'idx_user_status')) {
            $this->pdo->exec("
                ALTER TABLE {$this->table} 
                ADD INDEX idx_user_status (user_id, status)
            ");
            $this->success("Added composite index 'idx_user_status'");
        }
    }

    public function down(): void
    {
        $indexesToDrop = [
            'ft_search',
            'idx_status_created',
            'idx_status_category',
            'idx_status_price',
            'idx_quantity',
            'idx_user_status'
        ];

        foreach ($indexesToDrop as $indexName) {
            if ($this->indexExists($this->table, $indexName)) {
                $this->pdo->exec("ALTER TABLE {$this->table} DROP INDEX {$indexName}");
                $this->success("Dropped index '{$indexName}'");
            }
        }
    }
};
