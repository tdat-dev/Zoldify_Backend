import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';
import type { LoaiAnh } from './doan-loai-anh';

/**
 * Thu nhỏ ảnh tải lên thành WebP: một ảnh chính 1600px và một ảnh nhỏ 480px.
 *
 * VÌ SAO: đo 28/10 trên prod, ảnh sản phẩm là PNG gốc 1,1 đến 1,6 MB mỗi tấm
 * (default/img_14-1787811935442.png = 1.082.533 byte) mà app chỉ hiện cỡ
 * 400px. Trang chủ tải cỡ 20 MB ảnh; mạng di động chậm mất ~80 giây và nhiều
 * ảnh hỏng giữa chừng. Cloudflare Image Resizing không bật (cdn-cgi/image trả
 * 404), nên tự nén lúc tải lên, một lần, thay vì mỗi lượt xem.
 *
 * Đo trên ảnh sản phẩm thật sinh bằng AI (cùng loại ảnh đang ở prod):
 *   sell-flatlay.png 1536x1024 2.789.279 byte -> chính 156.350, nhỏ 13.174
 *   auth-flatlay.png  853x1844 2.586.483 byte -> chính 113.436, nhỏ  7.696
 *   empty-box.png    1254x1254   835.303 byte -> chính  31.972, nhỏ  8.396
 * tức ảnh nhỏ nhẹ hơn ảnh gốc 100 đến 300 lần, mất 0,4 đến 0,6 giây mỗi ảnh.
 *
 * Quy ước tên ảnh nhỏ nằm ở khoaAnhNho(): client đoán URL ảnh nhỏ từ URL ảnh
 * chính, nên đổi quy ước là vỡ client. Bảng files chỉ lưu URL ảnh CHÍNH.
 */

// Container API có 512 MB, heap Node 384 MB; bộ nhớ của libvips nằm NGOÀI
// heap nhưng vẫn trong 512 MB đó.
//
// cache(false): mặc định sharp giữ tới 50 MB thao tác đã giải mã để dùng lại.
// Ảnh tải lên không bao giờ được xử lý lại lần hai, nên cache chỉ là RAM giữ
// hộ không ai dùng.
//
// concurrency(1): mặc định libvips mở một luồng mỗi lõi CPU cho MỖI ảnh. API
// không phải máy xử lý ảnh; một luồng đủ nhanh (đo bên trên) và chừa CPU cho
// request khác.
sharp.cache(false);
sharp.concurrency(1);

// Chặn bom giải nén: một PNG vài trăm KB có thể khai 50.000 x 50.000 điểm ảnh,
// giải mã ra 10 GB. 40 triệu điểm ảnh rộng hơn ảnh gốc của điện thoại đời mới
// (48 MP chụp ra file 12 MP mặc định), và đo trên máy dev: PNG 8000x5000 (đúng
// 40 MP) tốn thêm 53 MB RSS, 3,8 giây cho cả hai bản.
export const TRAN_DIEM_ANH = 40_000_000;
export const CANH_ANH_CHINH = 1600;
export const CANH_ANH_NHO = 480;

export type BienTheAnh = { buffer: Buffer; mime: string; ext: string };
export type AnhDaNen = { chinh: BienTheAnh; nho: BienTheAnh | null };

const WEBP = { mime: 'image/webp', ext: '.webp' };

// Xử lý LẦN LƯỢT từng ảnh trong một tiến trình.
//
// sharp chạy trên threadpool của libuv (4 luồng mặc định), nên bốn lượt tải
// cùng lúc là bốn ảnh giải mã cùng lúc. Đo trên máy dev: JPEG 12 MP tốn thêm
// 25 MB RSS, PNG 40 MP thêm 53 MB; bốn cái song song cộng với heap 384 MB là
// sát trần 512 MB của container. Xếp hàng chỉ làm lượt tải thứ hai chờ thêm
// cỡ nửa giây, rẻ hơn nhiều so với container bị OOM giết.
let hang: Promise<unknown> = Promise.resolve();
function lanLuot<T>(viec: () => Promise<T>): Promise<T> {
  const ketQua = hang.then(viec, viec);
  hang = ketQua.catch(() => undefined);
  return ketQua;
}

function thuNho(buf: Buffer, canh: number, quality: number): Promise<Buffer> {
  return (
    sharp(buf, { limitInputPixels: TRAN_DIEM_ANH })
      // Xoay theo cờ EXIF TRƯỚC khi bỏ metadata: điện thoại lưu ảnh dọc thành
      // điểm ảnh ngang kèm cờ "xoay 90 độ", WebP xuất ra không mang cờ đó.
      // Bỏ EXIF cũng là bỏ luôn toạ độ GPS người bán vô tình đính kèm.
      .rotate()
      .resize(canh, canh, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality })
      .toBuffer()
  );
}

function loiDocAnh(e: unknown): BadRequestException {
  const msg = e instanceof Error ? e.message : '';
  if (/pixel limit/i.test(msg)) {
    return new BadRequestException(
      'Ảnh quá lớn (trên 40 triệu điểm ảnh). Vui lòng chọn ảnh nhỏ hơn.',
    );
  }
  // Ảnh hỏng là lỗi của file, không phải của máy chủ: 400, không 500.
  return new BadRequestException(
    'Ảnh bị hỏng hoặc không đọc được. Vui lòng chọn ảnh khác.',
  );
}

/**
 * Trả về các bản cần lưu cho một ảnh đã qua doanLoaiAnh().
 *
 * Lưu NGUYÊN BẢN, không ảnh nhỏ (giữ hành vi cũ) cho:
 *   - GIF: thường là ảnh động; sharp mặc định chỉ đọc khung đầu.
 *   - WebP động: cùng lý do.
 *   - BMP: libvips đóng gói trong sharp 0.34.5 không có bộ đọc BMP ("Input
 *     buffer contains unsupported image format"). Từ chối thì chặn oan thứ bộ
 *     lọc cũ vẫn nhận. Client gặp ảnh nhỏ 404 thì lùi về ảnh chính.
 */
export async function nenAnh(buf: Buffer, loai: LoaiAnh): Promise<AnhDaNen> {
  const nguyenBan: AnhDaNen = {
    chinh: { buffer: buf, mime: loai.mime, ext: loai.ext },
    nho: null,
  };
  if (loai.mime === 'image/gif') return nguyenBan;

  return lanLuot(async () => {
    let soKhung: number;
    try {
      const meta = await sharp(buf, {
        limitInputPixels: TRAN_DIEM_ANH,
      }).metadata();
      soKhung = meta.pages ?? 1;
    } catch (e) {
      if (loai.mime === 'image/bmp') return nguyenBan;
      throw loiDocAnh(e);
    }
    if (soKhung > 1) return nguyenBan;

    try {
      // Hai lượt nối tiếp, không Promise.all: chạy song song là hai bản giải
      // mã cùng nằm trong RAM, đúng thứ lanLuot() đang tránh.
      const chinh = await thuNho(buf, CANH_ANH_CHINH, 80);
      const nho = await thuNho(buf, CANH_ANH_NHO, 75);
      return {
        chinh: { buffer: chinh, ...WEBP },
        nho: { buffer: nho, ...WEBP },
      };
    } catch (e) {
      throw loiDocAnh(e);
    }
  });
}

/** Chỉ tạo ảnh nhỏ 480px, cho script bù ảnh nhỏ của ảnh cũ. */
export function taoAnhNho(buf: Buffer): Promise<Buffer> {
  return lanLuot(() => thuNho(buf, CANH_ANH_NHO, 75)).catch((e: unknown) => {
    throw loiDocAnh(e);
  });
}

/**
 * Khoá (hoặc URL) của ảnh nhỏ: bỏ đuôi của đoạn cuối, thêm `_480.webp`.
 *
 *   products/ao-1787811935442.webp -> products/ao-1787811935442_480.webp
 *   https://img.zoldify.com/default/img_14-1787811935442.png
 *     -> https://img.zoldify.com/default/img_14-1787811935442_480.webp
 *
 * Chỉ nhìn đoạn sau dấu `/` cuối, để dấu chấm trong domain không bị coi là
 * đuôi. Ảnh chính luôn kết thúc bằng `-<timestamp>.<đuôi>` (xem
 * files.controller), nên không ảnh chính nào tự kết thúc bằng `_480.webp`.
 */
export function khoaAnhNho(keyOrUrl: string): string {
  const gach = keyOrUrl.lastIndexOf('/');
  const cham = keyOrUrl.lastIndexOf('.');
  const goc = cham > gach + 1 ? keyOrUrl.slice(0, cham) : keyOrUrl;
  return `${goc}_480.webp`;
}

/**
 * Lọc danh sách khoá trong bucket ra những ảnh cũ cần bù ảnh nhỏ: PNG, JPEG,
 * WebP chưa có ảnh nhỏ, không phải chính ảnh nhỏ. GIF và BMP bỏ qua vì lúc
 * tải lên chúng cũng không có ảnh nhỏ.
 *
 * Kiểm "đã có" trên chính danh sách vừa liệt kê, không HEAD từng khoá: bucket
 * vài nghìn ảnh là vài nghìn request thừa.
 */
export function chonKhoaCanBuAnhNho(keys: Iterable<string>): string[] {
  const tatCa = new Set(keys);
  return [...tatCa].filter(
    (k) =>
      /\.(png|jpe?g|webp)$/i.test(k) &&
      !k.endsWith('_480.webp') &&
      !tatCa.has(khoaAnhNho(k)),
  );
}
