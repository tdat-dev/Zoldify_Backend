import { DataSource } from 'typeorm';
import { PromoteShopOwnersToSeller1789400000000 } from '../../migrations/1789400000000-PromoteShopOwnersToSeller';

/**
 * Migration nâng vai trò cho người ĐÃ mở shop trước bản sửa issue #41.
 *
 * Bản sửa chỉ chữa người mở shop từ nay về sau. Trên staging 12/11 đã có ít
 * nhất hai tài khoản mở shop mà vẫn `buyer` (id 18, 21), và app của họ vẫn
 * giấu khu Người bán. Migration này nâng đúng những người đó: có shop VÀ đang
 * `buyer`. Không đụng admin, moderator, và không đụng người mua chưa có shop.
 *
 * Chạy migration thật trên database dựng tạm, cùng cách với
 * `ops/tasks/confirmed-at-backfill.spec.ts`. File nằm ngoài `src/migrations/`
 * vì data-source nạp mọi file trong đó làm migration.
 */
const TEST_DB = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 3307),
  username: process.env.TEST_DB_USER ?? 'root',
  password: process.env.TEST_DB_PASSWORD ?? 'testpw',
};

jest.setTimeout(60_000);

describe('NangVaiChuShopCu: buyer đã có shop thành seller', () => {
  const DB_NAME = `zoldify_mig_${Date.now()}_${Math.floor(Math.random() * 1e4)}`;
  let root: DataSource;
  let ds: DataSource;

  beforeAll(async () => {
    root = new DataSource({ type: 'mysql', ...TEST_DB, database: 'mysql' });
    try {
      await root.initialize();
    } catch (err) {
      throw new Error(
        `Không kết nối được MySQL cho test tại ${TEST_DB.host}:${TEST_DB.port}. ` +
          `Chạy: npm run test:db\nLỗi gốc: ${(err as Error).message}`,
      );
    }
    await root.query(`CREATE DATABASE \`${DB_NAME}\``);
    ds = new DataSource({ type: 'mysql', ...TEST_DB, database: DB_NAME });
    await ds.initialize();
    // Chỉ những cột migration đụng tới.
    await ds.query(
      `CREATE TABLE users (
         id int NOT NULL PRIMARY KEY,
         role varchar(20) NOT NULL
       )`,
    );
    await ds.query(
      `CREATE TABLE shops (
         id int NOT NULL AUTO_INCREMENT PRIMARY KEY,
         user_id int NOT NULL
       )`,
    );
  });

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
    if (root?.isInitialized) {
      await root.query(`DROP DATABASE IF EXISTS \`${DB_NAME}\``);
      await root.destroy();
    }
  });

  it('chỉ buyer có shop được nâng, các vai khác giữ nguyên', async () => {
    const people: Array<[number, string, boolean]> = [
      [1, 'buyer', true], // mở shop trước bản sửa: phải thành seller
      [2, 'buyer', false], // chỉ mua: giữ buyer
      [3, 'admin', true], // admin có shop: không bị hạ
      [4, 'moderator', true],
      [5, 'seller', true],
    ];
    for (const [id, role, hasShop] of people) {
      await ds.query('INSERT INTO users (id, role) VALUES (?, ?)', [id, role]);
      if (hasShop)
        await ds.query('INSERT INTO shops (user_id) VALUES (?)', [id]);
    }

    const qr = ds.createQueryRunner();
    try {
      await new PromoteShopOwnersToSeller1789400000000().up(qr);
    } finally {
      await qr.release();
    }

    const rows = await ds.query<Array<{ id: number; role: string }>>(
      'SELECT id, role FROM users ORDER BY id',
    );
    expect(rows.map((r) => [Number(r.id), r.role])).toEqual([
      [1, 'seller'],
      [2, 'buyer'],
      [3, 'admin'],
      [4, 'moderator'],
      [5, 'seller'],
    ]);
  });
});
