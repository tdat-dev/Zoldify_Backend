import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Notification } from './entities/notification.entity';
import { PushToken } from './entities/push-token.entity';
import { User } from '@identity/users/entities/user.entity';
import { KENH_THONG_BAO } from '@common/kenh-thong-bao';

@Module({
  imports: [TypeOrmModule.forFeature([Notification, PushToken, User])],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    // Cùng một instance, chỉ thêm một tên gọi cho tầng không được import
    // messaging (xem `@common/kenh-thong-bao`).
    { provide: KENH_THONG_BAO, useExisting: NotificationsService },
  ],
  exports: [NotificationsService, KENH_THONG_BAO],
})
export class NotificationsModule {}
