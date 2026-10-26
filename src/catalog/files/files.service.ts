import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { FileEntity } from './entities/file.entity';
import type { IUser } from '@identity/users/users.interface';
import { UserRole } from '@identity/users/entities/user.entity';

/**
 * Ba route đọc/xoá ở /files từng chỉ có JwtAuthGuard: ai đăng nhập cũng liệt
 * kê, đọc (kèm nguyên dòng users của người tải: email, số điện thoại, vai
 * trò) và xoá bản ghi file của người khác, id tăng dần nên quét được hết.
 * Giờ: admin thấy hết, người khác chỉ thấy file của mình; file của người khác
 * trả 404 như không tồn tại. Không client nào gọi ba route này (kiểm 25/10).
 */
const laAdmin = (user: IUser) => user.role === UserRole.ADMIN;

@Injectable()
export class FilesService {
  constructor(
    @InjectRepository(FileEntity)
    private readonly fileRepository: Repository<FileEntity>,
  ) {}

  async create(
    fileData: {
      file_name: string;
      url: string;
      mime_type: string;
      size: number;
      folder: string;
    },
    user: IUser,
  ) {
    const file = this.fileRepository.create({
      ...fileData,
      uploaded_by: { id: user.id },
    });
    return this.fileRepository.save(file);
  }

  async findAll(
    page: number,
    limit: number,
    folder: string | undefined,
    user: IUser,
  ) {
    const where: FindOptionsWhere<FileEntity> = {};
    if (folder) where.folder = folder;
    if (!laAdmin(user)) where.uploaded_by = { id: user.id };

    const [result, total] = await this.fileRepository.findAndCount({
      where,
      skip: (page - 1) * limit,
      take: limit,
      order: { created_at: 'DESC' },
    });

    return {
      meta: {
        current: page,
        pageSize: limit,
        pages: Math.ceil(total / limit),
        total,
      },
      result,
    };
  }

  async findOne(id: number, user: IUser) {
    const file = await this.fileRepository.findOne({
      where: { id },
      relations: ['uploaded_by'],
    });
    if (!file || (!laAdmin(user) && file.uploaded_by?.id !== user.id)) {
      throw new NotFoundException('Không tìm thấy file');
    }
    // Chỉ cần biết ai tải lên, không cần hồ sơ tài khoản của họ.
    return {
      ...file,
      uploaded_by: file.uploaded_by
        ? { id: file.uploaded_by.id, full_name: file.uploaded_by.full_name }
        : file.uploaded_by,
    };
  }

  async remove(id: number, user: IUser) {
    // findOne đã kiểm chủ và ném 404 cho người lạ.
    await this.findOne(id, user);
    await this.fileRepository.delete(id);
    return { message: 'Xóa file thành công' };
  }
}
