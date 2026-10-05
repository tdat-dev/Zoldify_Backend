<?php
require_once __DIR__ . '/../../app/Core/Database.php';

use App\Core\Database;

try {
    $db = Database::getInstance();

    // 1. Add 'image' column if not exists
    try {
        $db->query("SELECT image FROM categories LIMIT 1");
    } catch (PDOException $e) {
        echo "Column 'image' missing. Adding it...\n";
        $db->execute("ALTER TABLE categories ADD COLUMN image VARCHAR(255) NULL AFTER icon");
    }

    // 2. Update image for Books category
    $db->execute("UPDATE categories SET image = '/images/categories/cat_books_premium.png' WHERE name LIKE '%Sách%'");

    // Validate
    $result = $db->fetchOne("SELECT name, image FROM categories WHERE name LIKE '%Sách%' LIMIT 1");
    echo "Updated: " . $result['name'] . " -> " . $result['image'];

    // Clear cache just in case
    $redis = \App\Core\RedisCache::getInstance();
    if ($redis->isAvailable()) {
        $redis->delete('categories_all_v2');
    }

} catch (Exception $e) {
    echo "Error: " . $e->getMessage();
}
