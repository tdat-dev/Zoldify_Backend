<?php

/**
 * MIGRATION RUNNER v2.0
 * 
 * Hỗ trợ 4 commands:
 *   php migrate.php           - Chạy tất cả migrations chưa thực thi
 *   php migrate.php status    - Hiển thị trạng thái migrations
 *   php migrate.php rollback  - Rollback migration cuối cùng
 *   php migrate.php fresh     - Xóa tất cả và chạy lại từ đầu
 * 
 * Hỗ trợ 3 formats migration:
 *   1. Anonymous class extends BaseMigration (recommended)
 *   2. Function run_[filename]($pdo) (legacy)
 *   3. File SQL thuần (legacy)
 * 
 * @author  Zoldify Team
 * @version 2.0.0
 * @date    2026-01-13
 */

// =============================================================================
// BOOTSTRAP
// =============================================================================

require_once __DIR__ . '/../app/Core/Database.php';
require_once __DIR__ . '/BaseMigration.php';

use App\Core\Database;
use Database\BaseMigration;

// Lấy PDO connection
$db = Database::getInstance();
$pdo = $db->getConnection();

// Parse CLI command
$command = $argv[1] ?? 'migrate';

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Tạo bảng migrations nếu chưa có
 * Hoặc thêm column batch nếu bảng cũ thiếu
 */
function ensureMigrationsTable(PDO $pdo): void
{
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS migrations (
            id INT AUTO_INCREMENT PRIMARY KEY,
            filename VARCHAR(255) NOT NULL UNIQUE,
            batch INT NOT NULL DEFAULT 1,
            executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ");

    // Backward compatibility: thêm column batch nếu bảng cũ không có
    try {
        $stmt = $pdo->query("SHOW COLUMNS FROM migrations LIKE 'batch'");
        if ($stmt->rowCount() === 0) {
            $pdo->exec("ALTER TABLE migrations ADD COLUMN batch INT NOT NULL DEFAULT 1 AFTER filename");
            echo "📦 Added 'batch' column to migrations table.\n\n";
        }
    } catch (PDOException $e) {
        // Ignore - table might not exist yet
    }
}

/**
 * Lấy batch number tiếp theo
 */
function getNextBatch(PDO $pdo): int
{
    $result = $pdo->query("SELECT MAX(batch) as max_batch FROM migrations")->fetch(PDO::FETCH_ASSOC);
    return ($result['max_batch'] ?? 0) + 1;
}

/**
 * Lấy danh sách file đã migrate
 */
function getExecutedFiles(PDO $pdo): array
{
    $stmt = $pdo->query("SELECT filename FROM migrations ORDER BY id");
    return array_column($stmt->fetchAll(PDO::FETCH_ASSOC), 'filename');
}

/**
 * Lấy tất cả file migration
 */
function getMigrationFiles(): array
{
    $path = __DIR__ . '/migrations/';
    $sqlFiles = glob($path . '*.sql') ?: [];
    $phpFiles = glob($path . '*.php') ?: [];
    $files = array_merge($sqlFiles, $phpFiles);
    sort($files); // Sort theo tên file (timestamp prefix)
    return $files;
}

/**
 * Chạy một migration file
 * 
 * @param string $file Đường dẫn file
 * @param PDO $pdo Connection
 * @param string $direction 'up' hoặc 'down'
 * @return bool Success
 */
function runMigration(string $file, PDO $pdo, string $direction = 'up'): bool
{
    $filename = basename($file);
    $extension = pathinfo($file, PATHINFO_EXTENSION);

    try {
        if ($extension === 'sql') {
            // SQL file - chỉ hỗ trợ 'up'
            if ($direction === 'down') {
                echo "⚠️ SQL migrations không hỗ trợ rollback: {$filename}\n";
                return false;
            }

            $sql = file_get_contents($file);
            $pdo->exec($sql);
            return true;
        }

        if ($extension === 'php') {
            // Clear any previously defined run functions to avoid conflicts
            // PHP file - có thể là anonymous class hoặc function
            $result = require $file;

            // Case 1: Anonymous class extends BaseMigration
            if (is_object($result) && method_exists($result, 'up') && method_exists($result, 'down')) {
                // Inject PDO nếu class có constructor nhận PDO
                $reflection = new ReflectionClass($result);
                $constructor = $reflection->getConstructor();

                if ($constructor && $constructor->getNumberOfParameters() > 0) {
                    // Class needs PDO in constructor - recreate with PDO
                    $migration = $reflection->newInstance($pdo);
                } else {
                    // Class doesn't need PDO in constructor, try to set via property
                    $migration = $result;
                    if (property_exists($migration, 'pdo')) {
                        $migration->pdo = $pdo;
                    }
                }

                if ($direction === 'up') {
                    $migration->up();
                } else {
                    $migration->down();
                }
                return true;
            }

            // Case 2: Legacy function pattern (run_filename)
            $functionName = 'run_' . pathinfo($filename, PATHINFO_FILENAME);
            if (function_exists($functionName)) {
                if ($direction === 'down') {
                    echo "⚠️ Function-based migrations không hỗ trợ rollback: {$filename}\n";
                    return false;
                }
                $functionName($pdo);
                return true;
            }

            // Case 3: Generic run() function
            if (function_exists('run')) {
                if ($direction === 'down') {
                    echo "⚠️ Function-based migrations không hỗ trợ rollback: {$filename}\n";
                    return false;
                }
                run($pdo);
                return true;
            }

            // Case 4: Self-executing script (already ran when require'd)
            return true;
        }

        return false;
    } catch (Exception $e) {
        echo "❌ Error in {$filename}: " . $e->getMessage() . "\n";
        return false;
    }
}

/**
 * Ghi nhận migration đã chạy
 */
function recordMigration(PDO $pdo, string $filename, int $batch): void
{
    $stmt = $pdo->prepare("INSERT INTO migrations (filename, batch) VALUES (?, ?)");
    $stmt->execute([$filename, $batch]);
}

/**
 * Xóa record migration
 */
function removeMigration(PDO $pdo, string $filename): void
{
    $stmt = $pdo->prepare("DELETE FROM migrations WHERE filename = ?");
    $stmt->execute([$filename]);
}

// =============================================================================
// COMMANDS
// =============================================================================

/**
 * Command: migrate
 * Chạy tất cả migrations chưa thực thi
 */
function cmdMigrate(PDO $pdo): void
{
    echo "\n🚀 Running migrations...\n\n";

    ensureMigrationsTable($pdo);

    $executedFiles = getExecutedFiles($pdo);
    $allFiles = getMigrationFiles();
    $batch = getNextBatch($pdo);

    $count = 0;
    foreach ($allFiles as $file) {
        $filename = basename($file);

        if (in_array($filename, $executedFiles)) {
            continue;
        }

        echo "⏳ Migrating: {$filename}\n";

        if (runMigration($file, $pdo, 'up')) {
            recordMigration($pdo, $filename, $batch);
            echo "✅ Migrated: {$filename}\n\n";
            $count++;
        } else {
            echo "❌ Failed: {$filename}\n";
            exit(1);
        }
    }

    if ($count === 0) {
        echo "✅ Nothing to migrate. Database is up to date.\n";
    } else {
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n";
        echo "✅ Done! {$count} migration(s) executed in batch #{$batch}.\n";
    }
}

/**
 * Command: status
 * Hiển thị trạng thái migrations
 */
function cmdStatus(PDO $pdo): void
{
    echo "\n📊 Migration Status\n";
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n";

    ensureMigrationsTable($pdo);

    $executedFiles = getExecutedFiles($pdo);
    $allFiles = getMigrationFiles();

    $pending = 0;
    $ran = 0;

    foreach ($allFiles as $file) {
        $filename = basename($file);
        $isExecuted = in_array($filename, $executedFiles);

        if ($isExecuted) {
            echo "✅ {$filename}\n";
            $ran++;
        } else {
            echo "⏳ {$filename} (pending)\n";
            $pending++;
        }
    }

    echo "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n";
    echo "Total: {$ran} ran, {$pending} pending\n";
}

/**
 * Command: rollback
 * Rollback batch cuối cùng
 */
function cmdRollback(PDO $pdo): void
{
    echo "\n⏪ Rolling back last batch...\n\n";

    ensureMigrationsTable($pdo);

    // Lấy batch cuối cùng
    $result = $pdo->query("SELECT MAX(batch) as max_batch FROM migrations")->fetch(PDO::FETCH_ASSOC);
    $lastBatch = $result['max_batch'] ?? 0;

    if ($lastBatch === 0) {
        echo "⚠️ Nothing to rollback.\n";
        return;
    }

    // Lấy các migrations trong batch đó (theo thứ tự ngược)
    $stmt = $pdo->prepare("SELECT filename FROM migrations WHERE batch = ? ORDER BY id DESC");
    $stmt->execute([$lastBatch]);
    $migrations = $stmt->fetchAll(PDO::FETCH_COLUMN);

    if (empty($migrations)) {
        echo "⚠️ Nothing to rollback.\n";
        return;
    }

    $count = 0;
    foreach ($migrations as $filename) {
        $file = __DIR__ . '/migrations/' . $filename;

        if (!file_exists($file)) {
            echo "⚠️ Migration file not found: {$filename}\n";
            continue;
        }

        echo "⏳ Rolling back: {$filename}\n";

        if (runMigration($file, $pdo, 'down')) {
            removeMigration($pdo, $filename);
            echo "✅ Rolled back: {$filename}\n\n";
            $count++;
        } else {
            echo "⚠️ Could not rollback: {$filename} (no down() method)\n\n";
            // Vẫn xóa record để tránh inconsistent state
            removeMigration($pdo, $filename);
        }
    }

    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n";
    echo "✅ Rolled back batch #{$lastBatch}: {$count} migration(s)\n";
}

/**
 * Command: fresh
 * Drop tất cả tables và chạy lại từ đầu
 */
function cmdFresh(PDO $pdo): void
{
    echo "\n🔄 Fresh migration (drop all tables and re-migrate)...\n\n";

    // Disable foreign key checks
    $pdo->exec("SET FOREIGN_KEY_CHECKS = 0");

    // Lấy tất cả tables
    $tables = $pdo->query("SHOW TABLES")->fetchAll(PDO::FETCH_COLUMN);

    foreach ($tables as $table) {
        echo "🗑️ Dropping table: {$table}\n";
        $pdo->exec("DROP TABLE IF EXISTS `{$table}`");
    }

    // Re-enable foreign key checks
    $pdo->exec("SET FOREIGN_KEY_CHECKS = 1");

    echo "\n✅ All tables dropped.\n\n";

    // Chạy migrate
    cmdMigrate($pdo);
}

/**
 * Command: help
 */
function cmdHelp(): void
{
    echo <<<HELP

📚 Migration Runner v2.0

Usage: php migrate.php [command]

Commands:
  migrate    Run all pending migrations (default)
  status     Show migration status
  rollback   Rollback last batch of migrations
  fresh      Drop all tables and re-run all migrations
  help       Show this help message

Examples:
  php database/migrate.php
  php database/migrate.php status
  php database/migrate.php rollback
  php database/migrate.php fresh


HELP;
}

// =============================================================================
// MAIN
// =============================================================================

switch ($command) {
    case 'migrate':
    case '':
        cmdMigrate($pdo);
        break;

    case 'status':
        cmdStatus($pdo);
        break;

    case 'rollback':
        cmdRollback($pdo);
        break;

    case 'fresh':
        echo "⚠️ WARNING: This will DROP ALL TABLES!\n";
        echo "Are you sure? Type 'yes' to confirm: ";
        $confirm = trim(fgets(STDIN));
        if ($confirm === 'yes') {
            cmdFresh($pdo);
        } else {
            echo "Cancelled.\n";
        }
        break;

    case 'help':
    case '--help':
    case '-h':
        cmdHelp();
        break;

    default:
        echo "❌ Unknown command: {$command}\n";
        cmdHelp();
        exit(1);
}

echo "\n";
