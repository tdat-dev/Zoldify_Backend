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

  // Map userId -> Set<socketId> để biết user nào đang online
  // Một user có thể mở nhiều tab → nhiều socket
  private onlineUsers = new Map<number, Set<string>>();

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

      // Thêm socket vào map online
      if (!this.onlineUsers.has(userId)) this.onlineUsers.set(userId, new Set());
      this.onlineUsers.get(userId)!.add(client.id);

      // Broadcast tới tất cả client rằng user này vừa online
      this.server.emit('user_presence', { user_id: userId, online: true, last_seen: now });
    } catch {
      client.disconnect();
    }
  }

  async handleDisconnect(client: Socket) {
    if (!client.data.user?.id) return;
    const userId = client.data.user.id;

    // Gỡ socket khỏi map online
    const sockets = this.onlineUsers.get(userId);
    if (sockets) {
      sockets.delete(client.id);
      if (sockets.size === 0) {
        this.onlineUsers.delete(userId);
        // Cập nhật last_seen khi user thực sự offline (không còn socket nào)
        const now = new Date();
        await this.userRepository.update(userId, { last_seen: now });
        // Broadcast offline
        this.server.emit('user_presence', { user_id: userId, online: false, last_seen: now });
      }
    }
  }

  @SubscribeMessage('join_conversation')
  handleJoinConversation(@ConnectedSocket() client: Socket, @MessageBody() conversationId: number) {
    client.join(`conv_${conversationId}`);
  }

  // Client yêu cầu server trả về danh sách userId đang online (để sync lần đầu)
  @SubscribeMessage('request_online_users')
  handleRequestOnlineUsers(@ConnectedSocket() client: Socket) {
    const onlineIds = Array.from(this.onlineUsers.keys());
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
