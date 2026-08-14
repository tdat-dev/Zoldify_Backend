/**
 * Soát cấu hình một lượt, TRƯỚC khi bật máy chủ.
 *
 * Lý do có file này, đo được khi dựng máy mới: mỗi lần bật server chỉ lộ ra
 * ĐÚNG MỘT biến còn thiếu, vì Nest dừng ngay ở lỗi đầu tiên. Điền DB_PORT rồi
 * bật -> lòi DB_PASSWORD. Điền xong bật lại -> lòi JWT_ACCESS_SECRET. Mỗi vòng
 * mất một lần build và ba mươi giây chờ, mà thông tin thu về chỉ là một dòng.
 *
 * Ở đây kiểm hết rồi liệt kê hết, kèm cách lấy giá trị.
 *
 * KHÔNG BAO GIỜ in giá trị của biến — chỉ in tên và trạng thái. Log này hay bị
 * dán vào chat, vào issue, vào ảnh chụp màn hình.
 *
 *   npm run env:check
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * `required: true` — thiếu là máy chủ không khởi động được, hoặc khởi động rồi
 * nhưng một luồng nghiệp vụ chết hẳn. `required: false` — thiếu thì tính năng
 * đó tắt, phần còn lại vẫn chạy, đúng như file mẫu mô tả.
 */
const VARS = [
  { name: 'DB_HOST', required: true, hint: 'Máy chạy MySQL. Docker trên cùng máy thì 127.0.0.1.' },
  { name: 'DB_PORT', required: true, hint: 'Cổng MySQL. Xem bằng: docker ps' },
  { name: 'DB_USERNAME', required: true, hint: 'Thường là root.' },
  {
    name: 'DB_PASSWORD',
    required: true,
    allowEmpty: true,
    hint: 'Phải khớp MYSQL_ROOT_PASSWORD của container. MySQL báo "using password: NO" tức là biến này đang trống.',
  },
  { name: 'DB_DATABASE', required: true, hint: 'Tên database, ví dụ zoldify_dev.' },

  { name: 'JWT_ACCESS_SECRET', required: true, generatable: true, hint: 'Thiếu thì Nest chết ngay: "JwtStrategy requires a secret or key".' },
  { name: 'JWT_REFRESH_TOKEN_SECRET', required: true, generatable: true, hint: 'Chuỗi KHÁC với chuỗi trên.' },

  {
    name: 'EMAIL_USER',
    required: true,
    hint: 'Tài khoản ĐĂNG NHẬP SMTP. Thiếu thì không ai đăng ký được. Thử: npm run mail:test',
  },
  { name: 'EMAIL_APP_PASSWORD', required: true, hint: 'App Password, không phải mật khẩu đăng nhập thường.' },
  { name: 'EMAIL_FROM', required: false, hint: 'Địa chỉ người nhận nhìn thấy. Trống thì dùng EMAIL_USER.' },

  { name: 'PAYOS_CLIENT_ID', required: false, hint: 'Thiếu thì luồng thanh toán hỏng, phần còn lại chạy.' },
  { name: 'PAYOS_API_KEY', required: false },
  { name: 'PAYOS_CHECKSUM_KEY', required: false },
  {
    name: 'PAYOS_HOST',
    required: false,
    hint: 'Trống thì trỏ thẳng vào máy chủ THẬT của PayOS (api-merchant.payos.vn) — mọi link tạo ra là giao dịch thật. Đặt sang sandbox khi còn đang thử.',
  },
  { name: 'GHN_TOKEN', required: false, hint: 'Thiếu thì đơn vẫn xác nhận được, chỉ không có mã vận đơn.' },
  { name: 'SEPAY_WEBHOOK_SECRET', required: false, hint: 'Thiếu thì không đối soát được biến động số dư ngân hàng.' },
];

/**
 * Khoá Firebase là một FILE, không phải biến — nên nó lọt khỏi mọi lần soát
 * biến môi trường. Thiếu nó thì backend vẫn khởi động bình thường, chỉ có đăng
 * nhập bằng Google tắt câm; không ai để ý cho tới khi người dùng kêu.
 *
 * Thứ tự tìm ở đây phải khớp FirebaseService.candidatePaths(), nếu không thì
 * script báo "có" mà server vẫn không nạp được. Bỏ ứng viên thứ ba (đường dẫn
 * theo __dirname, trỏ vào dist/) vì script luôn chạy từ gốc dự án — và cũng vì
 * đặt khoá trong dist/ là sai: `nest build` xoá sạch thư mục đó.
 */
function findFirebaseKey() {
  const fromEnv = process.env.FIREBASE_SERVICE_ACCOUNT;
  const candidates = [
    ...(fromEnv ? [resolve(fromEnv)] : []),
    join(process.cwd(), 'firebase-service-account.json'),
  ];
  return candidates.find((p) => existsSync(p)) || null;
}

const missing = [];
const emptyOptional = [];

for (const v of VARS) {
  const value = process.env[v.name];
  // Chuỗi rỗng và biến chưa khai là hai chuyện khác nhau với người đọc file,
  // nhưng với ứng dụng thì như nhau — cả hai đều không dùng được.
  const present = value !== undefined && value !== '';
  if (present) continue;
  (v.required ? missing : emptyOptional).push(v);
}

console.log('Soát cấu hình backend\n');

for (const v of VARS) {
  const value = process.env[v.name];
  const present = value !== undefined && value !== '';
  const mark = present ? 'co ' : v.required ? 'THIEU' : '  -  ';
  console.log(`  [${mark}] ${v.name}`);
}

// In ĐƯỜNG DẪN chứ không chỉ "có/không": khi máy có nhiều bản khoá lệch nhau,
// đây là thứ duy nhất cho biết bản nào sẽ được nạp.
const firebaseKey = findFirebaseKey();
console.log(
  `\n  [${firebaseKey ? 'co ' : '  -  '}] firebase-service-account.json` +
    (firebaseKey
      ? `\n         ${firebaseKey}`
      : '\n         Trống thì đăng nhập bằng Google tắt, phần còn lại chạy.'),
);

// Ngoại lệ DUY NHẤT của luật "không in giá trị": PAYOS_HOST là một URL, không
// phải bí mật — và nhầm nó là tạo giao dịch THẬT bằng tiền thật trong lúc còn
// đang thử. Biết mình đang trỏ vào đâu quan trọng hơn nhiều so với việc giấu
// một cái tên miền. Vẫn không in gì khác ngoài host.
const payosHost = process.env.PAYOS_HOST || 'https://api-merchant.payos.vn';
const isLivePayos = payosHost.includes('api-merchant.payos.vn');
console.log(
  `\n  PayOS trỏ vào: ${payosHost}` +
    (isLivePayos
      ? '\n         ĐÂY LÀ MÁY CHỦ THẬT — mọi link tạo ra là giao dịch thật.'
      : '\n         Không phải host thật của PayOS — coi như đang thử.'),
);

if (emptyOptional.length) {
  console.log('\nTrống nhưng không chặn khởi động:');
  for (const v of emptyOptional) {
    console.log(`  ${v.name}${v.hint ? ` — ${v.hint}` : ''}`);
  }
}

if (!missing.length) {
  console.log('\nĐủ biến bắt buộc. Bật được máy chủ.');
  process.exit(0);
}

console.log(`\n${missing.length} biến BẮT BUỘC còn trống:\n`);
for (const v of missing) {
  console.log(`  ${v.name}`);
  if (v.hint) console.log(`    ${v.hint}`);
}

const generated = missing.filter((v) => v.generatable);
if (generated.length) {
  // Sinh sẵn cho những biến chỉ cần "một chuỗi ngẫu nhiên đủ dài" — bắt người
  // ta đi tra lệnh openssl cho một việc máy tự làm được là thừa.
  console.log('\nDán thẳng vào file cấu hình (mỗi máy một bộ riêng, đừng dùng lại của nhau):\n');
  for (const v of generated) console.log(`${v.name}=${randomBytes(48).toString('base64url')}`);
}

console.log('\nChưa có file cấu hình thì chép mẫu ra trước:  cp .env.sample .env');
process.exit(1);
