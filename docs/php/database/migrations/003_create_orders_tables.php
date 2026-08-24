<?php

/**
 * Migration: Create orders and order_details tables
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
        $this->createOrdersTable();
        $this->createOrderDetailsTable();
    }

    public function down(): void
    {
        // Xóa theo thứ tự ngược (order_details trước vì có FK đến orders)
        $this->dropTable('order_details');
        $this->dropTable('orders');
    }

    private function createOrdersTable(): void
    {
        if ($this->tableExists('orders')) {
            $this->skip("Table 'orders' already exists");
            return;
        }

        $this->pdo->exec("
            CREATE TABLE orders (
                id INT AUTO_INCREMENT PRIMARY KEY,
                buyer_id INT NOT NULL COMMENT 'Người mua',
                seller_id INT NOT NULL COMMENT 'Người bán',
                total_amount DECIMAL(10,2) NOT NULL,
                status ENUM('pending', 'shipping', 'completed', 'cancelled') DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                
                INDEX idx_buyer_id (buyer_id),
                INDEX idx_seller_id (seller_id),
                INDEX idx_status (status),
                INDEX idx_created_at (created_at),
                
                CONSTRAINT fk_orders_buyer FOREIGN KEY (buyer_id) 
                    REFERENCES users(id) ON DELETE CASCADE,
                CONSTRAINT fk_orders_seller FOREIGN KEY (seller_id) 
                    REFERENCES users(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ");

        $this->success("Created table 'orders'");
    }

    private function createOrderDetailsTable(): void
    {
        if ($this->tableExists('order_details')) {
            $this->skip("Table 'order_details' already exists");
            return;
        }

        $this->pdo->exec("
            CREATE TABLE order_details (
                id INT AUTO_INCREMENT PRIMARY KEY,
                order_id INT NOT NULL,
                product_id INT NOT NULL,
                quantity INT NOT NULL DEFAULT 1,
                price_at_purchase DECIMAL(10,2) NOT NULL,
                
                INDEX idx_order_id (order_id),
                INDEX idx_product_id (product_id),
                
                CONSTRAINT fk_order_details_order FOREIGN KEY (order_id) 
                    REFERENCES orders(id) ON DELETE CASCADE,
                CONSTRAINT fk_order_details_product FOREIGN KEY (product_id) 
                    REFERENCES products(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ");

        $this->success("Created table 'order_details'");
    }
};
