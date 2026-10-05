<?php

/**
 * Migration: Sửa đường dẫn ảnh products từ /images/products/X.png sang uploads/products/product_X.png
 * 
 * @date 2026-01-14
 */

namespace Database;

return new class extends BaseMigration {
    protected string $table = 'products';

    public function up(): void
    {
        // Lấy tất cả products có image bắt đầu bằng /images/products/
        $stmt = $this->pdo->query("SELECT id, image FROM products WHERE image LIKE '/images/products/%'");
        $products = $stmt->fetchAll(\PDO::FETCH_ASSOC);

        $count = 0;
        foreach ($products as $product) {
            // /images/products/1.png -> products/product_1.png
            $oldPath = $product['image'];

            // Extract số từ path: /images/products/1.png -> 1
            if (preg_match('/\/images\/products\/(\d+)\.(\w+)$/', $oldPath, $matches)) {
                $num = $matches[1];
                $ext = $matches[2];
                $newPath = "products/product_{$num}.{$ext}";

                $updateStmt = $this->pdo->prepare("UPDATE products SET image = ? WHERE id = ?");
                $updateStmt->execute([$newPath, $product['id']]);

                $this->info("Updated product #{$product['id']}: {$oldPath} -> {$newPath}");
                $count++;
            }
        }

        if ($count > 0) {
            $this->success("Updated {$count} product image paths");
        } else {
            $this->skip("No products with /images/products/ paths found");
        }
    }

    public function down(): void
    {
        // Rollback: products/product_X.png -> /images/products/X.png
        $stmt = $this->pdo->query("SELECT id, image FROM products WHERE image LIKE 'products/product_%'");
        $products = $stmt->fetchAll(\PDO::FETCH_ASSOC);

        foreach ($products as $product) {
            $oldPath = $product['image'];

            // products/product_1.png -> /images/products/1.png
            if (preg_match('/products\/product_(\d+)\.(\w+)$/', $oldPath, $matches)) {
                $num = $matches[1];
                $ext = $matches[2];
                $newPath = "/images/products/{$num}.{$ext}";

                $updateStmt = $this->pdo->prepare("UPDATE products SET image = ? WHERE id = ?");
                $updateStmt->execute([$newPath, $product['id']]);

                $this->info("Reverted product #{$product['id']}: {$oldPath} -> {$newPath}");
            }
        }
    }
};
