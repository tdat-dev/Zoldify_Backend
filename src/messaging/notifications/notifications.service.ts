import { Injectable, NotFoundException } from '@nestjs/common';
import { normalizePagination } from '@common/dto/pagination.dto';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification } from './entities/notification.entity';
import { IUser } from '@identity/users/users.interface';

@Injectable()
export class NotificationsService {

  constructor(
    @InjectRepository(Notification)
    private readonly notiRepository: Repository<Notification>,
  ) {}

  async create(createNotificationDto: CreateNotificationDto) {
    const { user_id, type, title, content, data } = createNotificationDto;

    const notification = this.notiRepository.create({
      user: { id: user_id },
      type,
      title,
      content,
      data,
    });

    return this.notiRepository.save(notification);
  }

  async findAll(currentPage: string, limit: string, user: IUser) {
    const {
      page: numPage,
      size: numLimit,
      offset,
    } = normalizePagination(currentPage, limit);

    const [result, totalItems] = await this.notiRepository.findAndCount({
      where: { user: { id: user.id } },
      skip: offset,
      take: numLimit,
      order: { created_at: 'DESC' },
    });

    const totalPages = Math.ceil(totalItems / numLimit);

    return {
      meta: {
        current: numPage,
        pageSize: numLimit,
        pages: totalPages,
        total: totalItems,
      },
      result,
    };
  }

  async getUnreadCount(user: IUser) {
    const count = await this.notiRepository.count({
      where: { user: { id: user.id }, is_read: false },
    });
    return { unread_count: count };
  }

  async findOne(id: number, user: IUser) {
    const notification = await this.notiRepository.findOne({
      where: { id, user: { id: user.id } },
    });

    if (!notification) {
      throw new NotFoundException('Không tìm thấy thông báo');
    }

    return notification;
  }

  async markAsRead(id: number, user: IUser) {
    const notification = await this.findOne(id, user);
    notification.is_read = true;
    return this.notiRepository.save(notification);
  }

  async markAllAsRead(user: IUser) {
    await this.notiRepository.update(
      { user: { id: user.id }, is_read: false },
      { is_read: true },
    );
    return 'Đã đánh dấu tất cả thông báo là đã đọc';
  }

  async remove(id: number, user: IUser) {
    const notification = await this.findOne(id, user);
    notification.is_read = true;
    await this.notiRepository.delete(id);
    return 'Xóa thông báo thành công';
  }
}
