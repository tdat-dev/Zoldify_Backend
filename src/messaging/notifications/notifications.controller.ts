import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Query } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { JwtAuthGuard } from '@identity/auth/jwt-auth.guard';
import { ResponseMessage } from '@common/decorators/response.decorator';
import { SkipCheckPermissions } from '@common/decorators/public.decorator';
import { User } from '@common/decorators/user.decorator';
import type { IUser } from '@identity/users/users.interface';
import { Notification } from './entities/notification.entity';
import { ApiPaginated, ApiShape } from '@common/decorators/api-response.decorator';

@SkipCheckPermissions()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Tạo thông báo thành công')
  @Post()
  create(@Body() createNotificationDto: CreateNotificationDto) {
    return this.notificationsService.create(createNotificationDto);
  }

  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Lấy danh sách thông báo thành công')
  @ApiPaginated(Notification)
  @Get()
  findAll(
    @Query('currentPage') currentPage: string,
    @Query('limit') limit: string,
    @User() user: IUser,
  ) {
    return this.notificationsService.findAll(currentPage, limit, user);
  }

  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Lấy số thông báo chưa đọc thành công')
  @ApiShape({ unread_count: 'number' })
  @Get('unread-count')
  getUnreadCount(@User() user: IUser) {
    return this.notificationsService.getUnreadCount(user);
  }

  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Lấy chi tiết thông báo thành công')
  @Get(':id')
  findOne(@Param('id') id: string, @User() user: IUser) {
    return this.notificationsService.findOne(+id, user);
  }

  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Đánh dấu thông báo đã đọc thành công')
  @Patch(':id/read')
  markAsRead(@Param('id') id: string, @User() user: IUser) {
    return this.notificationsService.markAsRead(+id, user);
  }

  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Đánh dấu tất cả thông báo đã đọc thành công')
  @Patch('read-all')
  markAllAsRead(@User() user: IUser) {
    return this.notificationsService.markAllAsRead(user);
  }

  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Xóa thông báo thành công')
  @Delete(':id')
  remove(@Param('id') id: string, @User() user: IUser) {
    return this.notificationsService.remove(+id, user);
  }
}
