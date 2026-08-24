<?php
require_once __DIR__ . '/../../app/Core/Database.php';

use App\Core\Database;

try {
    $db = Database::getInstance();

    // Cập nhật ảnh cho các danh mục bị trùng
    $updates = [
        ['name' => 'Thú cưng', 'image' => '/images/categories/cat_pet.png'],
        ['name' => 'Đồ học tập', 'image' => '/images/categories/cat_school.png'],
    ];

    foreach ($updates as $update) {
        $db->execute(
            "UPDATE categories SET image = :image WHERE name = :name AND parent_id IS NULL",
            ['image' => $update['image'], 'name' => $update['name']]
        );
        echo "Updated: {$update['name']} -> {$update['image']}\n";
    }

    // Clear Redis cache
    $redis = \App\Core\RedisCache::getInstance();
    if ($redis->isAvailable()) {
        $redis->delete('categories_all_v2');
    }

    echo "\nDone! Fixed duplicate images.\n";

} catch (Exception $e) {
    echo "Error: " . $e->getMessage();
}
