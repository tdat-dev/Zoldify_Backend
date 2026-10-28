import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseInterceptors,
  UseFilters,
  UploadedFile,
  Req,
  UseGuards,
  Query,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { FilesService } from './files.service';
import { StorageService } from './storage.service';
import { urlTepCongKhai } from '@common/public-url';
import * as fs from 'fs';
import { basename, extname, join } from 'path';
import { Public } from '@common/decorators/public.decorator';
import { ResponseMessage } from '@common/decorators/response.decorator';
import { HttpExceptionFilter } from '@core/http-exception.filter';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '@identity/auth/jwt-auth.guard';
import { User } from '@common/decorators/user.decorator';
import type { IUser } from '@identity/users/users.interface';
import { FileEntity } from './entities/file.entity';
import { doanLoaiAnh } from './doan-loai-anh';
import { khoaAnhNho, nenAnh } from './nen-anh';
import { ApiPaginated } from '@common/decorators/api-response.decorator';

@Controller('files')
export class FilesController {
  private readonly logger = new Logger(FilesController.name);

  constructor(
    private readonly filesService: FilesService,
    private readonly storage: StorageService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Post('upload')
  @ResponseMessage('Upload file thành công')
  @UseInterceptors(FileInterceptor('fileUpload'))
  @UseFilters(new HttpExceptionFilter())
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: any,
    @User() user: IUser,
  ) {
    if (!file) {
      throw new BadRequestException(
        'Không nhận được file. Vui lòng chọn lại ảnh.',
      );
    }

    // Loại file quyết định bằng BYTE THẬT, không bằng tên hay Content-Type
    // client khai (xem doan-loai-anh.ts). Đuôi lưu xuống và ContentType gửi R2
    // đều lấy từ đây: file HTML đội tên .jpg bị từ chối, còn ảnh PNG khai sai
    // là text/html thì vẫn được lưu đúng là image/png.
    const loai = doanLoaiAnh(file.buffer);
    if (!loai) {
      throw new BadRequestException(
        'Chỉ nhận ảnh JPEG, PNG, WEBP, GIF hoặc BMP.',
      );
    }

    const folder = String(req?.headers?.folder_type ?? 'default').replace(
      /[^a-zA-Z0-9_-]/g,
      '',
    );
    // Tên file an toàn cho key/URL: bỏ khoảng trắng và ký tự đặc biệt, kèm
    // timestamp để không đè nhau. Tên gốc vẫn lưu ở file_name để hiển thị.
    const ext = extname(file.originalname);
    const safeBase = basename(file.originalname, ext)
      .normalize('NFKD')
      .replace(/[^a-zA-Z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 80);
    // Nén TRƯỚC khi đặt tên: đuôi lưu xuống là của file đã nén (.webp), không
    // phải của file gốc. Ảnh hỏng ném 400 ở đây, trước khi đẩy gì lên R2.
    // Lý do và số đo: xem nen-anh.ts.
    const anh = await nenAnh(file.buffer, loai);
    const filename = `${safeBase || 'file'}-${Date.now()}${anh.chinh.ext}`;
    const key = `${folder}/${filename}`;

    let url: string;
    if (this.storage.isEnabled()) {
      url = await this.storage.upload(anh.chinh.buffer, key, anh.chinh.mime);
      if (anh.nho) {
        const nho = anh.nho;
        await this.ghiAnhNho(khoaAnhNho(key), () =>
          this.storage.upload(nho.buffer, khoaAnhNho(key), nho.mime),
        );
      }
    } else {
      // Fallback đĩa (giữ hành vi cũ khi R2 chưa cấu hình): ghi buffer ra
      // public/images rồi ghép URL.
      //
      // ĐỊA CHỈ LẤY TỪ CẤU HÌNH, KHÔNG LẤY TỪ REQUEST.
      //
      // Bản cũ ghép `${req.protocol}://${req.get('host')}/...`. `Host` là header
      // do NGƯỜI GỬI đặt, mà URL này được **lưu vào bảng `files`** rồi phục vụ
      // cho mọi người xem sau đó. Một lần tải ảnh kèm `Host: evil.example` là
      // ghi vào database một địa chỉ trỏ sang máy chủ người khác — người bán
      // tải ảnh sản phẩm, người mua nhìn thấy ảnh lấy từ `evil`.
      //
      // Đứng sau proxy còn một mặt nữa: `Host` khi đó là tên nội bộ của
      // container, nên URL lưu xuống không ai ngoài mạng nội bộ mở được.
      //
      // Task #13 trong `docs/BAN-GIAO.md`. Xem `common/public-url.ts`.
      const dir = join(process.cwd(), 'public', 'images', folder);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(join(dir, filename), anh.chinh.buffer);
      if (anh.nho) {
        const nho = anh.nho;
        await this.ghiAnhNho(khoaAnhNho(filename), () =>
          fs.writeFileSync(join(dir, khoaAnhNho(filename)), nho.buffer),
        );
      }
      url = urlTepCongKhai(process.env, folder, filename);
    }

    // url, mime_type, size là của ảnh CHÍNH đã lưu, không phải file gốc:
    // ai đọc bảng files để biết ảnh nặng bao nhiêu phải thấy đúng số đang phục
    // vụ. Ảnh nhỏ không có dòng riêng, tên của nó suy ra từ url (khoaAnhNho).
    const saved = await this.filesService.create(
      {
        file_name: file.originalname,
        url,
        mime_type: anh.chinh.mime,
        size: anh.chinh.buffer.length,
        folder,
      },
      user,
    );

    return saved;
  }

  /**
   * Ảnh nhỏ là đồ thêm: hỏng thì chỉ cảnh báo, lượt tải vẫn thành công.
   * Client thấy ảnh nhỏ 404 thì lùi về ảnh chính (vẫn đã nén còn 1600px),
   * và `npm run anh:bu-thumb` bù lại được sau. Ném lỗi ở đây thì ảnh chính đã
   * nằm trên R2 nhưng không có dòng nào trong bảng files trỏ tới.
   */
  private async ghiAnhNho(ten: string, ghi: () => unknown): Promise<void> {
    try {
      await ghi();
    } catch (e) {
      this.logger.warn(
        `Không lưu được ảnh nhỏ ${ten}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  @UseGuards(JwtAuthGuard)
  @ApiPaginated(FileEntity)
  @Get()
  @ResponseMessage('Lấy danh sách file thành công')
  findAll(
    @Query('page') page: string,
    @Query('limit') limit: string,
    @Query('folder') folder: string,
    @User() user: IUser,
  ) {
    // Chủ file hoặc admin: kiểm trong FilesService.
    return this.filesService.findAll(+page || 1, +limit || 20, folder, user);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  @ResponseMessage('Lấy chi tiết file thành công')
  findOne(@Param('id') id: string, @User() user: IUser) {
    return this.filesService.findOne(+id, user);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @ResponseMessage('Xóa file thành công')
  remove(@Param('id') id: string, @User() user: IUser) {
    return this.filesService.remove(+id, user);
  }
}
