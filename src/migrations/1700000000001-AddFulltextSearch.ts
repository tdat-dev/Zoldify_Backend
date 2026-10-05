import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFulltextSearch1700000000001 implements MigrationInterface {
  name = 'AddFulltextSearch1700000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner
      .query(
        `ALTER TABLE products ADD FULLTEXT INDEX ft_name_desc (name, description)`,
      )
      .catch(() => null);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner
      .query(`ALTER TABLE products DROP INDEX ft_name_desc`)
      .catch(() => null);
  }
}
