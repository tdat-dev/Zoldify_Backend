import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';
import { JwtService } from '@nestjs/jwt';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '@identity/users/entities/user.entity';
import { NotificationsService } from '@messaging/notifications/notifications.service';

@Injectable()
@WebSocketGateway({ cors: { origin: '*' }, namespace: '/chat' })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;

  /**
   * Ai đang online — hỏi CẢ CỤM, không giữ trong RAM (task #5).
   *
   * Trước đây chỗ này là `private onlineUsers = new Map<number, Set<string>>()`.
   * Map ấy đúng khi chạy một tiến trình và sai ngay khi chạy hai: mỗi bản api
   * chỉ thấy socket của chính nó, nên `request_online_users` trả về một danh
   * sách khác nhau tuỳ người dùng rơi vào bản nào — và không bản nào đúng.
   *
   * VÌ SAO KHÔNG THAY BẰNG MỘT SET TRONG REDIS.
   *
   * Đó là cách rõ ràng nhất và cũng là cách rò rỉ. Muốn Set đúng thì phải
   * `SREM` lúc socket đóng — nhưng một bản api bị `kill -9`, hết RAM, hay
   * container bị thay lúc deploy thì không kịp `SREM` gì cả. Những userId đó
   * ở lại trong Set vĩnh viễn, "online" mãi mãi, và không có gì tự dọn. Rác
   * kiểu này tích lại theo từng lần deploy.
   *
   * `fetchSockets()` hỏi các tiến trình đang sống theo thời gian thực qua
   * adapter Redis. Bản api chết thì socket của nó biến mất cùng nó — không có
   * gì để rò rỉ, không cần dọn dẹp, không cần TTL.
   *
   * Đánh đổi: mỗi lần hỏi là một vòng request/response qua Redis, đắt hơn đọc
   * một Map trong RAM. Chấp nhận được ở đây vì nó chỉ chạy lúc kết nối, lúc
   * ngắt, và khi client xin ảnh chụp — không nằm trên đường đi của mỗi tin nhắn.
   */
  private async userIdsDangOnline(): Promise<number[]> {
    const sockets = await this.server.fetchSockets();
    const ids = sockets
      .map((s) => s.data?.user?.id as number | undefined)
      .filter((id): id is number => typeof id === 'number');
    return [...new Set(ids)];
  }

  constructor(
    private readonly chatService: ChatService,
    private readonly jwtService: JwtService,
    private readonly notificationsService: NotificationsService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) { }

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token || client.handshake.query?.token as string;
      if (!token) { client.disconnect(); return; }
      const payload = this.jwtService.verify(token);
      const userId = payload.sub;
      client.data.user = { id: userId, email: payload.email, full_name: payload.full_name, role: payload.role };

      // Cập nhật last_seen cho user khi vừa kết nối socket
      const now = new Date();
      await this.userRepository.update(userId, { last_seen: now });

      // Không còn map nào để cập nhật: socket vừa nối là đã nằm trong adapter,
      // và mọi câu hỏi "ai đang online" đều đi qua userIdsDangOnline().

      // Broadcast tới tất cả client rằng user này vừa online
      this.server.emit('user_presence', { user_id: userId, online: true, last_seen: now });
    } catch {
      client.disconnect();
    }
  }

  async handleDisconnect(client: Socket) {
    if (!client.data.user?.id) return;
    const userId = client.data.user.id;

    // "Thực sự offline" phải hỏi CẢ CỤM, không chỉ tiến trình này.
    //
    // Một người mở web trên máy tính và app trên điện thoại là hai socket, và
    // load balancer rất có thể đẩy chúng vào hai bản api khác nhau. Đóng tab
    // web mà chỉ đếm socket của bản đang xử lý thì kết luận "offline" trong
    // khi điện thoại vẫn đang nối — bạn bè thấy họ offline dù họ vẫn ở đó.
    //
    // Loại trừ client.id: lúc handleDisconnect chạy, socket vừa ngắt vẫn có
    // thể còn trong danh sách của adapter.
    const conNoi = await this.server.fetchSockets();
    const conSocketKhac = conNoi.some(
      (s) => s.id !== client.id && (s.data?.user?.id as number) === userId,
    );

    if (!conSocketKhac) {
      // Cập nhật last_seen khi user thực sự offline (không còn socket nào)
      const now = new Date();
      await this.userRepository.update(userId, { last_seen: now });
      // Broadcast offline
      this.server.emit('user_presence', { user_id: userId, online: false, last_seen: now });
    }
  }

  @SubscribeMessage('join_conversation')
  handleJoinConversation(@ConnectedSocket() client: Socket, @MessageBody() conversationId: number) {
    client.join(`conv_${conversationId}`);
  }

  // Client yêu cầu server trả về danh sách userId đang online (để sync lần đầu)
  @SubscribeMessage('request_online_users')
  async handleRequestOnlineUsers(@ConnectedSocket() client: Socket) {
    const onlineIds = await this.userIdsDangOnline();
    client.emit('online_users_snapshot', { user_ids: onlineIds });
  }

  @SubscribeMessage('leave_conversation')
  handleLeaveConversation(@ConnectedSocket() client: Socket, @MessageBody() conversationId: number) {
    client.leave(`conv_${conversationId}`);
  }

  @SubscribeMessage('send_message')
  async handleMessage(@ConnectedSocket() client: Socket, @MessageBody() payload: { conversationId: number; content: string; images?: string[] }) {
    const user = client.data.user;
    if (!user) return;
    try {
      const message = await this.chatService.sendMessage(payload.conversationId, { content: payload.content, images: payload.images || [] }, user);

      // Cập nhật last_seen (heartbeat khi gửi tin)
      await this.userRepository.update(user.id, { last_seen: new Date() });
      this.server.to(`conv_${payload.conversationId}`).emit('receive_message', message);

      // Tạo notification cho người nhận
      const conversation = await this.chatService.getConversationById(payload.conversationId);
      if (conversation) {
        const recipientId = conversation.buyer?.id === user.id ? conversation.seller?.id : conversation.buyer?.id;
        if (recipientId) {
          await this.notificationsService.create({
            user_id: recipientId,
            type: 'message' as any,
            title: 'Tin nhắn mới',
            content: `${user.full_name}: ${payload.content}`,
            data: { conversation_id: payload.conversationId, sender_id: user.id },
          });
        }
      }

      return message;
    } catch (err: any) {
      client.emit('error', err.message);
    }
  }
}
