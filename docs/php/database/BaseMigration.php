<?php

/**
 * Base Migration Class
 * 
 * Abstract class cung cấp các helper methods cho migrations.
 * Tất cả migrations mới phải extend class này.
 * 
 * @author  Zoldify Team
 * @version 1.0.0
 * @date    2026-01-13
 */

namespace Database;

use PDO;
use PDOException;

abstract class BaseMigration
{
    /**
     * PDO connection instance
     */
    protected PDO $pdo;

    /**
     * Tên bảng chính (override trong subclass)
     */
    protected string $table = '';

    /**
     * Constructor - inject PDO
     */
    public function __construct(?PDO $pdo = null)
    {
        if ($pdo) {
            $this->pdo = $pdo;
        }
    }

    /**
     * Chạy migration (thêm cột, tạo bảng, etc.)
     * PHẢI được override trong subclass
     */
    abstract public function up(): void;

    /**
     * Rollback migration (xóa cột, xóa bảng, etc.)
     * PHẢI được override trong subclass
     */
    abstract public function down(): void;

    // =========================================================================
    // HELPER METHODS - KIỂM TRA TỒN TẠI
    // =========================================================================

    /**
     * Kiểm tra bảng đã tồn tại chưa
     * 
     * @param string $table Tên bảng cần kiểm tra
     * @return bool True nếu bảng tồn tại
     */
    protected function tableExists(string $table): bool
    {
        $table = str_replace("'", "\\'", $table); // Basic escaping
        $stmt = $this->pdo->query("SHOW TABLES LIKE '$table'");
        return $stmt->rowCount() > 0;
    }

    /**
     * Kiểm tra cột đã tồn tại trong bảng chưa
     * 
     * @param string $table  Tên bảng
     * @param string $column Tên cột cần kiểm tra
     * @return bool True nếu cột tồn tại
     */
    protected function columnExists(string $table, string $column): bool
    {
        $table = str_replace("'", "\\'", $table);
        $column = str_replace("'", "\\'", $column);
        $stmt = $this->pdo->query("SHOW COLUMNS FROM `$table` LIKE '$column'");
        return $stmt->rowCount() > 0;
    }

    /**
     * Kiểm tra index đã tồn tại trong bảng chưa
     * 
     * @param string $table Tên bảng
     * @param string $index Tên index cần kiểm tra
     * @return bool True nếu index tồn tại
     */
    protected function indexExists(string $table, string $index): bool
    {
        $table = str_replace("'", "\\'", $table);
        $index = str_replace("'", "\\'", $index);
        $stmt = $this->pdo->query("SHOW INDEX FROM `$table` WHERE Key_name = '$index'");
        return $stmt->rowCount() > 0;
    }

    /**
     * Kiểm tra foreign key đã tồn tại chưa
     * 
     * @param string $table      Tên bảng
     * @param string $constraint Tên constraint
     * @return bool True nếu FK tồn tại
     */
    protected function foreignKeyExists(string $table, string $constraint): bool
    {
        $dbName = $this->getDatabaseName();
        $stmt = $this->pdo->prepare("
            SELECT COUNT(*) as cnt 
            FROM information_schema.TABLE_CONSTRAINTS 
            WHERE CONSTRAINT_SCHEMA = ? 
              AND TABLE_NAME = ? 
              AND CONSTRAINT_NAME = ?
              AND CONSTRAINT_TYPE = 'FOREIGN KEY'
        ");
        $stmt->execute([$dbName, $table, $constraint]);
        return $stmt->fetch(PDO::FETCH_ASSOC)['cnt'] > 0;
    }

    /**
     * Lấy tên database hiện tại
     */
    protected function getDatabaseName(): string
    {
        return $this->pdo->query("SELECT DATABASE()")->fetchColumn();
    }

    // =========================================================================
    // HELPER METHODS - THÊM / XÓA
    // =========================================================================

    /**
     * Thêm cột vào bảng (idempotent - không lỗi nếu đã tồn tại)
     * 
     * @param string $table      Tên bảng
     * @param string $column     Tên cột
     * @param string $definition Định nghĩa cột (VD: "VARCHAR(100) NOT NULL DEFAULT ''")
     * @param string|null $after Thêm sau cột nào (optional)
     * @return bool True nếu thêm thành công, false nếu đã tồn tại
     */
    protected function addColumn(string $table, string $column, string $definition, ?string $after = null): bool
    {
        if ($this->columnExists($table, $column)) {
            $this->info("Column '{$column}' already exists in '{$table}'");
            return false;
        }

        $sql = "ALTER TABLE `{$table}` ADD COLUMN `{$column}` {$definition}";
        if ($after) {
            $sql .= " AFTER `{$after}`";
        }

        $this->pdo->exec($sql);
        $this->success("Added column '{$column}' to '{$table}'");
        return true;
    }

    /**
     * Xóa cột khỏi bảng (idempotent - không lỗi nếu không tồn tại)
     * 
     * @param string $table  Tên bảng
     * @param string $column Tên cột cần xóa
     * @return bool True nếu xóa thành công, false nếu không tồn tại
     */
    protected function dropColumn(string $table, string $column): bool
    {
        if (!$this->columnExists($table, $column)) {
            $this->info("Column '{$column}' does not exist in '{$table}'");
            return false;
        }

        $this->pdo->exec("ALTER TABLE `{$table}` DROP COLUMN `{$column}`");
        $this->success("Dropped column '{$column}' from '{$table}'");
        return true;
    }

    /**
     * Thêm index vào bảng (idempotent)
     * 
     * @param string $table   Tên bảng
     * @param string $index   Tên index
     * @param string|array $columns Cột(s) để index
     * @param string $type    Loại index: 'INDEX', 'UNIQUE', 'FULLTEXT'
     * @return bool
     */
    protected function addIndex(string $table, string $index, string|array $columns, string $type = 'INDEX'): bool
    {
        if ($this->indexExists($table, $index)) {
            $this->info("Index '{$index}' already exists in '{$table}'");
            return false;
        }

        $columnList = is_array($columns) ? implode('`, `', $columns) : $columns;
        $this->pdo->exec("ALTER TABLE `{$table}` ADD {$type} `{$index}` (`{$columnList}`)");
        $this->success("Added index '{$index}' to '{$table}'");
        return true;
    }

    /**
     * Xóa index khỏi bảng (idempotent)
     */
    protected function dropIndex(string $table, string $index): bool
    {
        if (!$this->indexExists($table, $index)) {
            $this->info("Index '{$index}' does not exist in '{$table}'");
            return false;
        }

        $this->pdo->exec("ALTER TABLE `{$table}` DROP INDEX `{$index}`");
        $this->success("Dropped index '{$index}' from '{$table}'");
        return true;
    }

    /**
     * Tạo bảng (idempotent)
     * 
     * @param string $table      Tên bảng
     * @param string $definition Nội dung CREATE TABLE (không bao gồm CREATE TABLE tên)
     * @return bool
     */
    protected function createTable(string $table, string $definition): bool
    {
        if ($this->tableExists($table)) {
            $this->info("Table '{$table}' already exists");
            return false;
        }

        $this->pdo->exec("CREATE TABLE `{$table}` ({$definition}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        $this->success("Created table '{$table}'");
        return true;
    }

    /**
     * Xóa bảng (idempotent)
     */
    protected function dropTable(string $table): bool
    {
        if (!$this->tableExists($table)) {
            $this->info("Table '{$table}' does not exist");
            return false;
        }

        $this->pdo->exec("DROP TABLE `{$table}`");
        $this->success("Dropped table '{$table}'");
        return true;
    }

    /**
     * Đổi tên bảng
     */
    protected function renameTable(string $from, string $to): bool
    {
        if (!$this->tableExists($from)) {
            $this->info("Table '{$from}' does not exist");
            return false;
        }

        if ($this->tableExists($to)) {
            $this->info("Table '{$to}' already exists");
            return false;
        }

        $this->pdo->exec("RENAME TABLE `{$from}` TO `{$to}`");
        $this->success("Renamed table '{$from}' to '{$to}'");
        return true;
    }

    /**
     * Modify cột (thay đổi định nghĩa)
     */
    protected function modifyColumn(string $table, string $column, string $definition): void
    {
        $this->pdo->exec("ALTER TABLE `{$table}` MODIFY COLUMN `{$column}` {$definition}");
        $this->success("Modified column '{$column}' in '{$table}'");
    }

    // =========================================================================
    // LOGGING METHODS
    // =========================================================================

    /**
     * Log message thành công (màu xanh)
     */
    protected function success(string $message): void
    {
        echo "✅ {$message}\n";
    }

    /**
     * Log message cảnh báo (màu vàng)
     */
    protected function warning(string $message): void
    {
        echo "⚠️ {$message}\n";
    }

    /**
     * Log message lỗi (màu đỏ)
     */
    protected function error(string $message): void
    {
        echo "❌ {$message}\n";
    }

    /**
     * Log message thông tin (màu xanh dương)
     */
    protected function info(string $message): void
    {
        echo "ℹ️ {$message}\n";
    }

    /**
     * Log message bỏ qua (skip)
     */
    protected function skip(string $message): void
    {
        echo "⏭️ {$message}\n";
    }

    // =========================================================================
    // TRANSACTION HELPERS
    // =========================================================================

    /**
     * Bắt đầu transaction
     */
    protected function beginTransaction(): void
    {
        $this->pdo->beginTransaction();
    }

    /**
     * Commit transaction
     */
    protected function commit(): void
    {
        $this->pdo->commit();
    }

    /**
     * Rollback transaction
     */
    protected function rollback(): void
    {
        $this->pdo->rollBack();
    }

    /**
     * Thực thi callback trong transaction
     * 
     * @param callable $callback
     * @throws PDOException Nếu có lỗi
     */
    protected function transaction(callable $callback): void
    {
        $this->beginTransaction();
        try {
            $callback();
            $this->commit();
        } catch (PDOException $e) {
            $this->rollback();
            throw $e;
        }
    }
}
