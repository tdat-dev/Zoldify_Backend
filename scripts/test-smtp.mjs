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
// Đăng nhập bằng tài khoản này, nhưng người nhận thấy địa chỉ kia. Xem
// src/common/mailer.config.ts để biết vì sao hai thứ tách rời nhau.
const from = process.env.EMAIL_FROM || user;
const to = process.argv[2] || user;

console.log(`Máy chủ  : ${host}:${port}`);
console.log(`Đăng nhập: ${user || '(TRỐNG)'}`);
console.log(`Mật khẩu : ${pass ? `${pass.length} ký tự` : '(TRỐNG)'}`);
console.log(`Người gửi: ${from || '(TRỐNG)'}${from !== user ? '  <- bí danh' : ''}`);
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
const isGmailHost = /(^|\.)gmail\.com$/i.test(host) || /(^|\.)googlemail\.com$/i.test(host);
if (isGmailHost && !/@(gmail|googlemail)\.com$/i.test(user)) {
  const domain = user.split('@')[1] || '(không rõ)';
  console.warn('CẢNH BÁO: đang đăng nhập smtp.gmail.com bằng địa chỉ không thuộc Gmail.');
  console.warn(`  Chỉ chạy được nếu "${domain}" đã mua Google Workspace VÀ ${user} là một hộp thư thật ở đó.`);
  console.warn(`  Kiểm tra nhanh:  nslookup -type=mx ${domain}`);
  console.warn('  Thấy aspmx.l.google.com  -> Workspace, đi tiếp được.');
  console.warn('  Thấy mx.cloudflare.net, improvmx, forwardemail... -> chỉ NHẬN thư, không gửi được.');
  console.warn('  Muốn giữ địa chỉ này làm người gửi: để nó ở EMAIL_FROM, còn EMAIL_USER điền Gmail thật.\n');
}

/**
 * Gửi bằng bí danh thì tên miền của bí danh PHẢI cho phép Google gửi thay.
 *
 * Đây là loại hỏng tệ nhất vì nó KHÔNG báo lỗi: SMTP nhận thư, script in "OK",
 * mà thư thì rơi thẳng vào spam của người nhận, hoặc bị chèn dòng "via
 * gmail.com". Không ai biết cho tới khi người dùng thật kêu không nhận được mã.
 * Nên tự tra bản ghi SPF luôn thay vì để người ta phát hiện sau.
 */
async function checkSpf(address) {
  const domain = address.split('@')[1];
  if (!domain || /^(gmail|googlemail)\.com$/i.test(domain)) return;

  let spf = '';
  try {
    const { promises: dns } = await import('node:dns');
    const records = await dns.resolveTxt(domain);
    spf = records.map((p) => p.join('')).find((d) => d.toLowerCase().startsWith('v=spf1')) || '';
  } catch {
    // Không tra được DNS (mạng, hoặc tên miền chưa trỏ) thì im lặng bỏ qua —
    // đây là kiểm tra thêm, không phải điều kiện để chạy tiếp.
    return;
  }

  if (!spf) {
    console.warn(`CẢNH BÁO: "${domain}" chưa có bản ghi SPF nào. Thư gửi bằng ${address} dễ vào spam.\n`);
    return;
  }
  if (isGmailHost && !/_spf\.google\.com/i.test(spf)) {
    console.warn(`CẢNH BÁO: SPF của "${domain}" không cho phép Google gửi thay.`);
    console.warn(`  Đang là : ${spf}`);
    console.warn(`  Cần là  : ${spf.replace(/\s*[~-]all\s*$/i, '')} include:_spf.google.com ~all`);
    console.warn('  Sửa ở bản ghi TXT của tên miền. Thiếu nó thì thư VẪN GỬI ĐI ĐƯỢC');
    console.warn('  (script này báo OK) nhưng người nhận thấy nó trong spam.\n');
  }
}

await checkSpf(from);

const transporter = nodemailer.createTransport({
  host,
  port,
  secure: port === 465,
  auth: { user, pass },
});

/** Dịch mã lỗi của SMTP sang việc cần làm. */
function explain(err) {
  const code = err?.code || '';
  const msg = String(err?.message || err);
  if (code === 'EAUTH' || msg.includes('535')) {
    const lines = ['Máy chủ từ chối tài khoản/mật khẩu.'];
    // Thứ tự này quan trọng: sai TÊN TÀI KHOẢN và sai MẬT KHẨU cho ra cùng một
    // mã 535. Nói về mật khẩu trước là đẩy người dùng đi tạo lại App Password
    // hết lần này tới lần khác trong khi lỗi nằm chỗ khác.
    if (isGmailHost && !/@(gmail|googlemail)\.com$/i.test(user)) {
      lines.push(
        `  - NGHI TRƯỚC HẾT: "${user}" không phải tài khoản Google.`,
        '    Google trả về đúng câu 535 này cho cả tên tài khoản lạ lẫn sai mật khẩu.',
        '    Thử lại bằng chính địa chỉ @gmail.com đã sinh ra App Password.',
      );
    }
    lines.push(
      '  - Gmail KHÔNG nhận mật khẩu đăng nhập thường, phải dùng App Password.',
      '  - App Password chỉ tạo được khi tài khoản đã bật xác thực 2 bước:',
      '    https://myaccount.google.com/apppasswords',
      '  - App Password gắn với ĐÚNG tài khoản sinh ra nó, dán sang tên khác là hỏng.',
      '  - Dán 16 ký tự liền, không dấu cách.',
    );
    return lines.join('\n');
  }
  if (code === 'ETIMEDOUT' || code === 'ESOCKET' || code === 'ECONNECTION') {
    return [
      `Không mở được kết nối tới ${host}:${port}.`,
      '  - Mạng công ty/trường học hay chặn cổng 587 và 465.',
      '  - Thử mạng khác (điện thoại phát wifi) để loại trừ.',
      '  - Cổng 465 thì phải chạy SSL: đặt EMAIL_PORT=465.',
    ].join('\n');
  }
  if (code === 'EENVELOPE' || msg.includes('550-5.7.1') || /not allowed|Invalid sender/i.test(msg)) {
    const lines = ['Địa chỉ người gửi hoặc người nhận bị từ chối.'];
    if (from !== user) {
      lines.push(
        `  - Đang gửi bằng bí danh ${from} trong khi đăng nhập là ${user}.`,
        '  - Gmail chỉ nhận bí danh ĐÃ XÁC MINH trên chính tài khoản đó:',
        '    Gmail > Cài đặt > Tài khoản > "Gửi thư bằng địa chỉ".',
        '    Bí danh phải ở trạng thái đã xác minh, không phải đang chờ.',
        '  - Chưa xác minh xong thì bỏ EMAIL_FROM đi, gửi tạm bằng EMAIL_USER.',
      );
    }
    return lines.join('\n');
  }
  return 'Chưa có gợi ý sẵn cho lỗi này, đọc nguyên văn ở trên.';
}

try {
  await transporter.verify();
  console.log('Bắt tay và đăng nhập SMTP: OK');
} catch (err) {
  console.error('Đăng nhập SMTP THẤT BẠI\n');
  console.error(`Lỗi thật: [${err?.code || '?'}] ${err?.message || err}\n`);
  console.error(explain(err));
  process.exit(1);
}

try {
  const info = await transporter.sendMail({
    // Dựng y hệt cách src/common/mailer.config.ts dựng, để cái được thử ở đây
    // đúng là cái chạy thật. Thử một đằng chạy một nẻo thì phép thử vô nghĩa.
    from: `"Zoldify" <${from}>`,
    to,
    subject: 'Zoldify — thử cấu hình gửi mail',
    html: '<p>Đọc được thư này nghĩa là SMTP đã chạy. Đăng ký và quên mật khẩu gửi được OTP.</p>',
  });
  console.log(`Gửi thư: OK (id ${info.messageId})`);
  console.log(`\nMở hộp thư ${to} để xem. Không thấy thì ngó cả mục Spam.`);
  if (from !== user) {
    console.log(`Kiểm luôn dòng người gửi có đúng "${from}" không, và có bị chèn "via gmail.com" không.`);
  }
} catch (err) {
  console.error('Gửi thư THẤT BẠI\n');
  console.error(`Lỗi thật: [${err?.code || '?'}] ${err?.message || err}\n`);
  console.error(explain(err));
  process.exit(1);
}
