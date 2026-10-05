<?php

/**
 * Migration: Create system tables (interactions, notifications, reports)
 * 
 * @author  Zoldify Team
 * @date    2025-12-01
 * @version 2.0.0 (refactored)
 */

require_once __DIR__ . '/../BaseMigration.php';

use Database\BaseMigration;

return new class extends BaseMigration {

    public function up(): void
    {
        $this->createInteractionsTable();
        $this->createNotificationsTable();
        $this->createReportsTable();
    }

    public function down(): void
    {
        $this->dropTable('reports');
        $this->dropTable('notifications');
        $this->dropTable('interactions');
    }

    private function createInteractionsTable(): void
    {
        if ($this->tableExists('interactions')) {
            $this->skip("Table 'interactions' already exists");
            return;
        }

        $this->pdo->exec("
            CREATE TABLE interactions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                product_id INT NOT NULL,
                interaction_type ENUM('view', 'click') NOT NULL,
                score INT DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                
                INDEX idx_user_id (user_id),
                INDEX idx_product_id (product_id),
                INDEX idx_type (interaction_type),
                
                CONSTRAINT fk_interactions_user FOREIGN KEY (user_id) 
                    REFERENCES users(id) ON DELETE CASCADE,
                CONSTRAINT fk_interactions_product FOREIGN KEY (product_id) 
                    REFERENCES products(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ");

        $this->success("Created table 'interactions'");
    }

    private function createNotificationsTable(): void
    {
        if ($this->tableExists('notifications')) {
            $this->skip("Table 'notifications' already exists");
            return;
        }

        $this->pdo->exec("
            CREATE TABLE notifications (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                content VARCHAR(255) NOT NULL,
                is_read TINYINT(1) DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                
                INDEX idx_user_id (user_id),
                INDEX idx_is_read (is_read),
                
                CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) 
                    REFERENCES users(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ");

        $this->success("Created table 'notifications'");
    }

    private function createReportsTable(): void
    {
        if ($this->tableExists('reports')) {
            $this->skip("Table 'reports' already exists");
            return;
        }

        $this->pdo->exec("
            CREATE TABLE reports (
                id INT AUTO_INCREMENT PRIMARY KEY,
                reporter_id INT NOT NULL,
                product_id INT NOT NULL,
                reason TEXT NOT NULL,
                status ENUM('pending', 'resolved') DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                
                INDEX idx_reporter_id (reporter_id),
                INDEX idx_product_id (product_id),
                INDEX idx_status (status),
                
                CONSTRAINT fk_reports_reporter FOREIGN KEY (reporter_id) 
                    REFERENCES users(id) ON DELETE CASCADE,
                CONSTRAINT fk_reports_product FOREIGN KEY (product_id) 
                    REFERENCES products(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ");

        $this->success("Created table 'reports'");
    }
};
