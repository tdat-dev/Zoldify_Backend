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
import { ApiPaginated } from '@common/decorators/api-response.decorator';

@Controller('files')
export class FilesController {
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
    const filename = `${safeBase || 'file'}-${Date.now()}${ext.toLowerCase()}`;
    const key = `${folder}/${filename}`;

    let url: string;
    if (this.storage.isEnabled()) {
      url = await this.storage.upload(file.buffer, key, file.mimetype);
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
      fs.writeFileSync(join(dir, filename), file.buffer);
      url = urlTepCongKhai(process.env, folder, filename);
    }

    const saved = await this.filesService.create(
      {
        file_name: file.originalname,
        url,
        mime_type: file.mimetype,
        size: file.size,
        folder,
      },
      user,
    );

    return saved;
  }

  @UseGuards(JwtAuthGuard)
  @ApiPaginated(FileEntity)
  @Get()
  @ResponseMessage('Lấy danh sách file thành công')
  findAll(
    @Query('page') page: string,
    @Query('limit') limit: string,
    @Query('folder') folder: string,
  ) {
    return this.filesService.findAll(+page || 1, +limit || 20, folder);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  @ResponseMessage('Lấy chi tiết file thành công')
  findOne(@Param('id') id: string) {
    return this.filesService.findOne(+id);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @ResponseMessage('Xóa file thành công')
  remove(@Param('id') id: string) {
    return this.filesService.remove(+id);
  }
}
