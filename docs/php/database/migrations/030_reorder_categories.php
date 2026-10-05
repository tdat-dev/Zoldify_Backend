<?php
require_once __DIR__ . '/../../app/Core/Database.php';

use App\Core\Database;

try {
    $db = Database::getInstance();

    // Thêm cột sort_order nếu chưa có
    try {
        $db->execute("ALTER TABLE categories ADD COLUMN sort_order INT DEFAULT 0");
        echo "Added sort_order column\n";
    } catch (Exception $e) {
        echo "Column sort_order may already exist\n";
    }

    // Sắp xếp thứ tự danh mục cha theo logic
    $order = [
        'Sách & Giáo trình' => 1,
        'Đồ học tập' => 2,
        'Đồ điện tử' => 3,
        'Điện thoại' => 4,
        'Laptop' => 5,
        'Máy ảnh' => 6,
        'Âm thanh' => 7,
        'Đồng hồ' => 8,
        'Thời trang' => 9,
        'Giày dép' => 10,
        'Túi xách & Ví' => 11,
        'Phụ kiện' => 12,
        'Sắc đẹp' => 13,
        'Sức khỏe' => 14,
        'Thể thao & Du lịch' => 15,
        'Nhà cửa & Đời sống' => 16,
        'Mẹ & Bé' => 17,
        'Xe cộ' => 18,
        'Thú cưng' => 19,
        'Khác' => 20,
    ];

    foreach ($order as $name => $sortOrder) {
        $db->execute(
            "UPDATE categories SET sort_order = :sort_order WHERE name = :name AND parent_id IS NULL",
            ['sort_order' => $sortOrder, 'name' => $name]
        );
        echo "Set order {$sortOrder} for: {$name}\n";
    }

    // Clear Redis cache
    $redis = \App\Core\RedisCache::getInstance();
    if ($redis->isAvailable()) {
        $redis->delete('categories_all_v2');
    }

    echo "\n=== Done! Categories reordered ===\n";

} catch (Exception $e) {
    echo "Error: " . $e->getMessage();
}
