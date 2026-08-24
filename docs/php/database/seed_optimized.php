<?php
/**
 * ZOLDIFY - OPTIMIZED Seed Script
 * Sử dụng multi-row INSERT với batch size lớn
 * 
 * Usage: php database/seed_optimized.php
 */

require_once __DIR__ . '/../vendor/autoload.php';

$dotenv = Dotenv\Dotenv::createImmutable(__DIR__ . '/..');
$dotenv->load();

define('DB_HOST', $_ENV['DB_HOST'] ?? '127.0.0.1');
define('DB_NAME', $_ENV['DB_DATABASE'] ?? 'zoldify');
define('DB_USER', $_ENV['DB_USERNAME'] ?? 'root');
define('DB_PASSWORD', $_ENV['DB_PASSWORD'] ?? '');

set_time_limit(0);
ini_set('memory_limit', '4G');

class OptimizedSeeder
{
    private $pdo;
    private $batchSize = 10000; // Tăng batch size
    
    public function __construct()
    {
        $this->pdo = new PDO(
            sprintf('mysql:host=%s;dbname=%s;charset=utf8mb4', DB_HOST, DB_NAME),
            DB_USER,
            DB_PASSWORD,
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
        );
        
        // Tối ưu MySQL
        $this->pdo->exec("SET FOREIGN_KEY_CHECKS = 0");
        $this->pdo->exec("SET UNIQUE_CHECKS = 0");
        $this->pdo->exec("SET autocommit = 0");
        $this->pdo->exec("SET SESSION bulk_insert_buffer_size = 256 * 1024 * 1024");
    }
    
    public function run()
    {
        $start = microtime(true);
        
        echo "==============================================\n";
        echo "ZOLDIFY - OPTIMIZED SEEDING\n";
        echo "==============================================\n\n";
        
        $this->seedCategories(100);
        $this->seedUsers(1000000);
        $this->seedProducts(1000000);
        $this->seedProductImages(1000000);
        $this->seedOrders(1000000);
        $this->seedOrderDetails(1000000);
        $this->seedReviews(1000000);
        $this->seedFavorites(1000000);
        $this->seedMessages(1000000);
        $this->seedNotifications(1000000);
        $this->seedFollows(1000000);
        $this->seedInteractions(1000000);
        $this->seedSearchKeywords(100000);
        $this->seedUserAddresses(1000000);
        $this->seedWallets();
        
        $this->pdo->exec("SET FOREIGN_KEY_CHECKS = 1");
        $this->pdo->exec("SET UNIQUE_CHECKS = 1");
        
        $duration = round(microtime(true) - $start, 2);
        
        echo "\n==============================================\n";
        echo "DONE in {$duration} seconds!\n";
        echo "==============================================\n";
        
        $this->showStats();
    }
    
    private function bulkInsert($table, $columns, $rows)
    {
        if (empty($rows)) return;
        
        $colCount = count($columns);
        $placeholder = '(' . implode(',', array_fill(0, $colCount, '?')) . ')';
        $placeholders = implode(',', array_fill(0, count($rows), $placeholder));
        
        $colList = implode(',', array_map(fn($c) => "`$c`", $columns));
        $sql = "INSERT INTO `{$table}` ({$colList}) VALUES {$placeholders}";
        
        $values = [];
        foreach ($rows as $row) {
            foreach ($row as $val) {
                $values[] = $val;
            }
        }
        
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($values);
    }
    
    private function seedCategories($count)
    {
        echo "Categories... ";
        $this->pdo->exec("TRUNCATE TABLE categories");
        
        $colors = ['333', '666', '999', 'c00', '0c0', '00c', 'cc0', '0cc', 'c0c', 'f60'];
        $rows = [];
        
        for ($i = 1; $i <= $count; $i++) {
            $parentId = ($i <= 20) ? null : rand(1, 20);
            $color = $colors[array_rand($colors)];
            
            $rows[] = [
                $i, $parentId, "Danh mục {$i}", "Mô tả cho danh mục {$i}",
                "tag-{$i}", "https://placehold.co/64x64/{$color}/fff?text={$i}",
                "https://placehold.co/400x300/{$color}/fff?text=Cat{$i}", $i
            ];
        }
        
        $this->bulkInsert('categories', 
            ['id', 'parent_id', 'name', 'description', 'tag', 'icon', 'image', 'sort_order'], 
            $rows
        );
        $this->pdo->exec("COMMIT");
        
        echo "Done! ({$count})\n";
    }
    
    private function seedUsers($count)
    {
        echo "Users ({$count})... ";
        $this->pdo->exec("TRUNCATE TABLE users");
        
        $roles = ['buyer', 'buyer', 'buyer', 'buyer', 'buyer', 'buyer', 'seller', 'seller', 'seller', 'moderator'];
        $genders = ['male', 'female', 'other'];
        $passwordHash = password_hash('password123', PASSWORD_DEFAULT);
        
        $rows = [];
        for ($i = 1; $i <= $count; $i++) {
            $rows[] = [
                $i,
                "User {$i} " . substr(md5((string)$i), 0, 4),
                "user{$i}@zoldify.test",
                $passwordHash,
                '09' . str_pad((string)($i % 100000000), 8, '0', STR_PAD_LEFT),
                rand(0, 1),
                $genders[array_rand($genders)],
                "Số " . rand(1, 999) . ", Đường " . rand(1, 100) . ", Q." . rand(1, 12),
                $roles[array_rand($roles)],
                rand(0, 50000000),
                "https://i.pravatar.cc/150?u={$i}",
                rand(0, 1),
                0,
                date('Y-m-d H:i:s', strtotime("-" . rand(0, 365) . " days"))
            ];
            
            if (count($rows) >= $this->batchSize) {
                $this->bulkInsert('users', 
                    ['id', 'full_name', 'email', 'password', 'phone_number', 'phone_verified',
                     'gender', 'address', 'role', 'balance', 'avatar', 'email_verified', 'is_locked', 'last_seen'],
                    $rows
                );
                $this->pdo->exec("COMMIT");
                $rows = [];
                echo ".";
            }
        }
        
        if (!empty($rows)) {
            $this->bulkInsert('users', 
                ['id', 'full_name', 'email', 'password', 'phone_number', 'phone_verified',
                 'gender', 'address', 'role', 'balance', 'avatar', 'email_verified', 'is_locked', 'last_seen'],
                $rows
            );
            $this->pdo->exec("COMMIT");
        }
        
        echo " Done!\n";
    }
    
    private function seedProducts($count)
    {
        echo "Products ({$count})... ";
        $this->pdo->exec("TRUNCATE TABLE products");
        
        $names = ['iPhone', 'Samsung', 'Laptop', 'Áo thun', 'Quần jean', 'Giày Nike', 'Túi xách', 'Đồng hồ', 'Tai nghe', 'Máy ảnh'];
        $suffixes = ['Pro', 'Max', 'Plus', 'Mini', 'Ultra', 'Lite', 'SE', 'X', 'S', ''];
        $statuses = ['active', 'active', 'active', 'active', 'sold', 'hidden'];
        $conditions = ['new', 'like_new', 'good', 'fair'];
        
        $rows = [];
        for ($i = 1; $i <= $count; $i++) {
            $name = $names[array_rand($names)] . ' ' . $suffixes[array_rand($suffixes)] . " #{$i}";
            
            $rows[] = [
                $i,
                rand(1, 1000000),
                rand(1, 100),
                $name,
                "Sản phẩm #{$i}. Hàng chất lượng, giá tốt.",
                rand(50000, 50000000),
                rand(1, 100),
                rand(0, 10000),
                "https://picsum.photos/seed/p{$i}/800/800",
                $statuses[array_rand($statuses)],
                date('Y-m-d H:i:s', strtotime("-" . rand(0, 730) . " days")),
                $conditions[array_rand($conditions)]
            ];
            
            if (count($rows) >= $this->batchSize) {
                $this->bulkInsert('products', 
                    ['id', 'user_id', 'category_id', 'name', 'description', 'price', 'quantity',
                     'view_count', 'image', 'status', 'created_at', 'product_condition'],
                    $rows
                );
                $this->pdo->exec("COMMIT");
                $rows = [];
                echo ".";
            }
        }
        
        if (!empty($rows)) {
            $this->bulkInsert('products', 
                ['id', 'user_id', 'category_id', 'name', 'description', 'price', 'quantity',
                 'view_count', 'image', 'status', 'created_at', 'product_condition'],
                $rows
            );
            $this->pdo->exec("COMMIT");
        }
        
        echo " Done!\n";
    }
    
    private function seedProductImages($productCount)
    {
        echo "Product Images (3x)... ";
        $this->pdo->exec("TRUNCATE TABLE product_images");
        
        $rows = [];
        for ($i = 1; $i <= $productCount; $i++) {
            for ($j = 1; $j <= 3; $j++) {
                $rows[] = [
                    $i,
                    "https://picsum.photos/seed/p{$i}i{$j}/800/800",
                    $j === 1 ? 1 : 0,
                    $j
                ];
            }
            
            if (count($rows) >= $this->batchSize) {
                $this->bulkInsert('product_images', 
                    ['product_id', 'image_path', 'is_primary', 'sort_order'],
                    $rows
                );
                $this->pdo->exec("COMMIT");
                $rows = [];
                echo ".";
            }
        }
        
        if (!empty($rows)) {
            $this->bulkInsert('product_images', 
                ['product_id', 'image_path', 'is_primary', 'sort_order'],
                $rows
            );
            $this->pdo->exec("COMMIT");
        }
        
        echo " Done!\n";
    }
    
    private function seedOrders($count)
    {
        echo "Orders ({$count})... ";
        $this->pdo->exec("TRUNCATE TABLE orders");
        
        $statuses = ['pending', 'paid', 'confirmed', 'shipping', 'received', 'completed', 'completed', 'completed', 'cancelled'];
        $paymentMethods = ['cod', 'bank_transfer', 'payos'];
        $paymentStatuses = ['pending', 'paid', 'paid', 'paid', 'failed'];
        
        $rows = [];
        for ($i = 1; $i <= $count; $i++) {
            $buyerId = rand(1, 1000000);
            $sellerId = rand(1, 1000000);
            if ($sellerId === $buyerId) $sellerId = ($sellerId % 1000000) + 1;
            
            $total = rand(100000, 10000000);
            $platformFee = round($total * 0.05, 2);
            
            $rows[] = [
                $i, $buyerId, $sellerId, $total, $platformFee, $total - $platformFee,
                rand(15000, 65000),
                "Số " . rand(1, 999) . ", Đường " . rand(1, 100) . ", Q." . rand(1, 12),
                '09' . str_pad((string)($i % 100000000), 8, '0', STR_PAD_LEFT),
                "Nguyen Van " . chr(65 + ($i % 26)),
                $statuses[array_rand($statuses)],
                $paymentMethods[array_rand($paymentMethods)],
                $paymentStatuses[array_rand($paymentStatuses)],
                date('Y-m-d H:i:s', strtotime("-" . rand(0, 365) . " days"))
            ];
            
            if (count($rows) >= $this->batchSize) {
                $this->bulkInsert('orders', 
                    ['id', 'buyer_id', 'seller_id', 'total_amount', 'platform_fee', 'seller_amount',
                     'shipping_fee', 'shipping_address', 'shipping_phone', 'shipping_name',
                     'status', 'payment_method', 'payment_status', 'created_at'],
                    $rows
                );
                $this->pdo->exec("COMMIT");
                $rows = [];
                echo ".";
            }
        }
        
        if (!empty($rows)) {
            $this->bulkInsert('orders', 
                ['id', 'buyer_id', 'seller_id', 'total_amount', 'platform_fee', 'seller_amount',
                 'shipping_fee', 'shipping_address', 'shipping_phone', 'shipping_name',
                 'status', 'payment_method', 'payment_status', 'created_at'],
                $rows
            );
            $this->pdo->exec("COMMIT");
        }
        
        echo " Done!\n";
    }
    
    private function seedOrderDetails($orderCount)
    {
        echo "Order Details (2x avg)... ";
        $this->pdo->exec("TRUNCATE TABLE order_details");
        
        $rows = [];
        for ($i = 1; $i <= $orderCount; $i++) {
            $items = rand(1, 4);
            for ($j = 1; $j <= $items; $j++) {
                $rows[] = [
                    $i,
                    rand(1, 1000000),
                    rand(1, 5),
                    rand(50000, 5000000)
                ];
            }
            
            if (count($rows) >= $this->batchSize) {
                $this->bulkInsert('order_details', 
                    ['order_id', 'product_id', 'quantity', 'price_at_purchase'],
                    $rows
                );
                $this->pdo->exec("COMMIT");
                $rows = [];
                echo ".";
            }
        }
        
        if (!empty($rows)) {
            $this->bulkInsert('order_details', 
                ['order_id', 'product_id', 'quantity', 'price_at_purchase'],
                $rows
            );
            $this->pdo->exec("COMMIT");
        }
        
        echo " Done!\n";
    }
    
    private function seedReviews($count)
    {
        echo "Reviews ({$count})... ";
        $this->pdo->exec("TRUNCATE TABLE reviews");
        
        $comments = ['Rất tốt!', 'Giao nhanh!', 'OK.', 'Thân thiện!', '5 sao!', 'Tạm được.'];
        
        $rows = [];
        for ($i = 1; $i <= $count; $i++) {
            $rows[] = [
                $i,
                rand(1, 1000000),
                rand(1, 1000000),
                rand(1, 5),
                $comments[array_rand($comments)],
                date('Y-m-d H:i:s', strtotime("-" . rand(0, 365) . " days"))
            ];
            
            if (count($rows) >= $this->batchSize) {
                $this->bulkInsert('reviews', 
                    ['id', 'reviewer_id', 'product_id', 'rating', 'comment', 'created_at'],
                    $rows
                );
                $this->pdo->exec("COMMIT");
                $rows = [];
                echo ".";
            }
        }
        
        if (!empty($rows)) {
            $this->bulkInsert('reviews', 
                ['id', 'reviewer_id', 'product_id', 'rating', 'comment', 'created_at'],
                $rows
            );
            $this->pdo->exec("COMMIT");
        }
        
        echo " Done!\n";
    }
    
    private function seedFavorites($count)
    {
        echo "Favorites ({$count})... ";
        $this->pdo->exec("TRUNCATE TABLE favorites");
        
        $rows = [];
        for ($i = 1; $i <= $count; $i++) {
            $rows[] = [
                $i,
                rand(1, 1000000),
                rand(1, 1000000),
                date('Y-m-d H:i:s', strtotime("-" . rand(0, 365) . " days"))
            ];
            
            if (count($rows) >= $this->batchSize) {
                $this->bulkInsert('favorites', 
                    ['id', 'user_id', 'product_id', 'created_at'],
                    $rows
                );
                $this->pdo->exec("COMMIT");
                $rows = [];
                echo ".";
            }
        }
        
        if (!empty($rows)) {
            $this->bulkInsert('favorites', 
                ['id', 'user_id', 'product_id', 'created_at'],
                $rows
            );
            $this->pdo->exec("COMMIT");
        }
        
        echo " Done!\n";
    }
    
    private function seedMessages($count)
    {
        echo "Messages ({$count})... ";
        $this->pdo->exec("TRUNCATE TABLE messages");
        
        $contents = ['Còn hàng không?', 'Giảm giá được không?', 'OK mình đặt nhé!', 'Cảm ơn!'];
        
        $rows = [];
        for ($i = 1; $i <= $count; $i++) {
            $sender = rand(1, 1000000);
            $receiver = rand(1, 1000000);
            if ($receiver === $sender) $receiver = ($receiver % 1000000) + 1;
            
            $rows[] = [
                $i, $sender, $receiver,
                $contents[array_rand($contents)],
                rand(0, 1), 0,
                date('Y-m-d H:i:s', strtotime("-" . rand(0, 180) . " days"))
            ];
            
            if (count($rows) >= $this->batchSize) {
                $this->bulkInsert('messages', 
                    ['id', 'sender_id', 'receiver_id', 'content', 'is_read', 'has_attachment', 'created_at'],
                    $rows
                );
                $this->pdo->exec("COMMIT");
                $rows = [];
                echo ".";
            }
        }
        
        if (!empty($rows)) {
            $this->bulkInsert('messages', 
                ['id', 'sender_id', 'receiver_id', 'content', 'is_read', 'has_attachment', 'created_at'],
                $rows
            );
            $this->pdo->exec("COMMIT");
        }
        
        echo " Done!\n";
    }
    
    private function seedNotifications($count)
    {
        echo "Notifications ({$count})... ";
        $this->pdo->exec("TRUNCATE TABLE notifications");
        
        $contents = ['Đơn hàng mới!', 'Đã xác nhận!', 'Có người quan tâm!', 'Tin nhắn mới!'];
        
        $rows = [];
        for ($i = 1; $i <= $count; $i++) {
            $rows[] = [
                $i,
                rand(1, 1000000),
                $contents[array_rand($contents)],
                rand(0, 1),
                date('Y-m-d H:i:s', strtotime("-" . rand(0, 90) . " days"))
            ];
            
            if (count($rows) >= $this->batchSize) {
                $this->bulkInsert('notifications', 
                    ['id', 'user_id', 'content', 'is_read', 'created_at'],
                    $rows
                );
                $this->pdo->exec("COMMIT");
                $rows = [];
                echo ".";
            }
        }
        
        if (!empty($rows)) {
            $this->bulkInsert('notifications', 
                ['id', 'user_id', 'content', 'is_read', 'created_at'],
                $rows
            );
            $this->pdo->exec("COMMIT");
        }
        
        echo " Done!\n";
    }
    
    private function seedFollows($count)
    {
        echo "Follows ({$count})... ";
        $this->pdo->exec("TRUNCATE TABLE follows");
        
        $rows = [];
        for ($i = 1; $i <= $count; $i++) {
            $follower = rand(1, 1000000);
            $following = rand(1, 1000000);
            if ($following === $follower) $following = ($following % 1000000) + 1;
            
            $rows[] = [
                $i, $follower, $following,
                date('Y-m-d H:i:s', strtotime("-" . rand(0, 365) . " days"))
            ];
            
            if (count($rows) >= $this->batchSize) {
                $this->bulkInsert('follows', 
                    ['id', 'follower_id', 'following_id', 'created_at'],
                    $rows
                );
                $this->pdo->exec("COMMIT");
                $rows = [];
                echo ".";
            }
        }
        
        if (!empty($rows)) {
            $this->bulkInsert('follows', 
                ['id', 'follower_id', 'following_id', 'created_at'],
                $rows
            );
            $this->pdo->exec("COMMIT");
        }
        
        echo " Done!\n";
    }
    
    private function seedInteractions($count)
    {
        echo "Interactions ({$count})... ";
        $this->pdo->exec("TRUNCATE TABLE interactions");
        
        $types = ['view', 'view', 'view', 'click'];
        
        $rows = [];
        for ($i = 1; $i <= $count; $i++) {
            $rows[] = [
                $i,
                rand(1, 1000000),
                rand(1, 1000000),
                $types[array_rand($types)],
                rand(1, 5),
                date('Y-m-d H:i:s', strtotime("-" . rand(0, 90) . " days"))
            ];
            
            if (count($rows) >= $this->batchSize) {
                $this->bulkInsert('interactions', 
                    ['id', 'user_id', 'product_id', 'interaction_type', 'score', 'created_at'],
                    $rows
                );
                $this->pdo->exec("COMMIT");
                $rows = [];
                echo ".";
            }
        }
        
        if (!empty($rows)) {
            $this->bulkInsert('interactions', 
                ['id', 'user_id', 'product_id', 'interaction_type', 'score', 'created_at'],
                $rows
            );
            $this->pdo->exec("COMMIT");
        }
        
        echo " Done!\n";
    }
    
    private function seedSearchKeywords($count)
    {
        echo "Search Keywords ({$count})... ";
        $this->pdo->exec("TRUNCATE TABLE search_keywords");
        
        $keywords = ['iphone', 'samsung', 'laptop', 'áo', 'quần', 'giày', 'túi', 'đồng hồ'];
        
        $rows = [];
        for ($i = 1; $i <= $count; $i++) {
            $rows[] = [
                $i,
                $keywords[array_rand($keywords)] . " {$i}",
                rand(1, 10000)
            ];
            
            if (count($rows) >= $this->batchSize) {
                $this->bulkInsert('search_keywords', 
                    ['id', 'keyword', 'search_count'],
                    $rows
                );
                $this->pdo->exec("COMMIT");
                $rows = [];
                echo ".";
            }
        }
        
        if (!empty($rows)) {
            $this->bulkInsert('search_keywords', 
                ['id', 'keyword', 'search_count'],
                $rows
            );
            $this->pdo->exec("COMMIT");
        }
        
        echo " Done!\n";
    }
    
    private function seedUserAddresses($userCount)
    {
        echo "User Addresses (1-3 per user)... ";
        $this->pdo->exec("TRUNCATE TABLE user_addresses");
        
        $provinces = ['TP.HCM', 'Hà Nội', 'Đà Nẵng', 'Cần Thơ', 'Hải Phòng'];
        $districts = ['Quận 1', 'Quận 3', 'Quận 7', 'Bình Thạnh', 'Gò Vấp'];
        $labels = ['Nhà riêng', 'Công ty', 'Nhà bạn'];
        
        $rows = [];
        for ($userId = 1; $userId <= $userCount; $userId++) {
            $addrCount = rand(1, 3);
            for ($j = 1; $j <= $addrCount; $j++) {
                $province = $provinces[array_rand($provinces)];
                $district = $districts[array_rand($districts)];
                $street = "Số " . rand(1, 999) . ", Đường " . rand(1, 50);
                
                $rows[] = [
                    $userId,
                    $labels[$j - 1],
                    "Người nhận {$userId}",
                    '09' . str_pad((string)($userId % 100000000), 8, '0', STR_PAD_LEFT),
                    $province,
                    $district,
                    "Phường " . rand(1, 20),
                    $street,
                    "{$street}, {$district}, {$province}",
                    $j === 1 ? 1 : 0
                ];
            }
            
            if (count($rows) >= $this->batchSize) {
                $this->bulkInsert('user_addresses', 
                    ['user_id', 'label', 'recipient_name', 'phone_number', 'province',
                     'district', 'ward', 'street_address', 'full_address', 'is_default'],
                    $rows
                );
                $this->pdo->exec("COMMIT");
                $rows = [];
                echo ".";
            }
        }
        
        if (!empty($rows)) {
            $this->bulkInsert('user_addresses', 
                ['user_id', 'label', 'recipient_name', 'phone_number', 'province',
                 'district', 'ward', 'street_address', 'full_address', 'is_default'],
                $rows
            );
            $this->pdo->exec("COMMIT");
        }
        
        echo " Done!\n";
    }
    
    private function seedWallets()
    {
        echo "Wallets (for sellers)... ";
        $this->pdo->exec("TRUNCATE TABLE wallets");
        
        $banks = ['Vietcombank', 'Techcombank', 'MB Bank', 'VPBank', 'ACB', 'BIDV'];
        
        $stmt = $this->pdo->query("SELECT id, full_name FROM users WHERE role IN ('seller', 'admin') LIMIT 400000");
        
        $rows = [];
        while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
            $rows[] = [
                $row['id'],
                rand(0, 50000000),
                rand(0, 10000000),
                rand(0, 100000000),
                rand(0, 20000000),
                $banks[array_rand($banks)],
                str_pad((string)rand(0, 9999999999), 14, '0', STR_PAD_LEFT),
                $row['full_name']
            ];
            
            if (count($rows) >= $this->batchSize) {
                $this->bulkInsert('wallets', 
                    ['user_id', 'balance', 'pending_balance', 'total_earned',
                     'total_withdrawn', 'bank_name', 'bank_account_number', 'bank_account_name'],
                    $rows
                );
                $this->pdo->exec("COMMIT");
                $rows = [];
            }
        }
        
        if (!empty($rows)) {
            $this->bulkInsert('wallets', 
                ['user_id', 'balance', 'pending_balance', 'total_earned',
                 'total_withdrawn', 'bank_name', 'bank_account_number', 'bank_account_name'],
                $rows
            );
            $this->pdo->exec("COMMIT");
        }
        
        echo "Done!\n";
    }
    
    private function showStats()
    {
        echo "\n=== STATISTICS ===\n";
        
        $tables = ['users', 'categories', 'products', 'product_images', 'orders',
                   'order_details', 'reviews', 'favorites', 'messages', 'notifications',
                   'follows', 'interactions', 'search_keywords', 'user_addresses', 'wallets'];
        
        $total = 0;
        foreach ($tables as $table) {
            $count = $this->pdo->query("SELECT COUNT(*) FROM {$table}")->fetchColumn();
            $total += $count;
            echo sprintf("%-20s %s\n", $table . ':', number_format($count));
        }
        echo "----------------------------\n";
        echo sprintf("%-20s %s\n", 'TOTAL:', number_format($total));
    }
}

$seeder = new OptimizedSeeder();
$seeder->run();
