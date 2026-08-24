<?php
require_once __DIR__ . '/../../app/Core/Database.php';

use App\Core\Database;

try {
    $db = Database::getInstance();

    // Update image for Books category
    $db->execute("UPDATE categories SET image = '/images/categories/cat_books_premium.png' WHERE name LIKE '%Sách%'");

    // Validate
    $result = $db->fetchOne("SELECT name, image FROM categories WHERE name LIKE '%Sách%' LIMIT 1");
    echo "Updated: " . $result['name'] . " -> " . $result['image'];

} catch (Exception $e) {
    echo "Error: " . $e->getMessage();
}
