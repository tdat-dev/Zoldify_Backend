import { BadRequestException, Injectable } from '@nestjs/common';
import {
  MulterModuleOptions,
  MulterOptionsFactory,
} from '@nestjs/platform-express';
import { memoryStorage } from 'multer';

@Injectable()
export class MulterConfigService implements MulterOptionsFactory {
  createMulterOptions(): MulterModuleOptions {
    return {
      // Giữ file trong RAM (buffer) rồi controller quyết định đẩy lên R2 hay
      // ghi đĩa. Không dùng diskStorage nữa vì đích lưu giờ là object storage.
      storage: memoryStorage(),
      // Lớp lọc ĐẦU, rẻ, chỉ nhìn đuôi tên: chặn sớm trước khi nạp cả file vào
      // RAM. Lớp quyết định là doanLoaiAnh() ở controller, đọc byte thật.
      //
      // Bỏ svg: SVG là XML chạy được <script>, phục vụ lại cho mọi người xem là
      // một trang chạy mã của kẻ tải lên. Bỏ pdf/doc/docx: không client nào tải
      // lên (web accept="image/*", app chỉ chọn ảnh), giữ lại chỉ là thêm loại
      // file mà không ai kiểm nội dung.
      fileFilter: (req, file, cb) => {
        const allowedFileTypes = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'];
        const fileExtension =
          file.originalname.split('.').pop()?.toLowerCase() || '';
        if (allowedFileTypes.includes(fileExtension)) {
          cb(null, true);
        } else {
          // BadRequestException, không Error thường: Error trong fileFilter đi
          // thẳng ra 500 "Internal server error", tức người chọn nhầm file PDF
          // nhận "lỗi máy chủ" thay vì được bảo chọn ảnh.
          cb(
            new BadRequestException(
              'Định dạng file không hợp lệ. Chỉ nhận ảnh JPG, PNG, WEBP, GIF, BMP.',
            ),
            false,
          );
        }
      },
      // 20 MB, 1 file mỗi request. Bản trước 100 MB x 10 file trên
      // memoryStorage: mười request song song là cỡ 10 GB RAM. App nén ảnh về
      // JPEG 1600px (150-400 KB), nhưng web và admin gửi ẢNH GỐC từ điện thoại
      // không nén, và ảnh gốc của máy đời mới vượt 10 MB (mốc đặt lần trước).
      // Vượt trần thì Nest trả 413 Payload Too Large.
      limits: {
        fileSize: 1024 * 1024 * 20,
        files: 1,
      },
    };
  }
}
