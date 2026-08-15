import { Injectable } from '@nestjs/common';
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
      fileFilter: (req, file, cb) => {
        const allowedFileTypes = [
          'jpg',
          'jpeg',
          'png',
          'gif',
          'webp',
          'svg',
          'bmp',
          'pdf',
          'doc',
          'docx',
        ];
        const fileExtension =
          file.originalname.split('.').pop()?.toLowerCase() || '';
        if (allowedFileTypes.includes(fileExtension)) {
          cb(null, true);
        } else {
          cb(new Error('Định dạng file không hợp lệ'), false);
        }
      },
      limits: {
        fileSize: 1024 * 1024 * 100, // 100MB
        files: 10,
      },
    };
  }
}
