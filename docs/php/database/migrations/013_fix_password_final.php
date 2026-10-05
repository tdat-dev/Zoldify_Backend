<?php

/**
 * Migration: Final password fix
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
        // Already handled in previous migrations
        $this->skip("Password fixes already applied in migrations 011 and 012");
    }

    public function down(): void
    {
        // No-op
    }
};
