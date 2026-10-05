<?php

/**
 * Migration: Create social tables (messages, reviews, favorites)
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
        $this->createMessagesTable();
        $this->createReviewsTable();
        $this->createFavoritesTable();
    }

    public function down(): void
    {
        $this->dropTable('favorites');
        $this->dropTable('reviews');
        $this->dropTable('messages');
    }

    private function createMessagesTable(): void
    {
        if ($this->tableExists('messages')) {
            $this->skip("Table 'messages' already exists");
            return;
        }

        $this->pdo->exec("
            CREATE TABLE messages (
                id INT AUTO_INCREMENT PRIMARY KEY,
                sender_id INT NOT NULL,
                receiver_id INT NOT NULL,
                content TEXT NOT NULL,
                is_read TINYINT(1) DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                
                INDEX idx_sender_id (sender_id),
                INDEX idx_receiver_id (receiver_id),
                INDEX idx_conversation (sender_id, receiver_id),
                
                CONSTRAINT fk_messages_sender FOREIGN KEY (sender_id) 
                    REFERENCES users(id) ON DELETE CASCADE,
                CONSTRAINT fk_messages_receiver FOREIGN KEY (receiver_id) 
                    REFERENCES users(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ");

        $this->success("Created table 'messages'");
    }

    private function createReviewsTable(): void
    {
        if ($this->tableExists('reviews')) {
            $this->skip("Table 'reviews' already exists");
            return;
        }

        $this->pdo->exec("
            CREATE TABLE reviews (
                id INT AUTO_INCREMENT PRIMARY KEY,
                reviewer_id INT NOT NULL,
                product_id INT NOT NULL,
                rating INT DEFAULT NULL CHECK (rating >= 1 AND rating <= 5),
                comment TEXT DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                
                INDEX idx_reviewer_id (reviewer_id),
                INDEX idx_product_id (product_id),
                
                CONSTRAINT fk_reviews_reviewer FOREIGN KEY (reviewer_id) 
                    REFERENCES users(id) ON DELETE CASCADE,
                CONSTRAINT fk_reviews_product FOREIGN KEY (product_id) 
                    REFERENCES products(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ");

        $this->success("Created table 'reviews'");
    }

    private function createFavoritesTable(): void
    {
        if ($this->tableExists('favorites')) {
            $this->skip("Table 'favorites' already exists");
            return;
        }

        $this->pdo->exec("
            CREATE TABLE favorites (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                product_id INT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                
                UNIQUE KEY unique_user_product (user_id, product_id),
                INDEX idx_user_id (user_id),
                INDEX idx_product_id (product_id),
                
                CONSTRAINT fk_favorites_user FOREIGN KEY (user_id) 
                    REFERENCES users(id) ON DELETE CASCADE,
                CONSTRAINT fk_favorites_product FOREIGN KEY (product_id) 
                    REFERENCES products(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ");

        $this->success("Created table 'favorites'");
    }
};
