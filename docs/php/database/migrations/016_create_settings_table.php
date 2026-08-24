<?php

/**
 * Migration: Create settings table
 * 
 * @author  Zoldify Team
 * @date    2026-01-02
 * @version 2.0.0 (refactored)
 */

require_once __DIR__ . '/../BaseMigration.php';

use Database\BaseMigration;

return new class extends BaseMigration {

    protected string $table = 'settings';

    public function up(): void
    {
        if ($this->tableExists($this->table)) {
            $this->skip("Table '{$this->table}' already exists");
            return;
        }

        $this->pdo->exec("
            CREATE TABLE {$this->table} (
                id INT AUTO_INCREMENT PRIMARY KEY,
                setting_key VARCHAR(100) NOT NULL UNIQUE,
                setting_value TEXT DEFAULT NULL,
                setting_group VARCHAR(50) NOT NULL DEFAULT 'general',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                
                INDEX idx_setting_key (setting_key),
                INDEX idx_setting_group (setting_group)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ");

        $this->success("Created table '{$this->table}'");

        // Seed default settings
        $this->seedDefaultSettings();
    }

    public function down(): void
    {
        $this->dropTable($this->table);
    }

    private function seedDefaultSettings(): void
    {
        $settings = [
            // General
            ['site_name', 'Zoldify', 'general'],
            ['site_description', 'Sàn thương mại điện tử đồ cũ', 'general'],
            ['site_logo', '', 'general'],
            ['site_favicon', '', 'general'],

            // Contact
            ['contact_email', 'admin@zoldify.com', 'contact'],
            ['contact_phone', '', 'contact'],
            ['contact_address', '', 'contact'],

            // Email
            ['smtp_host', '', 'email'],
            ['smtp_port', '587', 'email'],
            ['smtp_username', '', 'email'],
            ['smtp_password', '', 'email'],
            ['smtp_encryption', 'tls', 'email'],
            ['mail_from_name', 'Zoldify', 'email'],
            ['mail_from_email', '', 'email'],

            // Payment
            ['payment_gateway', 'vnpay', 'payment'],
            ['payment_api_key', '', 'payment'],
            ['payment_secret_key', '', 'payment'],

            // Social
            ['social_facebook', '', 'social'],
            ['social_zalo', '', 'social'],
            ['social_instagram', '', 'social'],
            ['social_youtube', '', 'social'],

            // Maintenance
            ['maintenance_mode', '0', 'maintenance'],
            ['maintenance_message', 'Website đang bảo trì, vui lòng quay lại sau.', 'maintenance'],
        ];

        $stmt = $this->pdo->prepare("
            INSERT INTO {$this->table} (setting_key, setting_value, setting_group) 
            VALUES (?, ?, ?)
        ");

        foreach ($settings as $setting) {
            try {
                $stmt->execute($setting);
            } catch (PDOException $e) {
                // Ignore duplicate key errors
            }
        }

        $this->success("Seeded " . count($settings) . " default settings");
    }
};
