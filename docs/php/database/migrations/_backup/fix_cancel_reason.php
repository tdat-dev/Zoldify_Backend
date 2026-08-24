<?php
/**
 * Quick fix: Add cancel_reason column to orders table
 */

$config = require __DIR__ . '/../../config/database.php';

try {
    $pdo = new PDO(
        "mysql:host=" . $config['host'] . ";dbname=" . $config['db_name'] . ";charset=utf8mb4",
        $config['username'],
        $config['password'],
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
    );

    $stmt = $pdo->query("SHOW COLUMNS FROM orders LIKE 'cancel_reason'");
    if ($stmt->rowCount() === 0) {
        $pdo->exec("ALTER TABLE orders ADD COLUMN cancel_reason VARCHAR(255) NULL");
        echo "✅ Added cancel_reason column\n";
    } else {
        echo "⏭️ Column cancel_reason already exists\n";
    }
} catch (PDOException $e) {
    echo "❌ Error: " . $e->getMessage() . "\n";
}
