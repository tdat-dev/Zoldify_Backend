<?php
require_once __DIR__ . '/../../app/Core/Database.php';

use App\Core\Database;
use App\Core\RedisCache;

try {
    $db = Database::getInstance();

    // Check if description column exists
    try {
        $db->query("SELECT description FROM categories LIMIT 1");
        echo "Column 'description' already exists.\n";
    } catch (PDOException $e) {
        echo "Column 'description' missing. Adding it...\n";
        // Add description column after name
        $db->execute("ALTER TABLE categories ADD COLUMN description TEXT NULL AFTER name");
        echo "Added 'description' column successfully.\n";
    }

    // Also verify 'image' column just in case (since we had issues before)
    try {
        $db->query("SELECT image FROM categories LIMIT 1");
    } catch (PDOException $e) {
        echo "Column 'image' missing. Adding it...\n";
        $db->execute("ALTER TABLE categories ADD COLUMN image VARCHAR(255) NULL AFTER icon");
        echo "Added 'image' column successfully.\n";
    }

    // Clear cache
    $redis = RedisCache::getInstance();
    if ($redis->isAvailable()) {
        $redis->delete('categories_all_v2');
    }

} catch (Exception $e) {
    echo "Error: " . $e->getMessage();
}
