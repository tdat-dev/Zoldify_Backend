<?php

/**
 * Migration: Seed categories data
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
        // Check if categories already have data
        $count = $this->pdo->query("SELECT COUNT(*) FROM categories")->fetchColumn();
        if ($count > 0) {
            $this->skip("Categories already seeded ({$count} records)");
            return;
        }

        $categories = [
            ['name' => 'Sách & Giáo trình', 'icon' => 'fa-book', 'image' => '/images/categories/cat_books.png'],
            ['name' => 'Đồ điện tử', 'icon' => 'fa-laptop', 'image' => '/images/categories/cat_electronics.png'],
            ['name' => 'Thời trang', 'icon' => 'fa-shirt', 'image' => '/images/categories/cat_fashion.png'],
            ['name' => 'Đồ học tập', 'icon' => 'fa-pen-ruler', 'image' => '/images/categories/cat_school.png'],
            ['name' => 'Thể thao & Đời sống', 'icon' => 'fa-dumbbell', 'image' => '/images/categories/cat_sports.png'],
            ['name' => 'Khác', 'icon' => 'fa-box-open', 'image' => '/images/categories/cat_other.png'],
        ];

        $stmt = $this->pdo->prepare("INSERT INTO categories (name, icon, image) VALUES (?, ?, ?)");

        foreach ($categories as $cat) {
            $stmt->execute([$cat['name'], $cat['icon'], $cat['image']]);
        }

        $this->success("Seeded " . count($categories) . " categories");
    }

    public function down(): void
    {
        // Only delete if we seeded them (protect user data)
        $this->warning("Skipping category deletion to protect user data");
    }
};
