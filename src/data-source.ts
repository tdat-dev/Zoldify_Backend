import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import { config as loadEnv } from 'dotenv';

// Load .env (NestJS ConfigModule dùng dotenv, CLI cũng cần)
loadEnv({ path: '.env' });

export default new DataSource({
  type: 'mysql',
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  username: process.env.DB_USERNAME || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_DATABASE || 'zoldify',
  entities: ['src/**/*.entity.ts'],
  migrations: ['src/migrations/*.ts'],
  synchronize: false,
});