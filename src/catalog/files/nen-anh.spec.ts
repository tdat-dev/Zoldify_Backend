import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';
import { chonKhoaCanBuAnhNho, khoaAnhNho, nenAnh, taoAnhNho } from './nen-anh';

/**
 * Ảnh sản phẩm lưu NGUYÊN BẢN, app chỉ hiện cỡ 400px.
 *
 * Đo 28/10 trên prod: ảnh là PNG gốc 1,1 đến 1,6 MB mỗi tấm (vd
 * default/img_14-1787811935442.png = 1.082.533 byte). Trang chủ app tải cỡ
 * 20 MB ảnh; mạng di động chậm mất ~80 giây và nhiều ảnh hỏng giữa chừng.
 * Cloudflare Image Resizing KHÔNG bật (cdn-cgi/image trả 404), nên phải tự
 * thu nhỏ lúc tải lên.
 *
 * Pre-mortem (viết trước khi có dòng mã nào):
 *
 * | Rủi ro                                            | Chặn bằng                                   |
 * |---------------------------------------------------|---------------------------------------------|
 * | Ảnh 40+ MP (hoặc bom giải nén) ăn hết 512 MB RAM  | limitInputPixels + xử lý lần lượt từng ảnh  |
 * | Ảnh chụp dọc bị nằm ngang sau khi bỏ EXIF          | .rotate() trước resize                      |
 * | Ảnh nhỏ bị phóng to, mờ đi và nặng hơn             | withoutEnlargement                          |
 * | GIF động / WebP động mất chuyển động              | để nguyên bản, không tạo ảnh nhỏ            |
 * | Ảnh hỏng làm 500 thay vì báo người dùng           | BadRequestException tiếng Việt              |
 * | BMP libvips không đọc được, chặn oan              | BMP đọc không được thì lưu nguyên như cũ    |
 * | Client và script đoán tên ảnh nhỏ lệch nhau        | một hàm khoaAnhNho dùng chung               |
 * | Lỗi đẩy ảnh nhỏ làm hỏng cả lượt tải              | chỉ cảnh báo, client lùi về ảnh chính       |
 * | Script bù ảnh nhỏ ghi đè / chạy nhầm ghi thật     | bỏ qua khoá đã có ảnh nhỏ, mặc định dry run |
 */

const laWebp = (b: Buffer) =>
  b.subarray(0, 4).toString('ascii') === 'RIFF' &&
  b.subarray(8, 12).toString('ascii') === 'WEBP';

const canhDaiNhat = async (b: Buffer) => {
  const m = await sharp(b).metadata();
  return Math.max(m.width ?? 0, m.height ?? 0);
};

const anhMau = (width: number, height: number) =>
  sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 200, g: 120, b: 60 },
    },
  });

const PNG = { mime: 'image/png', ext: '.png' };
const JPEG = { mime: 'image/jpeg', ext: '.jpg' };
const GIF = { mime: 'image/gif', ext: '.gif' };

describe('nenAnh: ảnh tải lên được thu nhỏ về WebP', () => {
  it('PNG 3000x2000 ra ảnh chính WebP cạnh dài <= 1600 và ảnh nhỏ <= 480', async () => {
    const goc = await anhMau(3000, 2000).png().toBuffer();

    const kq = await nenAnh(goc, PNG);

    expect(kq.chinh.mime).toBe('image/webp');
    expect(kq.chinh.ext).toBe('.webp');
    expect(laWebp(kq.chinh.buffer)).toBe(true);
    expect(await canhDaiNhat(kq.chinh.buffer)).toBe(1600);

    expect(kq.nho).not.toBeNull();
    expect(kq.nho!.mime).toBe('image/webp');
    expect(laWebp(kq.nho!.buffer)).toBe(true);
    expect(await canhDaiNhat(kq.nho!.buffer)).toBe(480);
  });

  it('ảnh nhỏ hơn khung không bị phóng to', async () => {
    const goc = await anhMau(300, 200).png().toBuffer();

    const kq = await nenAnh(goc, PNG);

    const m = await sharp(kq.chinh.buffer).metadata();
    expect([m.width, m.height]).toEqual([300, 200]);
    const n = await sharp(kq.nho!.buffer).metadata();
    expect([n.width, n.height]).toEqual([300, 200]);
  });

  it('JPEG có EXIF orientation 6 được xoay đúng chiều', async () => {
    // Điện thoại lưu ảnh dọc thành điểm ảnh NGANG kèm cờ "xoay 90 độ". WebP
    // xuất ra không mang EXIF, nên không xoay thật thì ảnh nằm ngang.
    const goc = await anhMau(400, 100)
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();

    const kq = await nenAnh(goc, JPEG);

    const m = await sharp(kq.chinh.buffer).metadata();
    expect([m.width, m.height]).toEqual([100, 400]);
  });

  it('GIF giữ nguyên bản, không có ảnh nhỏ', async () => {
    const goc = await anhMau(50, 50).gif().toBuffer();

    const kq = await nenAnh(goc, GIF);

    expect(kq.chinh.buffer.equals(goc)).toBe(true);
    expect(kq.chinh.mime).toBe('image/gif');
    expect(kq.chinh.ext).toBe('.gif');
    expect(kq.nho).toBeNull();
  });

  it('byte rác mang đầu JPEG bị từ chối bằng 400', async () => {
    const rac = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      Buffer.from('day khong phai la anh'),
    ]);

    await expect(nenAnh(rac, JPEG)).rejects.toThrow(BadRequestException);
  });

  it('WebP động giữ nguyên bản, không có ảnh nhỏ', async () => {
    // sharp mặc định chỉ đọc khung đầu: nén lại là mất chuyển động.
    const khung = (r: number) =>
      anhMau(20, 20).tint({ r, g: 0, b: 0 }).png().toBuffer();
    const goc = await sharp([await khung(255), await khung(10)], {
      join: { animated: true },
    })
      .webp()
      .toBuffer();
    expect((await sharp(goc).metadata()).pages).toBe(2);

    const kq = await nenAnh(goc, { mime: 'image/webp', ext: '.webp' });

    expect(kq.chinh.buffer.equals(goc)).toBe(true);
    expect(kq.nho).toBeNull();
  });

  it('BMP (libvips trong sharp không đọc được) lưu nguyên như cũ', async () => {
    // BMP 2x2 24-bit tự dựng: header 54 byte + 16 byte điểm ảnh.
    const bmp = Buffer.alloc(70);
    bmp.write('BM');
    bmp.writeUInt32LE(70, 2);
    bmp.writeUInt32LE(54, 10);
    bmp.writeUInt32LE(40, 14);
    bmp.writeInt32LE(2, 18);
    bmp.writeInt32LE(2, 22);
    bmp.writeUInt16LE(1, 26);
    bmp.writeUInt16LE(24, 28);
    bmp.writeUInt32LE(16, 34);

    const kq = await nenAnh(bmp, { mime: 'image/bmp', ext: '.bmp' });

    expect(kq.chinh.buffer.equals(bmp)).toBe(true);
    expect(kq.chinh.mime).toBe('image/bmp');
    expect(kq.nho).toBeNull();
  });

  it('ảnh vượt 40 triệu điểm ảnh bị từ chối bằng 400', async () => {
    const lon = await anhMau(7000, 7000).jpeg().toBuffer();

    await expect(nenAnh(lon, JPEG)).rejects.toThrow(BadRequestException);
  });

  it('taoAnhNho từ chối byte rác bằng 400', async () => {
    await expect(taoAnhNho(Buffer.from('rac'))).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('khoaAnhNho: quy ước tên ảnh nhỏ client dựa vào', () => {
  it('khoá R2', () => {
    expect(khoaAnhNho('products/ao-1787811935442.webp')).toBe(
      'products/ao-1787811935442_480.webp',
    );
  });

  it('URL đầy đủ của ảnh PNG cũ', () => {
    expect(
      khoaAnhNho('https://img.zoldify.com/default/img_14-1787811935442.png'),
    ).toBe('https://img.zoldify.com/default/img_14-1787811935442_480.webp');
  });

  it('chỉ bỏ đuôi của đoạn cuối, không đụng dấu chấm trong domain', () => {
    expect(khoaAnhNho('https://img.zoldify.com/default/khong-duoi')).toBe(
      'https://img.zoldify.com/default/khong-duoi_480.webp',
    );
  });
});

describe('chonKhoaCanBuAnhNho: script bù ảnh nhỏ cho ảnh cũ', () => {
  it('chỉ chọn ảnh chưa có ảnh nhỏ, bỏ GIF/BMP và chính ảnh nhỏ', () => {
    const keys = [
      'default/a-1.png',
      'default/b-2.jpg',
      'default/c-3.JPEG',
      'default/d-4.webp',
      'default/d-4_480.webp',
      'default/e-5.png',
      'default/e-5_480.webp',
      'default/f-6.gif',
      'default/g-7.bmp',
    ];

    expect(chonKhoaCanBuAnhNho(keys)).toEqual([
      'default/a-1.png',
      'default/b-2.jpg',
      'default/c-3.JPEG',
    ]);
  });
});
