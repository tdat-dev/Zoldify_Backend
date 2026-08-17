import { MigrationInterface, QueryRunner } from "typeorm";

export class AddProductFulltextIndex1786936802838 implements MigrationInterface {
    name = 'AddProductFulltextIndex1786936802838'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`users\` CHANGE \`email_verified\` \`email_verified\` tinyint(1) NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE \`users\` CHANGE \`is_locked\` \`is_locked\` tinyint(1) NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE \`categories\` CHANGE \`is_active\` \`is_active\` tinyint(1) NOT NULL DEFAULT '1'`);
        await queryRunner.query(`ALTER TABLE \`products\` CHANGE \`is_freeship\` \`is_freeship\` tinyint(1) NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE \`orders\` CHANGE \`is_paid\` \`is_paid\` tinyint(1) NOT NULL DEFAULT '0'`);
        await queryRunner.query(`DROP INDEX \`idx_user_read\` ON \`notifications\``);
        await queryRunner.query(`ALTER TABLE \`notifications\` CHANGE \`is_read\` \`is_read\` tinyint(1) NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE \`messages\` CHANGE \`is_read\` \`is_read\` tinyint(1) NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE \`addresses\` CHANGE \`is_default\` \`is_default\` tinyint(1) NOT NULL DEFAULT '0'`);
        await queryRunner.query(`CREATE INDEX \`idx_user_read\` ON \`notifications\` (\`user_id\`, \`is_read\`)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX \`idx_user_read\` ON \`notifications\``);
        await queryRunner.query(`ALTER TABLE \`addresses\` CHANGE \`is_default\` \`is_default\` tinyint NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE \`messages\` CHANGE \`is_read\` \`is_read\` tinyint NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE \`notifications\` CHANGE \`is_read\` \`is_read\` tinyint NOT NULL DEFAULT '0'`);
        await queryRunner.query(`CREATE INDEX \`idx_user_read\` ON \`notifications\` (\`user_id\`, \`is_read\`)`);
        await queryRunner.query(`ALTER TABLE \`orders\` CHANGE \`is_paid\` \`is_paid\` tinyint NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE \`products\` CHANGE \`is_freeship\` \`is_freeship\` tinyint NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE \`categories\` CHANGE \`is_active\` \`is_active\` tinyint NOT NULL DEFAULT '1'`);
        await queryRunner.query(`ALTER TABLE \`users\` CHANGE \`is_locked\` \`is_locked\` tinyint NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE \`users\` CHANGE \`email_verified\` \`email_verified\` tinyint NOT NULL DEFAULT '0'`);
    }

}
