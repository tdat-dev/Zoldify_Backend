import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Notification } from './entities/notification.entity';
import { PushToken } from './entities/push-token.entity';
import { FirebaseService } from '@messaging/firebase/firebase.service';
import { IUser } from '@identity/users/users.interface';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly notiRepository: Repository<Notification>,
    @InjectRepository(PushToken)
    private readonly pushRepository: Repository<PushToken>,
    private readonly firebaseService: FirebaseService,
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

    const saved = await this.notiRepository.save(notification);

    // Đẩy push tới mọi thiết bị của user (không chặn/không làm hỏng nếu lỗi).
    void this.pushToUser(user_id, saved);

    return saved;
  }

  /** Lưu (upsert) token thiết bị của user để nhận push. */
  async registerToken(user: IUser, token: string, platform?: string) {
    const existing = await this.pushRepository.findOne({ where: { token } });
    if (existing) {
      existing.user = { id: user.id } as any;
      if (platform) existing.platform = platform;
      await this.pushRepository.save(existing);
    } else {
      await this.pushRepository.save(
        this.pushRepository.create({
          user: { id: user.id },
          token,
          platform: platform ?? 'android',
        }),
      );
    }
    return { registered: true };
  }

  /** Gỡ token (khi đăng xuất) để thiết bị này thôi nhận push của user. */
  async unregisterToken(token: string) {
    await this.pushRepository.delete({ token });
    return { unregistered: true };
  }

  /** Gửi FCM cho toàn bộ thiết bị của một user + dọn token chết. */
  private async pushToUser(userId: number, noti: Notification) {
    const rows = await this.pushRepository.find({
      where: { user: { id: userId } },
    });
    const tokens = rows.map((r) => r.token);
    if (tokens.length === 0) return;

    // FCM data phải toàn chuỗi — nhét type + id để app điều hướng khi bấm.
    const data: Record<string, string> = {
      type: String(noti.type),
      notification_id: String(noti.id),
    };
    if (noti.data && typeof noti.data === 'object') {
      for (const [k, v] of Object.entries(noti.data)) {
        if (v != null) data[k] = String(v);
      }
    }

    const dead = await this.firebaseService.sendPush(tokens, {
      title: noti.title,
      body: noti.content,
      data,
    });
    if (dead.length) await this.pushRepository.delete({ token: In(dead) });
  }

  async findAll(currentPage: string, limit: string, user: IUser) {
    const numPage = currentPage ? parseInt(currentPage) : 1;
    const numLimit = limit ? parseInt(limit) : 10;
    const offset = (numPage - 1) * numLimit;

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
