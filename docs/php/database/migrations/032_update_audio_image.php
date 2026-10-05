<?php
require_once __DIR__ . '/../../app/Core/Database.php';

use App\Core\Database;

try {
    $db = Database::getInstance();

    // Cập nhật ảnh cho danh mục Âm thanh
    $db->execute(
        "UPDATE categories SET image = :image WHERE name = :name AND parent_id IS NULL",
        ['image' => '/images/categories/cat_audio.png', 'name' => 'Âm thanh']
    );

    // Clear Redis cache
    $redis = \App\Core\RedisCache::getInstance();
    if ($redis->isAvailable()) {
        $redis->delete('categories_all_v2');
    }

    echo "Done! Updated Audio category image.\n";

} catch (Exception $e) {
    echo "Error: " . $e->getMessage();
}
