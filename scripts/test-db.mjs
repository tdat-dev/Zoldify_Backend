#!/usr/bin/env node
/**
 * Dựng database cho test tự động, và chờ tới lúc nó thật sự nhận kết nối.
 *
 * Bản cũ chỉ có mỗi `docker run`. Hai chỗ nó hỏng:
 *
 *  1. Container đã tồn tại nhưng đang tắt (máy khởi động lại là thế) thì
 *     `docker run` chết với "name already in use", trong khi việc cần làm chỉ
 *     là `docker start`.
 *  2. `docker run` trả về ngay khi container khởi động, còn MySQL thì mất
 *     thêm chục giây mới nhận kết nối. Chạy test luôn sau đó là ECONNREFUSED.
 *
 *   npm run test:db
 */
import { execFileSync } from 'node:child_process';

const NAME = 'zoldify-test-mysql';
const PORT = process.env.TEST_DB_PORT ?? '3307';
const PASSWORD = process.env.TEST_DB_PASSWORD ?? 'testpw';
const DATABASE = process.env.TEST_DB_NAME ?? 'zoldify_test';

const docker = (args, opts = {}) =>
  execFileSync('docker', args, { encoding: 'utf8', ...opts }).trim();

function containerState() {
  try {
    const out = docker(['ps', '-a', '--filter', `name=^${NAME}$`, '--format', '{{.State}}']);
    return out || null;
  } catch {
    console.error('Không gọi được docker. Docker Desktop đã chạy chưa?');
    process.exit(1);
  }
}

const state = containerState();

if (state === 'running') {
  console.log(`Container ${NAME} đang chạy.`);
} else if (state) {
  console.log(`Container ${NAME} đang tắt, bật lại...`);
  docker(['start', NAME], { stdio: 'pipe' });
} else {
  console.log(`Chưa có container ${NAME}, tạo mới...`);
  docker([
    'run', '-d', '--name', NAME,
    '-e', `MYSQL_ROOT_PASSWORD=${PASSWORD}`,
    '-e', `MYSQL_DATABASE=${DATABASE}`,
    '-p', `${PORT}:3306`,
    'mysql:8',
  ], { stdio: 'pipe' });
}

// Chờ MySQL nhận kết nối thật, không chỉ chờ container "up"
process.stdout.write('Chờ MySQL sẵn sàng');
const DEADLINE = Date.now() + 90_000;
let ready = false;

while (Date.now() < DEADLINE) {
  try {
    docker(['exec', NAME, 'mysqladmin', 'ping', '-uroot', `-p${PASSWORD}`, '--silent'], {
      stdio: 'pipe',
    });
    ready = true;
    break;
  } catch {
    process.stdout.write('.');
    // Ngủ đồng bộ: script này chỉ có một việc, không cần bất đồng bộ
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
  }
}

console.log('');

if (!ready) {
  console.error(`MySQL không sẵn sàng sau 90 giây. Xem log: docker logs ${NAME}`);
  process.exit(1);
}

// Database có thể chưa tồn tại nếu container được tạo từ trước với tên khác
docker([
  'exec', NAME, 'mysql', '-uroot', `-p${PASSWORD}`,
  '-e', `CREATE DATABASE IF NOT EXISTS \`${DATABASE}\``,
], { stdio: 'pipe' });

console.log(`Sẵn sàng: ${DATABASE} tại 127.0.0.1:${PORT}. Chạy test bằng: npm test`);
