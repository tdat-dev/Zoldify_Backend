<?php

/**
 * Migration: Add password reset columns to users table
 * 
 * Adds columns required for password reset functionality:
 * - password_reset_token: stores the OTP token
 * - password_reset_expires_at: token expiration datetime
 * - password_reset_attempts: track failed attempts
 * - password_reset_locked_until: lockout timestamp for brute force protection
 * 
 * @author  Zoldify Team
 * @date    2026-01-25
 * @version 1.0.0
 */

require_once __DIR__ . '/../BaseMigration.php';

use Database\BaseMigration;

return new class extends BaseMigration {

    protected string $table = 'users';

    public function up(): void
    {
        // Add password reset token column
        $this->addColumn(
            $this->table, 
            'password_reset_token', 
            "VARCHAR(100) DEFAULT NULL", 
            'is_locked'
        );

        // Add password reset expiration column
        $this->addColumn(
            $this->table, 
            'password_reset_expires_at', 
            "DATETIME DEFAULT NULL", 
            'password_reset_token'
        );

        // Add password reset attempts column for rate limiting
        $this->addColumn(
            $this->table, 
            'password_reset_attempts', 
            "INT DEFAULT 0", 
            'password_reset_expires_at'
        );

        // Add password reset lockout column for brute force protection
        $this->addColumn(
            $this->table, 
            'password_reset_locked_until', 
            "DATETIME DEFAULT NULL", 
            'password_reset_attempts'
        );
    }

    public function down(): void
    {
        $this->dropColumn($this->table, 'password_reset_locked_until');
        $this->dropColumn($this->table, 'password_reset_attempts');
        $this->dropColumn($this->table, 'password_reset_expires_at');
        $this->dropColumn($this->table, 'password_reset_token');
    }
};
