import { BadRequestException } from '@nestjs/common';
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
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
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
  const upload = jest.fn(() => Promise.resolve('https://img/x'));
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

    expect(upload).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.stringMatching(/\.png$/),
      'image/png',
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ mime_type: 'image/png' }),
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

    expect(upload).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.stringMatching(/^products\/photo-1-\d+\.jpg$/),
      'image/jpeg',
    );
  });
});
