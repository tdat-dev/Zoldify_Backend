import { BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import sharp from 'sharp';
import { MulterConfigService } from './multer.config';
import { FilesController } from './files.controller';

/**
 * POST /files/upload: ba lỗ chồng lên nhau.
 *
 *   1. Cho tải SVG. SVG là XML chạy được <script>; ảnh được phục vụ lại cho mọi
 *      người xem (R2 công khai, hoặc public/images trên chính domain API khi R2
 *      chưa cấu hình), tức một ảnh sản phẩm là một trang chạy mã của kẻ tải lên.
 *   2. Tin Content-Type và đuôi file do client gửi. Đặt tên "anh.jpg", khai
 *      image/jpeg, nội dung là HTML: lọt qua bộ lọc đuôi, rồi được lưu kèm
 *      ContentType do client khai.
 *   3. memoryStorage với trần 100 MB mỗi file: mười request song song là 1 GB
 *      RAM. Mọi client chỉ tải ảnh (web accept="image/*", app expo-image-picker
 *      mediaTypes images và tự nén về JPEG 1600px, cỡ 150-400 KB).
 */
// Ảnh THẬT, không phải vài byte đầu giả: từ khi upload thu nhỏ ảnh bằng sharp
// (nen-anh.ts), byte giả mang đầu PNG là "ảnh hỏng" và bị từ chối 400.
const PNG_GIA = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
]);
let JPEG: Buffer;
let PNG: Buffer;
let GIF: Buffer;
beforeAll(async () => {
  const mau = (w: number, h: number) =>
    sharp({
      create: { width: w, height: h, channels: 3, background: '#c87832' },
    });
  JPEG = await mau(2400, 1800).jpeg().toBuffer();
  PNG = await mau(800, 600).png().toBuffer();
  GIF = await mau(40, 40).gif().toBuffer();
});
const HTML = Buffer.from(
  '<html><script>alert(document.cookie)</script></html>',
);
const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
);

type TepGia = {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
};
const tep = (
  originalname: string,
  mimetype: string,
  buffer: Buffer,
): TepGia => ({
  originalname,
  mimetype,
  buffer,
  size: buffer.length,
});

function locDuoi(originalname: string): Promise<boolean> {
  const opts = new MulterConfigService().createMulterOptions();
  return new Promise((resolve) => {
    const tepGia = { originalname } as Express.Multer.File;
    // Không có bộ lọc nghĩa là nhận mọi file: coi như lọt (true).
    if (!opts.fileFilter) return resolve(true);
    opts.fileFilter({}, tepGia, (err, ok) => resolve(!err && ok === true));
  });
}

function dungController() {
  // Chữ ký đủ ba tham số để mock.calls có kiểu [buffer, key, contentType].
  const upload = jest.fn((...args: [Buffer, string, string]) =>
    Promise.resolve(`https://img.zoldify.com/${args[1]}`),
  );
  const create = jest.fn((x: unknown) => Promise.resolve(x));
  const controller = new FilesController(
    { create } as never,
    { isEnabled: () => true, upload } as never,
  );
  return { controller, upload, create };
}

const NGUOI = { id: 2 } as never;
const REQ = { headers: { folder_type: 'products' } };

describe('Upload chỉ nhận ảnh thật, nhỏ', () => {
  it('bộ lọc đuôi không nhận .svg', async () => {
    expect(await locDuoi('logo.svg')).toBe(false);
  });

  it('bộ lọc đuôi vẫn nhận .jpg, .png, .webp', async () => {
    expect(await locDuoi('a.jpg')).toBe(true);
    expect(await locDuoi('a.png')).toBe(true);
    expect(await locDuoi('a.webp')).toBe(true);
  });

  // 20 MB, không phải 10: web và admin gửi ảnh gốc từ điện thoại, không nén
  // (chỉ app nén về JPEG 1600px), và ảnh gốc của máy đời mới vượt 10 MB.
  it('trần mỗi file đúng 20 MB, một file mỗi request', () => {
    const opts = new MulterConfigService().createMulterOptions();
    expect(opts.limits?.fileSize).toBe(20 * 1024 * 1024);
    expect(opts.limits?.files).toBe(1);
  });

  // Lỗi thường (new Error) trong fileFilter thành 500 Internal Server Error:
  // người dùng chọn nhầm file PDF nhận "lỗi máy chủ" thay vì "định dạng không
  // hợp lệ". Phải là lỗi HTTP 400.
  it('bộ lọc đuôi từ chối bằng 400, không phải lỗi thường (500)', async () => {
    const opts = new MulterConfigService().createMulterOptions();
    const loi = await new Promise<unknown>((resolve) => {
      if (!opts.fileFilter) return resolve(null);
      opts.fileFilter(
        {},
        { originalname: 'a.pdf' } as Express.Multer.File,
        (err) => resolve(err),
      );
    });
    expect(loi).toBeInstanceOf(BadRequestException);
  });

  it('HTML đội tên .jpg và khai image/jpeg bị từ chối', async () => {
    const { controller, upload, create } = dungController();

    await expect(
      controller.uploadFile(
        tep('anh.jpg', 'image/jpeg', HTML) as never,
        REQ,
        NGUOI,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(upload).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('SVG đội tên .png bị từ chối', async () => {
    const { controller, upload } = dungController();

    await expect(
      controller.uploadFile(
        tep('anh.png', 'image/png', SVG) as never,
        REQ,
        NGUOI,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(upload).not.toHaveBeenCalled();
  });

  it('Content-Type lưu theo nội dung thật, không theo client khai', async () => {
    const { controller, upload, create } = dungController();

    await controller.uploadFile(
      tep('anh.png', 'text/html', PNG) as never,
      REQ,
      NGUOI,
    );

    // Ảnh PNG được nén thành WebP: mime lưu xuống là của file ĐÃ LƯU, không
    // phải text/html client khai, cũng không phải image/png của bản gốc.
    expect(upload).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.stringMatching(/\.webp$/),
      'image/webp',
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ mime_type: 'image/webp' }),
      NGUOI,
    );
  });

  it('ảnh JPEG thật tải lên bình thường', async () => {
    const { controller, upload } = dungController();

    await controller.uploadFile(
      tep('photo-1.jpg', 'image/jpeg', JPEG) as never,
      REQ,
      NGUOI,
    );

    // Hai object: ảnh chính và ảnh nhỏ cùng tên, thêm _480 trước đuôi.
    expect(upload).toHaveBeenCalledTimes(2);
    const [chinh, nho] = upload.mock.calls;
    expect(chinh[1]).toMatch(/^products\/photo-1-\d+\.webp$/);
    expect(chinh[2]).toBe('image/webp');
    expect(nho[1]).toBe(chinh[1].replace(/\.webp$/, '_480.webp'));
    expect(nho[2]).toBe('image/webp');
  });

  it('bảng files lưu URL, cỡ và mime của ảnh CHÍNH đã nén', async () => {
    const { controller, upload, create } = dungController();

    await controller.uploadFile(
      tep('photo-1.jpg', 'image/jpeg', JPEG) as never,
      REQ,
      NGUOI,
    );

    const [buf, key] = upload.mock.calls[0];
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        url: `https://img.zoldify.com/${key}`,
        mime_type: 'image/webp',
        size: buf.length,
        file_name: 'photo-1.jpg',
      }),
      NGUOI,
    );
    expect(buf.length).toBeLessThan(JPEG.length);
  });

  it('đẩy ảnh nhỏ hỏng vẫn tải lên thành công (client lùi về ảnh chính)', async () => {
    const { controller, upload, create } = dungController();
    upload
      .mockImplementationOnce((...args) =>
        Promise.resolve(`https://img.zoldify.com/${args[1]}`),
      )
      .mockImplementationOnce(() => Promise.reject(new Error('R2 503')));

    await controller.uploadFile(
      tep('photo-1.jpg', 'image/jpeg', JPEG) as never,
      REQ,
      NGUOI,
    );

    expect(upload).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenCalledTimes(1);
    expect((create.mock.calls[0][0] as { url: string }).url).toMatch(
      /\d\.webp$/,
    );
  });

  it('byte giả mang đầu PNG bị từ chối 400, không đẩy gì lên', async () => {
    const { controller, upload, create } = dungController();

    await expect(
      controller.uploadFile(
        tep('anh.png', 'image/png', PNG_GIA) as never,
        REQ,
        NGUOI,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(upload).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('GIF lưu nguyên một object, không có ảnh nhỏ', async () => {
    const { controller, upload } = dungController();

    await controller.uploadFile(
      tep('dong.gif', 'image/gif', GIF) as never,
      REQ,
      NGUOI,
    );

    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0][1]).toMatch(/\.gif$/);
    expect(upload.mock.calls[0][2]).toBe('image/gif');
  });

  it('chưa cấu hình R2 thì ghi cả ảnh chính lẫn ảnh nhỏ ra đĩa', async () => {
    const create = jest.fn((x: unknown) => Promise.resolve(x));
    const controller = new FilesController(
      { create } as never,
      { isEnabled: () => false, upload: jest.fn() } as never,
    );
    const mkdir = jest
      .spyOn(fs, 'mkdirSync')
      .mockImplementation(() => undefined);
    const ghi = jest
      .spyOn(fs, 'writeFileSync')
      .mockImplementation(() => undefined);

    try {
      await controller.uploadFile(
        tep('photo-1.jpg', 'image/jpeg', JPEG) as never,
        REQ,
        NGUOI,
      );

      const tenFile = ghi.mock.calls.map((c) => String(c[0]));
      expect(tenFile).toHaveLength(2);
      expect(tenFile[0]).toMatch(/photo-1-\d+\.webp$/);
      expect(tenFile[1]).toBe(tenFile[0].replace(/\.webp$/, '_480.webp'));
      expect(create).toHaveBeenCalledTimes(1);
      expect((create.mock.calls[0][0] as { url: string }).url).toMatch(
        /photo-1-\d+\.webp$/,
      );
    } finally {
      mkdir.mockRestore();
      ghi.mockRestore();
    }
  });
});
