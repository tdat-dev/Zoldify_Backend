<?php
require_once __DIR__ . '/../../app/Core/Database.php';

use App\Core\Database;

try {
    $db = Database::getInstance();

    // Thêm 14 danh mục cha mới với ảnh
    $newCategories = [
        ['name' => 'Điện thoại', 'icon' => 'fa-mobile-screen', 'image' => '/images/categories/cat_phone.png'],
        ['name' => 'Laptop', 'icon' => 'fa-laptop', 'image' => '/images/categories/cat_laptop.png'],
        ['name' => 'Máy ảnh', 'icon' => 'fa-camera', 'image' => '/images/categories/cat_camera.png'],
        ['name' => 'Đồng hồ', 'icon' => 'fa-clock', 'image' => '/images/categories/cat_watch.png'],
        ['name' => 'Giày dép', 'icon' => 'fa-shoe-prints', 'image' => '/images/categories/cat_shoes.png'],
        ['name' => 'Túi xách & Ví', 'icon' => 'fa-bag-shopping', 'image' => '/images/categories/cat_bag.png'],
        ['name' => 'Nhà cửa & Đời sống', 'icon' => 'fa-house', 'image' => '/images/categories/cat_home.png'],
        ['name' => 'Thể thao & Du lịch', 'icon' => 'fa-dumbbell', 'image' => '/images/categories/cat_sport.png'],
        ['name' => 'Sắc đẹp', 'icon' => 'fa-spa', 'image' => '/images/categories/cat_beauty.png'],
        ['name' => 'Sức khỏe', 'icon' => 'fa-heart-pulse', 'image' => '/images/categories/cat_health.png'],
        ['name' => 'Mẹ & Bé', 'icon' => 'fa-baby', 'image' => '/images/categories/cat_mom_baby.png'],
        ['name' => 'Xe cộ', 'icon' => 'fa-motorcycle', 'image' => '/images/categories/cat_vehicle.png'],
        ['name' => 'Thú cưng', 'icon' => 'fa-paw', 'image' => '/images/categories/cat_other.png'], // Tạm dùng ảnh khác
        ['name' => 'Âm thanh', 'icon' => 'fa-headphones', 'image' => '/images/categories/cat_electronics.png'], // Tạm dùng ảnh điện tử
    ];

    foreach ($newCategories as $cat) {
        // Kiểm tra xem danh mục đã tồn tại chưa
        $existing = $db->fetchOne("SELECT id FROM categories WHERE name = :name AND parent_id IS NULL", ['name' => $cat['name']]);

        if (!$existing) {
            $db->insert(
                "INSERT INTO categories (name, icon, image, parent_id) VALUES (:name, :icon, :image, NULL)",
                ['name' => $cat['name'], 'icon' => $cat['icon'], 'image' => $cat['image']]
            );
            echo "Added: {$cat['name']}\n";
        } else {
            // Cập nhật ảnh nếu đã tồn tại
            $db->execute(
                "UPDATE categories SET image = :image WHERE id = :id",
                ['image' => $cat['image'], 'id' => $existing['id']]
            );
            echo "Updated image for: {$cat['name']}\n";
        }
    }

    // Clear Redis cache
    $redis = \App\Core\RedisCache::getInstance();
    if ($redis->isAvailable()) {
        $redis->delete('categories_all_v2');
    }

    echo "\n=== Done! Total parent categories: ===\n";
    $totalCategories = $db->fetchOne("SELECT COUNT(*) as total FROM categories WHERE parent_id IS NULL");
    echo "Total: " . $totalCategories['total'] . " parent categories\n";

} catch (Exception $e) {
    echo "Error: " . $e->getMessage();
}
