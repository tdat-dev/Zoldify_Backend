<?php

/**
 * Migration: Correct category images paths
 * 
 * @author  Zoldify Team
 * @date    2025-12-01
 * @version 2.0.0 (refactored)
 */

require_once __DIR__ . '/../BaseMigration.php';

use Database\BaseMigration;

return new class extends BaseMigration {

    private array $imageUpdates = [
        'Sách & Giáo trình' => '/images/categories/cat_books_premium.png',
        'Đồ điện tử' => '/images/categories/cat_electronics.png',
        'Thời trang' => '/images/categories/cat_fashion.png',
        'Đồ học tập' => '/images/categories/cat_school.png',
        'Thể thao & Đời sống' => '/images/categories/cat_sport.png',
        'Khác' => '/images/categories/cat_other.png',
    ];

    public function up(): void
    {
        $stmt = $this->pdo->prepare("UPDATE categories SET image = ? WHERE name = ?");

        $updated = 0;
        foreach ($this->imageUpdates as $name => $image) {
            $stmt->execute([$image, $name]);
            if ($stmt->rowCount() > 0) {
                $updated++;
            }
        }

        if ($updated > 0) {
            $this->success("Updated {$updated} category images");
        } else {
            $this->skip("No category images to update");
        }
    }

    public function down(): void
    {
        // Reverse to old paths
        $oldImages = [
            'Sách & Giáo trình' => '/images/categories/cat_books.png',
            'Đồ điện tử' => '/images/categories/cat_electronics.png',
            'Thời trang' => '/images/categories/cat_fashion.png',
            'Đồ học tập' => '/images/categories/cat_school.png',
            'Thể thao & Đời sống' => '/images/categories/cat_sports.png',
            'Khác' => '/images/categories/cat_other.png',
        ];

        $stmt = $this->pdo->prepare("UPDATE categories SET image = ? WHERE name = ?");

        foreach ($oldImages as $name => $image) {
            $stmt->execute([$image, $name]);
        }

        $this->success("Reverted category images");
    }
};
