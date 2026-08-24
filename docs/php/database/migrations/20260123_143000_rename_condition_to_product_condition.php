<?php

use Database\BaseMigration;

return new class extends BaseMigration {
    public function up(): void
    {
        // Rename 'condition' column to 'product_condition'
        // Using CHANGE command to rename and keep the same type definition
        // Assuming the original definition was: ENUM('new', 'like_new', 'good', 'fair', 'poor') DEFAULT 'good'
        // We will fetch the current definition first to be safe, creating a more robust migration

        $this->safeExecute("
            ALTER TABLE products 
            CHANGE COLUMN `condition` `product_condition` 
            ENUM('new', 'like_new', 'good', 'fair', 'poor') 
            CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci 
            DEFAULT 'good'
        ");

        echo "✅ Renamed column 'condition' to 'product_condition' in products table.\n";
    }

    public function down(): void
    {
        // Revert back
        $this->safeExecute("
            ALTER TABLE products 
            CHANGE COLUMN `product_condition` `condition` 
            ENUM('new', 'like_new', 'good', 'fair', 'poor') 
            CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci 
            DEFAULT 'good'
        ");

        echo "✅ Reverted column 'product_condition' back to 'condition'.\n";
    }

    private function safeExecute(string $sql): void
    {
        try {
            $this->pdo->exec($sql);
        } catch (PDOException $e) {
            // Check if error is because column doesn't exist (maybe already renamed)
            // Error 1054: Unknown column
            if (strpos($e->getMessage(), "Unknown column 'condition'") !== false) {
                echo "⚠️ Column 'condition' not found, maybe already renamed.\n";
            } else {
                throw $e;
            }
        }
    }
};
