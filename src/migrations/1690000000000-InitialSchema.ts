import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BẢN DỰNG NỀN — tạo toàn bộ lược đồ từ con số không.
 *
 * VÌ SAO PHẢI CÓ: trước migration này, một database TRỐNG không dựng lên được.
 * Năm migration đang có đều là ALTER — thêm index, thêm cột, xoá cột — và không
 * cái nào tạo `users`, `products`, `orders`. Các bảng đó ra đời từ
 * `synchronize: true` trên máy của người viết code, rồi không ai chép lại vào
 * migration. Chạy `migration:run` trên database mới cho ra ĐÚNG 4 bảng: ba
 * bảng sổ cái cộng bảng `migrations`.
 *
 * Và nó không hề báo lỗi. `AddPerformanceIndexes` bọc mọi câu lệnh trong
 * `.catch(() => {})`, nên nó nuốt "Table doesn't exist" rồi tự ghi vào bảng
 * `migrations` là đã chạy xong. Kết quả tệ hơn một lần hỏng: database rỗng
 * mang nhãn "đã cập nhật tới bản mới nhất", và lần `migration:run` sau sẽ trả
 * lời "không có gì để chạy".
 *
 * Phát hiện ra lúc dựng docker-compose.yml, ngay lần `up` đầu tiên.
 *
 * NỘI DUNG được sinh bằng `migration:generate` đối chiếu entity với một
 * database rỗng, nên nó là ảnh chụp của chính các entity — không phải chép tay.
 *
 * THỨ TỰ: mốc thời gian 1690000000000 đặt nó chạy TRƯỚC cả năm cái kia. Sau nó,
 * cả năm đều an toàn vì đều chịu được chạy lại: hai cái đầu `.catch()` mọi
 * lỗi, `CreateLedgerTables` dùng `CREATE TABLE IF NOT EXISTS`, hai cái cuối
 * kiểm cột tồn tại trước khi đụng vào.
 */

export class InitialSchema1690000000000 implements MigrationInterface {
    name = 'InitialSchema1690000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Database dựng từ trước bản nền này thì BỎ QUA, đừng tạo đè.
        //
        // Máy của cả nhóm đã có sẵn lược đồ do `synchronize: true` dựng. Không
        // có chốt này thì `migration:run` ở đó chết ngay câu đầu với
        // "Table 'users' already exists", và người ta sẽ đi xoá database để cho
        // qua chuyện.
        if (await queryRunner.hasTable('users')) {
            console.log(
                '[InitialSchema] Bảng `users` đã tồn tại — database này có trước ' +
                'bản dựng nền, bỏ qua và chỉ ghi nhận là đã chạy.',
            );
            return;
        }

        await queryRunner.query(`CREATE TABLE \`users\` (\`id\` int NOT NULL AUTO_INCREMENT, \`full_name\` varchar(100) NOT NULL, \`email\` varchar(150) NOT NULL, \`password\` varchar(255) NOT NULL, \`phone_number\` varchar(20) NULL, \`role\` enum ('buyer', 'seller', 'admin', 'moderator') NOT NULL DEFAULT 'buyer', \`avatar\` varchar(255) NULL, \`email_verified\` tinyint(1) NOT NULL DEFAULT '0', \`is_locked\` tinyint(1) NOT NULL DEFAULT '0', \`last_seen\` datetime NULL, \`gender\` varchar(10) NULL, \`refresh_token\` varchar(500) NULL, \`token_version\` int NOT NULL DEFAULT '0', \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`deleted_at\` datetime(6) NULL, INDEX \`idx_role\` (\`role\`), INDEX \`idx_email\` (\`email\`), UNIQUE INDEX \`IDX_97672ac88f789774dd47f7c8be\` (\`email\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`categories\` (\`id\` int NOT NULL AUTO_INCREMENT, \`name\` varchar(100) NOT NULL, \`description\` text NULL, \`slug\` varchar(150) NULL, \`image\` varchar(255) NULL, \`is_active\` tinyint(1) NOT NULL DEFAULT '1', \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`deleted_at\` datetime(6) NULL, UNIQUE INDEX \`IDX_8b0be371d28245da6e4f4b6187\` (\`name\`), UNIQUE INDEX \`IDX_420d9f679d41281f282f5bc7d0\` (\`slug\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`products\` (\`id\` int NOT NULL AUTO_INCREMENT, \`name\` varchar(255) NOT NULL, \`slug\` varchar(255) NULL, \`description\` text NULL, \`price\` decimal(15,2) NOT NULL DEFAULT '0.00', \`currency\` char(3) NOT NULL DEFAULT 'VND', \`stock\` int NOT NULL DEFAULT '1', \`image\` varchar(255) NULL, \`brand\` varchar(100) NULL, \`spec\` text NULL, \`images\` json NULL, \`condition\` varchar(20) NOT NULL DEFAULT 'new', \`is_freeship\` tinyint(1) NOT NULL DEFAULT '0', \`sold_count\` int NOT NULL DEFAULT '0', \`view_count\` int NOT NULL DEFAULT '0', \`status\` enum ('draft', 'pending', 'active', 'sold', 'rejected') NOT NULL DEFAULT 'active', \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`deleted_at\` datetime(6) NULL, \`category_id\` int NULL, \`seller_id\` int NULL, INDEX \`idx_seller_status\` (\`seller_id\`, \`status\`), INDEX \`idx_price\` (\`price\`), INDEX \`idx_created_at\` (\`created_at\`), INDEX \`idx_status\` (\`status\`), INDEX \`idx_seller_id\` (\`seller_id\`), INDEX \`idx_category_id\` (\`category_id\`), UNIQUE INDEX \`IDX_464f927ae360106b783ed0b410\` (\`slug\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`order_items\` (\`id\` int NOT NULL AUTO_INCREMENT, \`product_name\` varchar(255) NOT NULL, \`product_image\` varchar(255) NULL, \`price\` decimal(15,2) NOT NULL, \`quantity\` int NOT NULL DEFAULT '1', \`subtotal\` decimal(15,2) NOT NULL, \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`order_id\` int NULL, \`product_id\` int NULL, INDEX \`idx_product_id\` (\`product_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`orders\` (\`id\` int NOT NULL AUTO_INCREMENT, \`order_code\` varchar(50) NOT NULL, \`total_amount\` decimal(15,2) NOT NULL DEFAULT '0.00', \`shipping_fee\` decimal(10,2) NOT NULL DEFAULT '0.00', \`discount_amount\` decimal(10,2) NOT NULL DEFAULT '0.00', \`final_amount\` decimal(15,2) NOT NULL DEFAULT '0.00', \`currency\` char(3) NOT NULL DEFAULT 'VND', \`status\` enum ('pending', 'confirmed', 'processing', 'shipping', 'delivered', 'cancelled', 'refunded') NOT NULL DEFAULT 'pending', \`payment_method\` enum ('cod', 'bank_transfer', 'wallet', 'momo', 'vnpay', 'payos') NOT NULL DEFAULT 'cod', \`is_paid\` tinyint(1) NOT NULL DEFAULT '0', \`paid_at\` datetime NULL, \`receiver_name\` varchar(100) NOT NULL, \`receiver_phone\` varchar(20) NOT NULL, \`shipping_address\` text NOT NULL, \`province\` varchar(100) NULL, \`district\` varchar(100) NULL, \`ghn_district_id\` int NULL, \`ghn_ward_code\` varchar(20) NULL, \`note\` text NULL, \`tracking_code\` varchar(100) NULL, \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`deleted_at\` datetime(6) NULL, \`user_id\` int NULL, INDEX \`idx_user_created\` (\`user_id\`, \`created_at\`), INDEX \`idx_user_status\` (\`user_id\`, \`status\`), INDEX \`idx_created_at\` (\`created_at\`), UNIQUE INDEX \`IDX_e462c2f2237b3049aa6be3fce0\` (\`order_code\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`carts\` (\`id\` int NOT NULL AUTO_INCREMENT, \`quantity\` int NOT NULL DEFAULT '1', \`created_at\` timestamp(6) NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` timestamp(6) NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`user_id\` int NULL, \`product_id\` int NULL, UNIQUE INDEX \`unique_user_product\` (\`user_id\`, \`product_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`settings\` (\`id\` int NOT NULL AUTO_INCREMENT, \`key\` varchar(100) NOT NULL, \`value\` text NOT NULL, \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), UNIQUE INDEX \`IDX_c8639b7626fa94ba8265628f21\` (\`key\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`withdrawals\` (\`id\` int NOT NULL AUTO_INCREMENT, \`amount\` decimal(15,2) NOT NULL, \`bank_name\` varchar(100) NOT NULL, \`bank_account\` varchar(50) NOT NULL, \`bank_holder\` varchar(100) NOT NULL, \`status\` enum ('pending', 'approved', 'rejected', 'completed') NOT NULL DEFAULT 'pending', \`note\` text NULL, \`processed_at\` datetime NULL, \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`user_id\` int NULL, \`approved_by\` int NULL, INDEX \`idx_status\` (\`status\`), INDEX \`idx_user\` (\`user_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`wallets\` (\`id\` int NOT NULL AUTO_INCREMENT, \`balance\` decimal(15,2) NOT NULL DEFAULT '0.00', \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`user_id\` int NULL, UNIQUE INDEX \`REL_92558c08091598f7a4439586cd\` (\`user_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`wallet_transactions\` (\`id\` int NOT NULL AUTO_INCREMENT, \`amount\` decimal(15,2) NOT NULL, \`balance_before\` decimal(15,2) NOT NULL, \`balance_after\` decimal(15,2) NOT NULL, \`type\` enum ('topup', 'payment', 'refund', 'withdrawal') NOT NULL, \`reference\` varchar(255) NULL, \`note\` text NULL, \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`wallet_id\` int NULL, INDEX \`idx_wallet\` (\`wallet_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`payos_webhook_logs\` (\`id\` int NOT NULL AUTO_INCREMENT, \`transaction_id\` varchar(100) NOT NULL, \`body\` json NOT NULL, \`processed\` tinyint NOT NULL DEFAULT 0, \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), UNIQUE INDEX \`idx_transaction_id\` (\`transaction_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`payments\` (\`id\` int NOT NULL AUTO_INCREMENT, \`amount\` decimal(15,2) NOT NULL, \`payment_method\` enum ('cod', 'bank_transfer', 'wallet', 'momo', 'vnpay', 'payos') NOT NULL, \`transaction_code\` varchar(100) NULL, \`status\` enum ('pending', 'success', 'failed') NOT NULL DEFAULT 'pending', \`type\` enum ('order_payment', 'wallet_topup') NOT NULL, \`note\` text NULL, \`paid_at\` datetime NULL, \`payos_order_code\` varchar(50) NULL, \`payos_payment_link_id\` varchar(100) NULL, \`payos_checkout_url\` text NULL, \`payos_qr_code\` text NULL, \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`order_id\` int NULL, \`user_id\` int NULL, INDEX \`idx_payos_order_code\` (\`payos_order_code\`), INDEX \`idx_order_id\` (\`order_id\`), INDEX \`idx_user_id\` (\`user_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`ledger_accounts\` (\`id\` bigint NOT NULL AUTO_INCREMENT, \`owner_type\` enum ('user', 'platform', 'external') NOT NULL, \`owner_id\` bigint NULL, \`purpose\` enum ('available', 'escrow_hold', 'withdrawal_pending', 'revenue', 'gateway_clearing', 'bank_external') NOT NULL, \`balance\` bigint NOT NULL DEFAULT '0', \`version\` int NOT NULL, \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), UNIQUE INDEX \`uq_ledger_account\` (\`owner_type\`, \`owner_id\`, \`purpose\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`ledger_entries\` (\`id\` bigint NOT NULL AUTO_INCREMENT, \`amount\` bigint NOT NULL, \`balance_after\` bigint NOT NULL, \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`transaction_id\` bigint NULL, \`account_id\` bigint NULL, INDEX \`idx_ledger_entry_account_time\` (\`account_id\`, \`created_at\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`ledger_transactions\` (\`id\` bigint NOT NULL AUTO_INCREMENT, \`type\` enum ('topup', 'order_hold', 'escrow_release', 'escrow_refund', 'withdrawal_approve', 'withdrawal_complete', 'adjustment') NOT NULL, \`idempotency_key\` varchar(191) NOT NULL, \`reference_type\` varchar(50) NULL, \`reference_id\` bigint NULL, \`metadata\` json NULL, \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), INDEX \`idx_ledger_tx_ref\` (\`reference_type\`, \`reference_id\`), UNIQUE INDEX \`IDX_01ff7d3a76be6b7ca5fd33761d\` (\`idempotency_key\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`escrows\` (\`id\` int NOT NULL AUTO_INCREMENT, \`amount\` decimal(15,2) NOT NULL, \`status\` enum ('holding', 'released', 'refunded', 'cancelled') NOT NULL DEFAULT 'holding', \`released_at\` datetime NULL, \`note\` text NULL, \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`order_id\` int NULL, \`buyer_id\` int NULL, \`seller_id\` int NULL, INDEX \`idx_seller\` (\`seller_id\`), INDEX \`idx_order\` (\`order_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`notifications\` (\`id\` int NOT NULL AUTO_INCREMENT, \`type\` enum ('order_status', 'review', 'payment', 'system', 'message', 'new_product') NOT NULL, \`title\` varchar(255) NOT NULL, \`content\` text NOT NULL, \`data\` json NULL, \`is_read\` tinyint(1) NOT NULL DEFAULT '0', \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`user_id\` int NULL, INDEX \`idx_created_at\` (\`created_at\`), INDEX \`idx_user_read\` (\`user_id\`, \`is_read\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`conversations\` (\`id\` int NOT NULL AUTO_INCREMENT, \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`buyer_id\` int NULL, \`seller_id\` int NULL, \`product_id\` int NULL, UNIQUE INDEX \`idx_buyer_seller_product\` (\`buyer_id\`, \`seller_id\`, \`product_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`messages\` (\`id\` int NOT NULL AUTO_INCREMENT, \`content\` text NOT NULL, \`images\` json NULL, \`is_read\` tinyint(1) NOT NULL DEFAULT '0', \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`conversation_id\` int NULL, \`sender_id\` int NULL, INDEX \`idx_conversation_id\` (\`conversation_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`addresses\` (\`id\` int NOT NULL AUTO_INCREMENT, \`recipient_name\` varchar(100) NOT NULL, \`phone_number\` varchar(20) NOT NULL, \`label\` varchar(50) NOT NULL DEFAULT 'Nhà riêng', \`country\` char(2) NOT NULL DEFAULT 'VN', \`province\` varchar(100) NOT NULL, \`district\` varchar(100) NOT NULL, \`ward\` varchar(100) NULL, \`street\` varchar(255) NOT NULL, \`is_default\` tinyint(1) NOT NULL DEFAULT '0', \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`user_id\` int NULL, PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`shops\` (\`id\` int NOT NULL AUTO_INCREMENT, \`name\` varchar(100) NOT NULL, \`slug\` varchar(150) NOT NULL, \`description\` text NULL, \`logo\` varchar(255) NULL, \`banner\` varchar(255) NULL, \`phone\` varchar(20) NULL, \`address\` text NULL, \`status\` enum ('active', 'inactive', 'banned') NOT NULL DEFAULT 'active', \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`user_id\` int NULL, UNIQUE INDEX \`IDX_8c28ec876676eeb1dcb65c01b7\` (\`slug\`), UNIQUE INDEX \`REL_bb9c758dcc60137e56f6fee72f\` (\`user_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`reviews\` (\`id\` int NOT NULL AUTO_INCREMENT, \`rating\` int NOT NULL, \`comment\` text NULL, \`images\` json NULL, \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`deleted_at\` datetime(6) NULL, \`user_id\` int NULL, \`product_id\` int NULL, \`order_id\` int NULL, UNIQUE INDEX \`idx_user_product\` (\`user_id\`, \`product_id\`), INDEX \`idx_product_id\` (\`product_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`follows\` (\`id\` int NOT NULL AUTO_INCREMENT, \`follower_id\` int NOT NULL, \`following_id\` int NOT NULL, \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), UNIQUE INDEX \`IDX_8109e59f691f0444b43420f698\` (\`follower_id\`, \`following_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`files\` (\`id\` int NOT NULL AUTO_INCREMENT, \`file_name\` varchar(255) NOT NULL, \`url\` varchar(500) NOT NULL, \`mime_type\` varchar(50) NOT NULL, \`size\` int NOT NULL, \`folder\` varchar(50) NOT NULL DEFAULT 'default', \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`uploaded_by\` int NULL, PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`ALTER TABLE \`products\` ADD CONSTRAINT \`FK_9a5f6868c96e0069e699f33e124\` FOREIGN KEY (\`category_id\`) REFERENCES \`categories\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`products\` ADD CONSTRAINT \`FK_425ee27c69d6b8adc5d6475dcfe\` FOREIGN KEY (\`seller_id\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`order_items\` ADD CONSTRAINT \`FK_145532db85752b29c57d2b7b1f1\` FOREIGN KEY (\`order_id\`) REFERENCES \`orders\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`order_items\` ADD CONSTRAINT \`FK_9263386c35b6b242540f9493b00\` FOREIGN KEY (\`product_id\`) REFERENCES \`products\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`orders\` ADD CONSTRAINT \`FK_a922b820eeef29ac1c6800e826a\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`carts\` ADD CONSTRAINT \`FK_2ec1c94a977b940d85a4f498aea\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`carts\` ADD CONSTRAINT \`FK_7d0e145ebd287c1565f15114a18\` FOREIGN KEY (\`product_id\`) REFERENCES \`products\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`withdrawals\` ADD CONSTRAINT \`FK_0bd35ddb3acfb323ae3e024d2f8\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`withdrawals\` ADD CONSTRAINT \`FK_50cbe0957322ecf56d0fc523222\` FOREIGN KEY (\`approved_by\`) REFERENCES \`users\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`wallets\` ADD CONSTRAINT \`FK_92558c08091598f7a4439586cda\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`wallet_transactions\` ADD CONSTRAINT \`FK_c57d19129968160f4db28fc8b28\` FOREIGN KEY (\`wallet_id\`) REFERENCES \`wallets\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`payments\` ADD CONSTRAINT \`FK_b2f7b823a21562eeca20e72b006\` FOREIGN KEY (\`order_id\`) REFERENCES \`orders\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`payments\` ADD CONSTRAINT \`FK_427785468fb7d2733f59e7d7d39\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`ledger_entries\` ADD CONSTRAINT \`FK_b26c5ef5853fd6e0a8680427f60\` FOREIGN KEY (\`transaction_id\`) REFERENCES \`ledger_transactions\`(\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`ledger_entries\` ADD CONSTRAINT \`FK_e4440167e470be69f9622c1ceab\` FOREIGN KEY (\`account_id\`) REFERENCES \`ledger_accounts\`(\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`escrows\` ADD CONSTRAINT \`FK_72b537daeedb841ae879176863e\` FOREIGN KEY (\`order_id\`) REFERENCES \`orders\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`escrows\` ADD CONSTRAINT \`FK_1875e1b36630025a199975b06f4\` FOREIGN KEY (\`buyer_id\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`escrows\` ADD CONSTRAINT \`FK_ba66c7f85d7d80f251d1cd417f7\` FOREIGN KEY (\`seller_id\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`notifications\` ADD CONSTRAINT \`FK_9a8a82462cab47c73d25f49261f\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`conversations\` ADD CONSTRAINT \`FK_4aaec38ea4546a391d0b31efd0a\` FOREIGN KEY (\`buyer_id\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`conversations\` ADD CONSTRAINT \`FK_9cecbb6717835889c22999446cd\` FOREIGN KEY (\`seller_id\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`conversations\` ADD CONSTRAINT \`FK_67657faa4a91ed2e933684cdebc\` FOREIGN KEY (\`product_id\`) REFERENCES \`products\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`messages\` ADD CONSTRAINT \`FK_3bc55a7c3f9ed54b520bb5cfe23\` FOREIGN KEY (\`conversation_id\`) REFERENCES \`conversations\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`messages\` ADD CONSTRAINT \`FK_22133395bd13b970ccd0c34ab22\` FOREIGN KEY (\`sender_id\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`addresses\` ADD CONSTRAINT \`FK_16aac8a9f6f9c1dd6bcb75ec023\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`shops\` ADD CONSTRAINT \`FK_bb9c758dcc60137e56f6fee72f7\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`reviews\` ADD CONSTRAINT \`FK_728447781a30bc3fcfe5c2f1cdf\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`reviews\` ADD CONSTRAINT \`FK_9482e9567d8dcc2bc615981ef44\` FOREIGN KEY (\`product_id\`) REFERENCES \`products\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`reviews\` ADD CONSTRAINT \`FK_e4b0ed40bdd0f318108612c2851\` FOREIGN KEY (\`order_id\`) REFERENCES \`orders\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`follows\` ADD CONSTRAINT \`FK_54b5dc2739f2dea57900933db66\` FOREIGN KEY (\`follower_id\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`follows\` ADD CONSTRAINT \`FK_c518e3988b9c057920afaf2d8c0\` FOREIGN KEY (\`following_id\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`files\` ADD CONSTRAINT \`FK_63c92c51cd7fd95c2d79d709b61\` FOREIGN KEY (\`uploaded_by\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`files\` DROP FOREIGN KEY \`FK_63c92c51cd7fd95c2d79d709b61\``);
        await queryRunner.query(`ALTER TABLE \`follows\` DROP FOREIGN KEY \`FK_c518e3988b9c057920afaf2d8c0\``);
        await queryRunner.query(`ALTER TABLE \`follows\` DROP FOREIGN KEY \`FK_54b5dc2739f2dea57900933db66\``);
        await queryRunner.query(`ALTER TABLE \`reviews\` DROP FOREIGN KEY \`FK_e4b0ed40bdd0f318108612c2851\``);
        await queryRunner.query(`ALTER TABLE \`reviews\` DROP FOREIGN KEY \`FK_9482e9567d8dcc2bc615981ef44\``);
        await queryRunner.query(`ALTER TABLE \`reviews\` DROP FOREIGN KEY \`FK_728447781a30bc3fcfe5c2f1cdf\``);
        await queryRunner.query(`ALTER TABLE \`shops\` DROP FOREIGN KEY \`FK_bb9c758dcc60137e56f6fee72f7\``);
        await queryRunner.query(`ALTER TABLE \`addresses\` DROP FOREIGN KEY \`FK_16aac8a9f6f9c1dd6bcb75ec023\``);
        await queryRunner.query(`ALTER TABLE \`messages\` DROP FOREIGN KEY \`FK_22133395bd13b970ccd0c34ab22\``);
        await queryRunner.query(`ALTER TABLE \`messages\` DROP FOREIGN KEY \`FK_3bc55a7c3f9ed54b520bb5cfe23\``);
        await queryRunner.query(`ALTER TABLE \`conversations\` DROP FOREIGN KEY \`FK_67657faa4a91ed2e933684cdebc\``);
        await queryRunner.query(`ALTER TABLE \`conversations\` DROP FOREIGN KEY \`FK_9cecbb6717835889c22999446cd\``);
        await queryRunner.query(`ALTER TABLE \`conversations\` DROP FOREIGN KEY \`FK_4aaec38ea4546a391d0b31efd0a\``);
        await queryRunner.query(`ALTER TABLE \`notifications\` DROP FOREIGN KEY \`FK_9a8a82462cab47c73d25f49261f\``);
        await queryRunner.query(`ALTER TABLE \`escrows\` DROP FOREIGN KEY \`FK_ba66c7f85d7d80f251d1cd417f7\``);
        await queryRunner.query(`ALTER TABLE \`escrows\` DROP FOREIGN KEY \`FK_1875e1b36630025a199975b06f4\``);
        await queryRunner.query(`ALTER TABLE \`escrows\` DROP FOREIGN KEY \`FK_72b537daeedb841ae879176863e\``);
        await queryRunner.query(`ALTER TABLE \`ledger_entries\` DROP FOREIGN KEY \`FK_e4440167e470be69f9622c1ceab\``);
        await queryRunner.query(`ALTER TABLE \`ledger_entries\` DROP FOREIGN KEY \`FK_b26c5ef5853fd6e0a8680427f60\``);
        await queryRunner.query(`ALTER TABLE \`payments\` DROP FOREIGN KEY \`FK_427785468fb7d2733f59e7d7d39\``);
        await queryRunner.query(`ALTER TABLE \`payments\` DROP FOREIGN KEY \`FK_b2f7b823a21562eeca20e72b006\``);
        await queryRunner.query(`ALTER TABLE \`wallet_transactions\` DROP FOREIGN KEY \`FK_c57d19129968160f4db28fc8b28\``);
        await queryRunner.query(`ALTER TABLE \`wallets\` DROP FOREIGN KEY \`FK_92558c08091598f7a4439586cda\``);
        await queryRunner.query(`ALTER TABLE \`withdrawals\` DROP FOREIGN KEY \`FK_50cbe0957322ecf56d0fc523222\``);
        await queryRunner.query(`ALTER TABLE \`withdrawals\` DROP FOREIGN KEY \`FK_0bd35ddb3acfb323ae3e024d2f8\``);
        await queryRunner.query(`ALTER TABLE \`carts\` DROP FOREIGN KEY \`FK_7d0e145ebd287c1565f15114a18\``);
        await queryRunner.query(`ALTER TABLE \`carts\` DROP FOREIGN KEY \`FK_2ec1c94a977b940d85a4f498aea\``);
        await queryRunner.query(`ALTER TABLE \`orders\` DROP FOREIGN KEY \`FK_a922b820eeef29ac1c6800e826a\``);
        await queryRunner.query(`ALTER TABLE \`order_items\` DROP FOREIGN KEY \`FK_9263386c35b6b242540f9493b00\``);
        await queryRunner.query(`ALTER TABLE \`order_items\` DROP FOREIGN KEY \`FK_145532db85752b29c57d2b7b1f1\``);
        await queryRunner.query(`ALTER TABLE \`products\` DROP FOREIGN KEY \`FK_425ee27c69d6b8adc5d6475dcfe\``);
        await queryRunner.query(`ALTER TABLE \`products\` DROP FOREIGN KEY \`FK_9a5f6868c96e0069e699f33e124\``);
        await queryRunner.query(`DROP TABLE \`files\``);
        await queryRunner.query(`DROP INDEX \`IDX_8109e59f691f0444b43420f698\` ON \`follows\``);
        await queryRunner.query(`DROP TABLE \`follows\``);
        await queryRunner.query(`DROP INDEX \`idx_product_id\` ON \`reviews\``);
        await queryRunner.query(`DROP INDEX \`idx_user_product\` ON \`reviews\``);
        await queryRunner.query(`DROP TABLE \`reviews\``);
        await queryRunner.query(`DROP INDEX \`REL_bb9c758dcc60137e56f6fee72f\` ON \`shops\``);
        await queryRunner.query(`DROP INDEX \`IDX_8c28ec876676eeb1dcb65c01b7\` ON \`shops\``);
        await queryRunner.query(`DROP TABLE \`shops\``);
        await queryRunner.query(`DROP TABLE \`addresses\``);
        await queryRunner.query(`DROP INDEX \`idx_conversation_id\` ON \`messages\``);
        await queryRunner.query(`DROP TABLE \`messages\``);
        await queryRunner.query(`DROP INDEX \`idx_buyer_seller_product\` ON \`conversations\``);
        await queryRunner.query(`DROP TABLE \`conversations\``);
        await queryRunner.query(`DROP INDEX \`idx_user_read\` ON \`notifications\``);
        await queryRunner.query(`DROP INDEX \`idx_created_at\` ON \`notifications\``);
        await queryRunner.query(`DROP TABLE \`notifications\``);
        await queryRunner.query(`DROP INDEX \`idx_order\` ON \`escrows\``);
        await queryRunner.query(`DROP INDEX \`idx_seller\` ON \`escrows\``);
        await queryRunner.query(`DROP TABLE \`escrows\``);
        await queryRunner.query(`DROP INDEX \`IDX_01ff7d3a76be6b7ca5fd33761d\` ON \`ledger_transactions\``);
        await queryRunner.query(`DROP INDEX \`idx_ledger_tx_ref\` ON \`ledger_transactions\``);
        await queryRunner.query(`DROP TABLE \`ledger_transactions\``);
        await queryRunner.query(`DROP INDEX \`idx_ledger_entry_account_time\` ON \`ledger_entries\``);
        await queryRunner.query(`DROP TABLE \`ledger_entries\``);
        await queryRunner.query(`DROP INDEX \`uq_ledger_account\` ON \`ledger_accounts\``);
        await queryRunner.query(`DROP TABLE \`ledger_accounts\``);
        await queryRunner.query(`DROP INDEX \`idx_user_id\` ON \`payments\``);
        await queryRunner.query(`DROP INDEX \`idx_order_id\` ON \`payments\``);
        await queryRunner.query(`DROP INDEX \`idx_payos_order_code\` ON \`payments\``);
        await queryRunner.query(`DROP TABLE \`payments\``);
        await queryRunner.query(`DROP INDEX \`idx_transaction_id\` ON \`payos_webhook_logs\``);
        await queryRunner.query(`DROP TABLE \`payos_webhook_logs\``);
        await queryRunner.query(`DROP INDEX \`idx_wallet\` ON \`wallet_transactions\``);
        await queryRunner.query(`DROP TABLE \`wallet_transactions\``);
        await queryRunner.query(`DROP INDEX \`REL_92558c08091598f7a4439586cd\` ON \`wallets\``);
        await queryRunner.query(`DROP TABLE \`wallets\``);
        await queryRunner.query(`DROP INDEX \`idx_user\` ON \`withdrawals\``);
        await queryRunner.query(`DROP INDEX \`idx_status\` ON \`withdrawals\``);
        await queryRunner.query(`DROP TABLE \`withdrawals\``);
        await queryRunner.query(`DROP INDEX \`IDX_c8639b7626fa94ba8265628f21\` ON \`settings\``);
        await queryRunner.query(`DROP TABLE \`settings\``);
        await queryRunner.query(`DROP INDEX \`unique_user_product\` ON \`carts\``);
        await queryRunner.query(`DROP TABLE \`carts\``);
        await queryRunner.query(`DROP INDEX \`IDX_e462c2f2237b3049aa6be3fce0\` ON \`orders\``);
        await queryRunner.query(`DROP INDEX \`idx_created_at\` ON \`orders\``);
        await queryRunner.query(`DROP INDEX \`idx_user_status\` ON \`orders\``);
        await queryRunner.query(`DROP INDEX \`idx_user_created\` ON \`orders\``);
        await queryRunner.query(`DROP TABLE \`orders\``);
        await queryRunner.query(`DROP INDEX \`idx_product_id\` ON \`order_items\``);
        await queryRunner.query(`DROP TABLE \`order_items\``);
        await queryRunner.query(`DROP INDEX \`IDX_464f927ae360106b783ed0b410\` ON \`products\``);
        await queryRunner.query(`DROP INDEX \`idx_category_id\` ON \`products\``);
        await queryRunner.query(`DROP INDEX \`idx_seller_id\` ON \`products\``);
        await queryRunner.query(`DROP INDEX \`idx_status\` ON \`products\``);
        await queryRunner.query(`DROP INDEX \`idx_created_at\` ON \`products\``);
        await queryRunner.query(`DROP INDEX \`idx_price\` ON \`products\``);
        await queryRunner.query(`DROP INDEX \`idx_seller_status\` ON \`products\``);
        await queryRunner.query(`DROP TABLE \`products\``);
        await queryRunner.query(`DROP INDEX \`IDX_420d9f679d41281f282f5bc7d0\` ON \`categories\``);
        await queryRunner.query(`DROP INDEX \`IDX_8b0be371d28245da6e4f4b6187\` ON \`categories\``);
        await queryRunner.query(`DROP TABLE \`categories\``);
        await queryRunner.query(`DROP INDEX \`IDX_97672ac88f789774dd47f7c8be\` ON \`users\``);
        await queryRunner.query(`DROP INDEX \`idx_email\` ON \`users\``);
        await queryRunner.query(`DROP INDEX \`idx_role\` ON \`users\``);
        await queryRunner.query(`DROP TABLE \`users\``);
    }

}
