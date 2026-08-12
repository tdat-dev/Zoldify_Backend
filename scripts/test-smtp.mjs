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

// Nhầm phổ biến nhất, và mã lỗi của Gmail KHÔNG nói ra: đưa cho smtp.gmail.com
// một địa chỉ thuộc tên miền riêng. Gmail trả về đúng câu 535 BadCredentials như
// khi sai mật khẩu, nên người ta đi tạo lại App Password vài lần trong khi vấn
// đề nằm ở tên tài khoản.
//
// smtp.gmail.com chỉ đăng nhập được bằng tài khoản Google THẬT: @gmail.com,
// hoặc tên miền riêng ĐÃ mua Google Workspace. Tên miền dùng dịch vụ chuyển
// tiếp thư (Cloudflare Email Routing, ImprovMX...) thì địa chỉ đó không phải
// hộp thư, chỉ là một quy tắc forward — không có mật khẩu để mà đăng nhập.
const laGmail = /(^|\.)gmail\.com$/i.test(host) || /(^|\.)googlemail\.com$/i.test(host);
if (laGmail && !/@(gmail|googlemail)\.com$/i.test(user)) {
  const mien = user.split('@')[1] || '(không rõ)';
  console.warn('CẢNH BÁO: đang đăng nhập smtp.gmail.com bằng địa chỉ không thuộc Gmail.');
  console.warn(`  Chỉ chạy được nếu "${mien}" đã mua Google Workspace VÀ ${user} là một hộp thư thật ở đó.`);
  console.warn(`  Kiểm tra nhanh:  nslookup -type=mx ${mien}`);
  console.warn('  Thấy aspmx.l.google.com  -> Workspace, đi tiếp được.');
  console.warn('  Thấy mx.cloudflare.net, improvmx, forwardemail... -> chỉ NHẬN thư, không gửi được.');
  console.warn('  Đường vòng nhanh nhất: điền EMAIL_USER bằng chính Gmail đã sinh ra App Password.\n');
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
    const dong = ['Máy chủ từ chối tài khoản/mật khẩu.'];
    // Thứ tự này quan trọng: sai TÊN TÀI KHOẢN và sai MẬT KHẨU cho ra cùng một
    // mã 535. Nói về mật khẩu trước là đẩy người dùng đi tạo lại App Password
    // hết lần này tới lần khác trong khi lỗi nằm chỗ khác.
    if (laGmail && !/@(gmail|googlemail)\.com$/i.test(user)) {
      dong.push(
        `  - NGHI TRƯỚC HẾT: "${user}" không phải tài khoản Google.`,
        '    Google trả về đúng câu 535 này cho cả tên tài khoản lạ lẫn sai mật khẩu.',
        '    Thử lại bằng chính địa chỉ @gmail.com đã sinh ra App Password.',
      );
    }
    dong.push(
      '  - Gmail KHÔNG nhận mật khẩu đăng nhập thường, phải dùng App Password.',
      '  - App Password chỉ tạo được khi tài khoản đã bật xác thực 2 bước:',
      '    https://myaccount.google.com/apppasswords',
      '  - App Password gắn với ĐÚNG tài khoản sinh ra nó, dán sang tên khác là hỏng.',
      '  - Dán 16 ký tự liền, không dấu cách.',
    );
    return dong.join('\n');
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
