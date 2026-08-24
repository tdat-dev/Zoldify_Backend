<?php

/**
 * Migration: Create follows table
 * 
 * @author  Zoldify Team
 * @date    2026-01-03
 * @version 2.0.0 (refactored)
 */

require_once __DIR__ . '/../BaseMigration.php';

use Database\BaseMigration;

return new class extends BaseMigration {

    protected string $table = 'follows';

    public function up(): void
    {
        if ($this->tableExists($this->table)) {
            $this->skip("Table '{$this->table}' already exists");
            return;
        }

        $this->pdo->exec("
            CREATE TABLE {$this->table} (
                id INT AUTO_INCREMENT PRIMARY KEY,
                follower_id INT NOT NULL COMMENT 'User following',
                following_id INT NOT NULL COMMENT 'User being followed',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                
                UNIQUE KEY unique_follow (follower_id, following_id),
                INDEX idx_follower (follower_id),
                INDEX idx_following (following_id),
                
                CONSTRAINT fk_follows_follower FOREIGN KEY (follower_id) 
                    REFERENCES users(id) ON DELETE CASCADE,
                CONSTRAINT fk_follows_following FOREIGN KEY (following_id) 
                    REFERENCES users(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ");

        $this->success("Created table '{$this->table}'");
    }

    public function down(): void
    {
        $this->dropTable($this->table);
    }
};
