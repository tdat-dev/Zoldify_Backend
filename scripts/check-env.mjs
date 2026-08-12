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

/**
 * `bat_buoc`: thiếu là máy chủ không khởi động được, hoặc khởi động rồi nhưng
 * một luồng nghiệp vụ chết hẳn. `tuy_chon`: thiếu thì tính năng đó tắt, phần
 * còn lại vẫn chạy — đúng như .env.sample mô tả.
 */
const BIEN = [
  { ten: 'DB_HOST', bat_buoc: true, goi_y: 'Máy chạy MySQL. Docker trên cùng máy thì 127.0.0.1.' },
  { ten: 'DB_PORT', bat_buoc: true, goi_y: 'Cổng MySQL. Xem bằng: docker ps' },
  { ten: 'DB_USERNAME', bat_buoc: true, goi_y: 'Thường là root.' },
  {
    ten: 'DB_PASSWORD',
    bat_buoc: true,
    cho_phep_rong: true,
    goi_y: 'Phải khớp MYSQL_ROOT_PASSWORD của container. MySQL báo "using password: NO" tức là biến này đang trống.',
  },
  { ten: 'DB_DATABASE', bat_buoc: true, goi_y: 'Tên database, ví dụ zoldify_dev.' },

  { ten: 'JWT_ACCESS_SECRET', bat_buoc: true, sinh_duoc: true, goi_y: 'Thiếu thì Nest chết ngay: "JwtStrategy requires a secret or key".' },
  { ten: 'JWT_REFRESH_TOKEN_SECRET', bat_buoc: true, sinh_duoc: true, goi_y: 'Chuỗi KHÁC với chuỗi trên.' },

  {
    ten: 'EMAIL_USER',
    bat_buoc: true,
    goi_y: 'Tài khoản ĐĂNG NHẬP SMTP. Thiếu thì không ai đăng ký được. Thử: npm run mail:test',
  },
  { ten: 'EMAIL_APP_PASSWORD', bat_buoc: true, goi_y: 'App Password, không phải mật khẩu đăng nhập thường.' },
  { ten: 'EMAIL_FROM', bat_buoc: false, goi_y: 'Địa chỉ người nhận nhìn thấy. Trống thì dùng EMAIL_USER.' },

  { ten: 'PAYOS_CLIENT_ID', bat_buoc: false, goi_y: 'Thiếu thì luồng thanh toán hỏng, phần còn lại chạy.' },
  { ten: 'PAYOS_API_KEY', bat_buoc: false },
  { ten: 'PAYOS_CHECKSUM_KEY', bat_buoc: false },
  { ten: 'GHN_TOKEN', bat_buoc: false, goi_y: 'Thiếu thì đơn vẫn xác nhận được, chỉ không có mã vận đơn.' },
  { ten: 'SEPAY_WEBHOOK_SECRET', bat_buoc: false, goi_y: 'Thiếu thì không đối soát được biến động số dư ngân hàng.' },
];

const thieu = [];
const trong_tuy_chon = [];

for (const b of BIEN) {
  const v = process.env[b.ten];
  // Chuỗi rỗng và biến chưa khai là hai chuyện khác nhau với người đọc file,
  // nhưng với ứng dụng thì như nhau — cả hai đều không dùng được.
  const co = v !== undefined && v !== '';
  if (co) continue;
  (b.bat_buoc ? thieu : trong_tuy_chon).push(b);
}

console.log('Soát cấu hình backend\n');

for (const b of BIEN) {
  const v = process.env[b.ten];
  const co = v !== undefined && v !== '';
  const dau = co ? 'co ' : b.bat_buoc ? 'THIEU' : '  -  ';
  console.log(`  [${dau}] ${b.ten}`);
}

if (trong_tuy_chon.length) {
  console.log('\nTrống nhưng không chặn khởi động:');
  for (const b of trong_tuy_chon) {
    console.log(`  ${b.ten}${b.goi_y ? ` — ${b.goi_y}` : ''}`);
  }
}

if (!thieu.length) {
  console.log('\nĐủ biến bắt buộc. Bật được máy chủ.');
  process.exit(0);
}

console.log(`\n${thieu.length} biến BẮT BUỘC còn trống:\n`);
for (const b of thieu) {
  console.log(`  ${b.ten}`);
  if (b.goi_y) console.log(`    ${b.goi_y}`);
}

const sinh = thieu.filter((b) => b.sinh_duoc);
if (sinh.length) {
  // Sinh sẵn cho những biến chỉ cần "một chuỗi ngẫu nhiên đủ dài" — bắt người
  // ta đi tra lệnh openssl cho một việc máy tự làm được là thừa.
  console.log('\nDán thẳng vào file cấu hình (mỗi máy một bộ riêng, đừng dùng lại của nhau):\n');
  for (const b of sinh) console.log(`${b.ten}=${randomBytes(48).toString('base64url')}`);
}

console.log('\nChưa có file cấu hình thì chép mẫu ra trước:  cp .env.sample .env');
process.exit(1);
