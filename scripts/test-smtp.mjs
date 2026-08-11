/**
 * Thử cấu hình gửi mail, tách rời khỏi cả ứng dụng.
 *
 * Lý do có file này: cách duy nhất để biết SMTP đã đúng chưa là đi đăng ký một
 * tài khoản thật, và nếu hỏng thì màn hình chỉ nói "Không thể gửi email, vui
 * lòng thử lại sau" — bốn nguyên nhân khác hẳn nhau dùng chung một câu. Ở đây
 * lỗi thật của nodemailer được in nguyên văn kèm cách chữa.
 *
 *   node scripts/test-smtp.mjs                 # gửi cho chính EMAIL_USER
 *   node scripts/test-smtp.mjs ai-do@gmail.com # gửi cho địa chỉ khác
 */
import 'dotenv/config';
import nodemailer from 'nodemailer';

const host = process.env.EMAIL_HOST || 'smtp.gmail.com';
const port = Number(process.env.EMAIL_PORT || 587);
const user = process.env.EMAIL_USER;
const pass = process.env.EMAIL_APP_PASSWORD;
const to = process.argv[2] || user;

console.log(`Máy chủ : ${host}:${port}`);
console.log(`Tài khoản: ${user || '(TRỐNG)'}`);
console.log(`Mật khẩu : ${pass ? `${pass.length} ký tự` : '(TRỐNG)'}`);
console.log(`Gửi tới  : ${to || '(không xác định)'}\n`);

if (!user || !pass) {
  console.error('Thiếu EMAIL_USER hoặc EMAIL_APP_PASSWORD trong file cấu hình.');
  console.error('Chép mẫu rồi điền:  cp .env.sample .env');
  process.exit(1);
}

// Gmail đưa App Password ra dưới dạng "abcd efgh ijkl mnop". Người ta dán
// nguyên cả dấu cách vào là chuyện thường, và Gmail thì từ chối, nên báo trước
// thay vì để mã lỗi 535 tự nói.
if (/\s/.test(pass)) {
  console.warn('CẢNH BÁO: mật khẩu có dấu cách. App Password của Gmail phải xoá hết dấu cách (16 ký tự liền).\n');
}

const transporter = nodemailer.createTransport({
  host,
  port,
  secure: port === 465,
  auth: { user, pass },
});

/** Dịch mã lỗi của SMTP sang việc cần làm. */
function giaiThich(err) {
  const code = err?.code || '';
  const msg = String(err?.message || err);
  if (code === 'EAUTH' || msg.includes('535')) {
    return [
      'Máy chủ từ chối tài khoản/mật khẩu.',
      '  - Gmail KHÔNG nhận mật khẩu đăng nhập thường, phải dùng App Password.',
      '  - App Password chỉ tạo được khi tài khoản đã bật xác thực 2 bước:',
      '    https://myaccount.google.com/apppasswords',
      '  - Dán 16 ký tự liền, không dấu cách.',
    ].join('\n');
  }
  if (code === 'ETIMEDOUT' || code === 'ESOCKET' || code === 'ECONNECTION') {
    return [
      `Không mở được kết nối tới ${host}:${port}.`,
      '  - Mạng công ty/trường học hay chặn cổng 587 và 465.',
      '  - Thử mạng khác (điện thoại phát wifi) để loại trừ.',
      '  - Cổng 465 thì phải chạy SSL: đặt EMAIL_PORT=465.',
    ].join('\n');
  }
  if (code === 'EENVELOPE') {
    return 'Địa chỉ người gửi hoặc người nhận không hợp lệ.';
  }
  return 'Chưa có gợi ý sẵn cho lỗi này, đọc nguyên văn ở trên.';
}

try {
  await transporter.verify();
  console.log('Bắt tay và đăng nhập SMTP: OK');
} catch (err) {
  console.error('Đăng nhập SMTP THẤT BẠI\n');
  console.error(`Lỗi thật: [${err?.code || '?'}] ${err?.message || err}\n`);
  console.error(giaiThich(err));
  process.exit(1);
}

try {
  const info = await transporter.sendMail({
    from: `"Zoldify" <${user}>`,
    to,
    subject: 'Zoldify — thử cấu hình gửi mail',
    html: '<p>Đọc được thư này nghĩa là SMTP đã chạy. Đăng ký và quên mật khẩu gửi được OTP.</p>',
  });
  console.log(`Gửi thư: OK (id ${info.messageId})`);
  console.log(`\nMở hộp thư ${to} để xem. Không thấy thì ngó cả mục Spam.`);
} catch (err) {
  console.error('Gửi thư THẤT BẠI\n');
  console.error(`Lỗi thật: [${err?.code || '?'}] ${err?.message || err}\n`);
  console.error(giaiThich(err));
  process.exit(1);
}
