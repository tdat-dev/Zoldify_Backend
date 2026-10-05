<?php

/**
 * Migration: Create base tables (users, categories)
 * 
 * Tạo 2 bảng nền tảng:
 * - users: Lưu thông tin người dùng
 * - categories: Lưu danh mục sản phẩm
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
        $this->createUsersTable();
        $this->createCategoriesTable();
    }

    public function down(): void
    {
        // Xóa theo thứ tự ngược (categories trước vì có thể có FK)
        $this->dropTable('categories');
        $this->dropTable('users');
    }

    /**
     * Tạo bảng users
     */
    private function createUsersTable(): void
    {
        if ($this->tableExists('users')) {
            $this->skip("Table 'users' already exists");
            return;
        }

        $this->pdo->exec("
            CREATE TABLE users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                full_name VARCHAR(100) NOT NULL,
                email VARCHAR(150) NOT NULL UNIQUE,
                password VARCHAR(255) NOT NULL,
                phone_number VARCHAR(20) DEFAULT NULL,
                address VARCHAR(255) DEFAULT NULL,
                role ENUM('buyer', 'seller', 'admin', 'moderator') DEFAULT 'buyer',
                email_verified TINYINT(1) DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                
                INDEX idx_email (email),
                INDEX idx_role (role)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ");

        $this->success("Created table 'users'");
    }

    /**
     * Tạo bảng categories
     */
    private function createCategoriesTable(): void
    {
        if ($this->tableExists('categories')) {
            $this->skip("Table 'categories' already exists");
            return;
        }

        $this->pdo->exec("
            CREATE TABLE categories (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                icon VARCHAR(50) DEFAULT NULL,
                image VARCHAR(255) DEFAULT NULL,
                
                INDEX idx_name (name)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ");

        $this->success("Created table 'categories'");
    }
};
