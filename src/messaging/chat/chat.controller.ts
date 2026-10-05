import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Query } from '@nestjs/common';
import { ChatService } from './chat.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { JwtAuthGuard } from '@identity/auth/jwt-auth.guard';
import { ResponseMessage } from '@common/decorators/response.decorator';
import { User } from '@common/decorators/user.decorator';
import type { IUser } from '@identity/users/users.interface';
import { ApiShape } from '@common/decorators/api-response.decorator';
import { Message } from './entities/message.entity';
import { ApiPaginated } from '@common/decorators/api-response.decorator';

@UseGuards(JwtAuthGuard)
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @ResponseMessage('Tạo cuộc trò chuyện thành công')
  @Post('conversations')
  createConversation(@Body() createConversationDto: CreateConversationDto, @User() user: IUser) {
    return this.chatService.createConversation(createConversationDto, user);
  }

  // Hai tham số phân trang là TUỲ CHỌN — không gửi thì vẫn chạy như cũ, chỉ
  // khác là nay chặn ở 20 hội thoại/trang thay vì nạp hết. Hình dạng trả về
  // giữ nguyên `{ result }`, chỉ thêm `meta` (cộng thêm, không thay thế —
  // cùng nguyên tắc keyset của Epic 2).
  @ResponseMessage('Lấy danh sách cuộc trò chuyện thành công')
  @Get('conversations')
  getMyConversations(
    @User() user: IUser,
    @Query('currentPage') currentPage: string,
    @Query('limit') limit: string,
  ) {
    return this.chatService.getMyConversations(user, currentPage, limit);
  }

  @ResponseMessage('Lấy tin nhắn thành công')
  @ApiPaginated(Message)
  @Get('conversations/:id/messages')
  getMessages(
    @Param('id') id: string,
    @Query('currentPage') currentPage: string,
    @Query('limit') limit: string,
    @User() user: IUser,
  ) {
    return this.chatService.getMessages(+id, currentPage, limit, user);
  }

  @ResponseMessage('Gửi tin nhắn thành công')
  @Post('conversations/:id/messages')
  sendMessage(
    @Param('id') id: string,
    @Body() sendMessageDto: SendMessageDto,
    @User() user: IUser,
  ) {
    return this.chatService.sendMessage(+id, sendMessageDto, user);
  }

  @ResponseMessage('Đánh dấu tin nhắn đã đọc thành công')
  @Patch('conversations/:id/read')
  markAsRead(@Param('id') id: string, @User() user: IUser) {
    return this.chatService.markAsRead(+id, user);
  }

  @ResponseMessage('Lấy số tin nhắn chưa đọc thành công')
  @ApiShape({ unread_count: 'number' })
  @Get('unread-count')
  getUnreadCount(@User() user: IUser) {
    return this.chatService.getUnreadCount(user);
  }
}
