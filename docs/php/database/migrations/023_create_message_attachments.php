<?php

/**
 * Migration: Create message_attachments table
 * 
 * @author  Zoldify Team
 * @date    2026-01-03
 * @version 2.0.0 (refactored)
 */

require_once __DIR__ . '/../BaseMigration.php';

use Database\BaseMigration;

return new class extends BaseMigration {

    protected string $table = 'message_attachments';

    public function up(): void
    {
        if ($this->tableExists($this->table)) {
            $this->skip("Table '{$this->table}' already exists");
            return;
        }

        $this->pdo->exec("
            CREATE TABLE {$this->table} (
                id INT AUTO_INCREMENT PRIMARY KEY,
                message_id INT NOT NULL,
                file_name VARCHAR(255) NOT NULL,
                file_path VARCHAR(500) NOT NULL,
                file_type VARCHAR(50) NOT NULL,
                file_size INT NOT NULL DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                
                INDEX idx_message_id (message_id),
                
                CONSTRAINT fk_attachments_message FOREIGN KEY (message_id) 
                    REFERENCES messages(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ");

        // Add has_attachment column to messages
        $this->addColumn('messages', 'has_attachment', "TINYINT(1) DEFAULT 0", 'is_read');

        $this->success("Created table '{$this->table}'");
    }

    public function down(): void
    {
        $this->dropColumn('messages', 'has_attachment');
        $this->dropTable($this->table);
    }
};
