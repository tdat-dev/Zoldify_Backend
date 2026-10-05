<?php
require_once __DIR__ . '/../../app/Core/Database.php';

use App\Core\Database;

try {
    $db = Database::getInstance();

    // Update images for all parent categories
    $updates = [
        ['name' => '%Đồ điện tử%', 'image' => '/images/categories/cat_electronics.png'],
        ['name' => '%Đồ học tập%', 'image' => '/images/categories/cat_school.png'],
        ['name' => '%Thời trang%', 'image' => '/images/categories/cat_fashion.png'],
        ['name' => '%Phụ kiện%', 'image' => '/images/categories/cat_accessories.png'],
        ['name' => '%Khác%', 'image' => '/images/categories/cat_other.png'],
    ];

    foreach ($updates as $update) {
        $db->execute(
            "UPDATE categories SET image = :image WHERE name LIKE :name AND parent_id IS NULL",
            ['image' => $update['image'], 'name' => $update['name']]
        );
        echo "Updated: {$update['name']} -> {$update['image']}\n";
    }

    // Clear Redis cache
    $redis = \App\Core\RedisCache::getInstance();
    if ($redis->isAvailable()) {
        $redis->delete('categories_all_v2');
    }

    echo "\nAll category images updated successfully!";

} catch (Exception $e) {
    echo "Error: " . $e->getMessage();
}
