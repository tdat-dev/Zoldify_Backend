<?php

/**
 * Migration: Update renamed category images
 * 
 * @author  Zoldify Team
 * @date    2025-12-01
 * @version 2.0.0 (refactored)
 */

require_once __DIR__ . '/../BaseMigration.php';

use Database\BaseMigration;

return new class extends BaseMigration {

    public function up(): void
    {
        // Update images that were renamed
        $updates = [
            '/images/categories/cat_sports.png' => '/images/categories/cat_sport.png',
        ];

        $stmt = $this->pdo->prepare("UPDATE categories SET image = ? WHERE image = ?");

        $updated = 0;
        foreach ($updates as $old => $new) {
            $stmt->execute([$new, $old]);
            $updated += $stmt->rowCount();
        }

        if ($updated > 0) {
            $this->success("Renamed {$updated} category image paths");
        } else {
            $this->skip("No image paths to rename");
        }
    }

    public function down(): void
    {
        $updates = [
            '/images/categories/cat_sport.png' => '/images/categories/cat_sports.png',
        ];

        $stmt = $this->pdo->prepare("UPDATE categories SET image = ? WHERE image = ?");

        foreach ($updates as $old => $new) {
            $stmt->execute([$new, $old]);
        }

        $this->success("Reverted image path renames");
    }
};
