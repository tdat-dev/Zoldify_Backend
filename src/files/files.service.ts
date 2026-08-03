import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FileEntity } from './entities/file.entity';
import type { IUser } from 'src/users/users.interface';

@Injectable()
export class FilesService {
  constructor(
    @InjectRepository(FileEntity)
    private readonly fileRepository: Repository<FileEntity>,
  ) {}

  async create(fileData: {
    file_name: string;
    url: string;
    mime_type: string;
    size: number;
    folder: string;
  }, user: IUser) {
    const file = this.fileRepository.create({
      ...fileData,
      uploaded_by: { id: user.id },
    });
    return this.fileRepository.save(file);
  }

  async findAll(page: number, limit: number, folder?: string) {
    const where: any = {};
    if (folder) where.folder = folder;

    const [result, total] = await this.fileRepository.findAndCount({
      where,
      skip: (page - 1) * limit,
      take: limit,
      order: { created_at: 'DESC' },
    });

    return {
      meta: { current: page, pageSize: limit, pages: Math.ceil(total / limit), total },
      result,
    };
  }

  async findOne(id: number) {
    return this.fileRepository.findOne({ where: { id }, relations: ['uploaded_by'] });
  }

  async remove(id: number) {
    await this.fileRepository.delete(id);
    return { message: 'Xóa file thành công' };
  }
}