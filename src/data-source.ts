import { DataSource } from 'typeorm';
import { config as loadEnv } from 'dotenv';

// Nạp .env cho lúc chạy bằng CLI trên máy cá nhân. Trong container không có file
// này và dotenv im lặng bỏ qua — biến tới từ môi trường do compose truyền vào.
loadEnv({ path: '.env' });

/**
 * DataSource dùng cho CLI của TypeORM (migration:generate / run / revert).
 *
 * Đường dẫn đi qua `__dirname` chứ KHÔNG viết cứng `src/...`.
 *
 * Lý do: file này chạy ở hai nơi khác hẳn nhau. Trên máy cá nhân nó là
 * `src/data-source.ts` chạy qua ts-node, `__dirname` trỏ vào `src`. Trong
 * container nó là `dist/data-source.js`, `__dirname` trỏ vào `dist`, và ở đó
 * KHÔNG có thư mục `src` nào cả. Bản cũ viết cứng `src/**` nên trong container
 * nó tìm được 0 entity và 0 migration — rồi báo "No migrations are pending" và
 * thoát bằng mã 0. Chạy migration mà không migration gì, không lỗi nào.
 *
 * Mẫu `{.ts,.js}` là mẫu app.module.ts vẫn dùng, giữ giống nhau để hai bên
 * không bao giờ nhìn thấy hai tập entity khác nhau.
 */
export default new DataSource({
  type: 'mysql',
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  username: process.env.DB_USERNAME || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_DATABASE || 'zoldify',
  entities: [__dirname + '/**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  synchronize: false,
});
