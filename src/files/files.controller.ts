import { Controller, Get, Post, Body, Patch, Param, Delete, UseInterceptors, UseFilters, UploadedFile, Req, UseGuards, Query, BadRequestException } from '@nestjs/common';
import { FilesService } from './files.service';
import { Public } from 'src/common/decorators/public.decorator';
import { ResponseMessage } from 'src/common/decorators/response.decorator';
import { HttpExceptionFilter } from 'src/core/http-exception.filter';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { User } from 'src/common/decorators/user.decorator';
import type { IUser } from 'src/users/users.interface';

@Controller('files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @UseGuards(JwtAuthGuard)
  @Post('upload')
  @ResponseMessage('Upload file thành công')
  @UseInterceptors(FileInterceptor('fileUpload'))
  @UseFilters(new HttpExceptionFilter())
  async uploadFile(@UploadedFile() file: Express.Multer.File, @Req() req: any, @User() user: IUser) {
  if (!file) {
    throw new BadRequestException('Không nhận được file. Vui lòng chọn lại ảnh.');
  }
  
  const folder = req?.headers?.folder_type ?? 'default';
  const url = `${req.protocol}://${req.get('host')}/public/images/${folder}/${file.filename}`;

  const saved = await this.filesService.create({
    file_name: file.originalname,
    url,
    mime_type: file.mimetype,
    size: file.size,
    folder,
  }, user);

  return saved;
}

  @UseGuards(JwtAuthGuard)
  @Get()
  @ResponseMessage('Lấy danh sách file thành công')
  findAll(@Query('page') page: string, @Query('limit') limit: string, @Query('folder') folder: string) {
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