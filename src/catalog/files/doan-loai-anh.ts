/**
 * Đoán loại ảnh từ mấy byte đầu file (magic bytes), KHÔNG từ tên hay
 * Content-Type do client gửi.
 *
 * Vì sao: bộ lọc cũ chỉ nhìn đuôi tên file, rồi lưu kèm `file.mimetype` client
 * tự khai. Đặt tên "anh.jpg", khai image/jpeg, nội dung là HTML hay SVG có
 * <script> là lọt cả hai lớp, và file đó được phục vụ lại cho mọi người xem
 * (R2 công khai, hoặc public/images trên chính domain API khi R2 chưa cấu
 * hình, nơi express.static chọn Content-Type theo ĐUÔI file).
 *
 * Chỉ nhận đúng những định dạng client thật gửi lên: web chọn qua
 * accept="image/*", app dùng expo-image-picker (mediaTypes images) rồi tự nén
 * về JPEG. BMP giữ lại vì bộ lọc cũ nhận và trình duyệt hiển thị an toàn. SVG
 * cố ý KHÔNG có: nó là XML chạy được mã. HEIC/AVIF chưa có vì bộ lọc cũ cũng
 * chưa nhận; thêm thì thêm chữ ký vào đây, đừng nới bộ lọc đuôi.
 */
export type LoaiAnh = { mime: string; ext: string };

const bat = (buf: Buffer, offset: number, bytes: number[]) =>
  buf.length >= offset + bytes.length &&
  bytes.every((b, i) => buf[offset + i] === b);

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

export function doanLoaiAnh(buf: Buffer | undefined): LoaiAnh | null {
  if (!buf || buf.length < 4) return null;
  if (bat(buf, 0, [0xff, 0xd8, 0xff]))
    return { mime: 'image/jpeg', ext: '.jpg' };
  if (bat(buf, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return { mime: 'image/png', ext: '.png' };
  if (bat(buf, 0, ascii('GIF87a')) || bat(buf, 0, ascii('GIF89a')))
    return { mime: 'image/gif', ext: '.gif' };
  if (bat(buf, 0, ascii('RIFF')) && bat(buf, 8, ascii('WEBP')))
    return { mime: 'image/webp', ext: '.webp' };
  if (bat(buf, 0, ascii('BM'))) return { mime: 'image/bmp', ext: '.bmp' };
  return null;
}
