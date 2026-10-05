<?php

/**
 * Migration: Update categories structure and add parent_id, description, tag, sort_order
 * 
 * @author  Zoldify Team
 * @date    2026-01-03
 * @version 2.0.0 (refactored)
 */

require_once __DIR__ . '/../BaseMigration.php';

use Database\BaseMigration;

return new class extends BaseMigration {

    protected string $table = 'categories';

    public function up(): void
    {
        // Add parent_id for subcategories
        $this->addColumn($this->table, 'parent_id', "INT DEFAULT NULL", 'id');

        // Add description
        $this->addColumn($this->table, 'description', "TEXT DEFAULT NULL", 'name');

        // Add tag (Hot, New, etc.)
        $this->addColumn($this->table, 'tag', "VARCHAR(50) DEFAULT NULL", 'description');

        // Add sort_order
        $this->addColumn($this->table, 'sort_order', "INT DEFAULT 0", 'image');

        // Add index on parent_id
        if (!$this->indexExists($this->table, 'idx_parent_id')) {
            $this->addIndex($this->table, 'idx_parent_id', 'parent_id');
        }

        // Add foreign key for parent_id (self-referencing)
        if (!$this->foreignKeyExists($this->table, 'fk_category_parent')) {
            try {
                $this->pdo->exec("
                    ALTER TABLE {$this->table} 
                    ADD CONSTRAINT fk_category_parent 
                    FOREIGN KEY (parent_id) REFERENCES {$this->table}(id) ON DELETE CASCADE
                ");
                $this->success("Added foreign key 'fk_category_parent'");
            } catch (PDOException $e) {
                $this->warning("Could not add FK: " . $e->getMessage());
            }
        }
    }

    public function down(): void
    {
        // Remove FK first
        if ($this->foreignKeyExists($this->table, 'fk_category_parent')) {
            $this->pdo->exec("ALTER TABLE {$this->table} DROP FOREIGN KEY fk_category_parent");
        }

        $this->dropIndex($this->table, 'idx_parent_id');
        $this->dropColumn($this->table, 'sort_order');
        $this->dropColumn($this->table, 'tag');
        $this->dropColumn($this->table, 'description');
        $this->dropColumn($this->table, 'parent_id');
    }
};
