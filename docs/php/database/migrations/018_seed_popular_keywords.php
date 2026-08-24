<?php

/**
 * Migration: Seed popular keywords
 * 
 * @author  Zoldify Team
 * @date    2025-12-31
 * @version 2.0.0 (refactored)
 */

require_once __DIR__ . '/../BaseMigration.php';

use Database\BaseMigration;

return new class extends BaseMigration {

    public function up(): void
    {
        $keywords = [
            ['sục crocs', 150],
            ['áo khoác', 120],
            ['giáo trình c++', 95],
            ['bàn phím cơ', 80],
            ['tai nghe', 65],
            ['sách tiếng anh', 55],
        ];

        $stmt = $this->pdo->prepare("
            INSERT INTO search_keywords (keyword, search_count) 
            VALUES (?, ?)
            ON DUPLICATE KEY UPDATE search_count = search_count
        ");

        $inserted = 0;
        foreach ($keywords as [$keyword, $count]) {
            try {
                $stmt->execute([$keyword, $count]);
                if ($stmt->rowCount() > 0)
                    $inserted++;
            } catch (PDOException $e) {
                // Ignore
            }
        }

        if ($inserted > 0) {
            $this->success("Seeded {$inserted} popular keywords");
        } else {
            $this->skip("Keywords already seeded");
        }
    }

    public function down(): void
    {
        $keywords = ['sục crocs', 'áo khoác', 'giáo trình c++', 'bàn phím cơ', 'tai nghe', 'sách tiếng anh'];

        $placeholders = str_repeat('?,', count($keywords) - 1) . '?';
        $stmt = $this->pdo->prepare("DELETE FROM search_keywords WHERE keyword IN ({$placeholders})");
        $stmt->execute($keywords);

        $this->success("Deleted seeded keywords");
    }
};
