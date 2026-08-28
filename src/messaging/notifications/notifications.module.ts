import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Notification } from './entities/notification.entity';
import { PushToken } from './entities/push-token.entity';
import { User } from '@identity/users/entities/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Notification, PushToken, User])],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
