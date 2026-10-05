/**
 * Dựng lược đồ cho một CSDL phát triển còn trống.
 *
 * Vì sao cần script này: app.module.ts để `synchronize: false` (đúng — bật nó
 * trên CSDL thật là nguy hiểm), mà các bảng gốc (users, products, orders…)
 * KHÔNG có migration nào tạo ra chúng. Trong src/migrations chỉ có migration
 * thêm index, fulltext và bảng ledger. Nên một CSDL mới tinh không có cách nào
 * lên lược đồ ngoài synchronize.
 *
 * Chỉ chạy khi tên CSDL kết thúc bằng _dev hoặc _test, để không ai lỡ tay trỏ
 * nó vào CSDL thật.
 *
 * Cách chạy (từ thư mục Zoldify_Backend, sau khi đã có file cấu hình):
 *   npx ts-node -r tsconfig-paths/register scripts/bootstrap-dev-schema.ts
 *   npm run seed
 */
import { DataSource } from 'typeorm';
import { config } from 'dotenv';

config();

async function main() {
  const database = process.env.DB_DATABASE || '';
  if (!/_(dev|test)$/.test(database)) {
    throw new Error(
      `Từ chối synchronize lên "${database}". Script này chỉ chạy với CSDL có tên ` +
        `kết thúc bằng _dev hoặc _test.`,
    );
  }

  const ds = new DataSource({
    type: 'mysql',
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    username: process.env.DB_USERNAME || 'root',
    password: process.env.DB_PASSWORD || '',
    database,
    entities: [__dirname + '/../src/**/*.entity.ts'],
    synchronize: true,
    logging: ['error'],
  });

  await ds.initialize();
  const [{ n }] = await ds.query(
    `SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ?`,
    [database],
  );
  console.log(`OK — ${database} có ${n} bảng.`);
  await ds.destroy();
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
