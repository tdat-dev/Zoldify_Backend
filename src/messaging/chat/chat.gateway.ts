import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';
import { JwtService } from '@nestjs/jwt';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from '@identity/users/entities/user.entity';
import { NotificationsService } from '@messaging/notifications/notifications.service';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SendMessageSocketDto } from './dto/send-message.dto';
import { BoDemNhip } from './bo-dem-nhip';

/**
 * Nhịp gửi tin tối đa của MỘT NGƯỜI DÙNG: 10 tin trong 10 giây, chung cho mọi
 * socket và mọi bản api (đếm trên Redis, xem bo-dem-nhip.ts).
 *
 * Không có giới hạn thì một vòng lặp phía client bắn hàng nghìn tin mỗi giây,
 * mỗi tin là một INSERT messages, một UPDATE users.last_seen và một thông báo
 * cho người nhận; ThrottlerGuard của HTTP không chạy cho socket. Bản trước đếm
 * theo socket trong client.data: mở thêm tab hoặc nối lại là có hạn mức mới.
 * Người thật gõ tin mua bán không tới một tin mỗi giây kéo dài.
 */
const NHIP_TOI_DA = 10;
const CUA_SO_NHIP_MS = 10_000;

/**
 * Số socket tối đa của một người cùng lúc: vài tab web cộng điện thoại là đủ.
 * Không giới hạn thì một token mở được hàng nghìn kết nối, mỗi cái một lần
 * UPDATE last_seen và một chỗ trong adapter Redis. Đếm qua phòng user_<id>
 * trên cả cụm; hai kết nối đến đúng cùng lúc có thể lọt quá một chút (đếm rồi
 * mới vào phòng), chấp nhận vì mục đích là chặn hàng trăm, không phải chặn số 6.
 */
const KET_NOI_TOI_DA = 5;

/**
 * Chu kỳ quét socket của phiên đã bị thu hồi (xem quetPhienDaThuHoi).
 */
const CHU_KY_QUET_MS = 30_000;

type NguoiTrenSocket = {
  id: number;
  email?: string;
  full_name: string;
  role?: string;
  token_version?: number;
};

@Injectable()
@WebSocketGateway({ cors: { origin: '*' }, namespace: '/chat' })
export class ChatGateway
  implements
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnGatewayInit,
    OnModuleDestroy
{
  @WebSocketServer() server: Server;

  private readonly nhipGui = new BoDemNhip(
    'chat_nhip',
    NHIP_TOI_DA,
    CUA_SO_NHIP_MS,
  );
  private henQuet?: NodeJS.Timeout;

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
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token || client.handshake.query?.token as string;
      if (!token) { client.disconnect(); return; }
      const payload = this.jwtService.verify<{
        sub: number;
        email: string;
        full_name: string;
        role: string;
        token_version: number;
      }>(token);
      const userId = payload.sub;

      // Cùng điều kiện với JwtStrategy: token đã bị thu hồi hoặc tài khoản bị
      // khoá thì không cho kết nối. Trước 28/09 chỉ kiểm chữ ký (audit B-04).
      const dbUser = await this.userRepository.findOne({
        where: { id: userId },
      });
      if (
        !dbUser ||
        dbUser.is_locked ||
        payload.token_version !== dbUser.token_version
      ) {
        client.disconnect();
        return;
      }
      // Giới hạn số kết nối của một người (xem KET_NOI_TOI_DA).
      const phongRieng = `user_${userId}`;
      const dangMo = await this.server.in(phongRieng).fetchSockets();
      if (dangMo.length >= KET_NOI_TOI_DA) {
        client.emit('error', 'Bạn đang mở quá nhiều kết nối chat');
        client.disconnect();
        return;
      }
      await client.join(phongRieng);

      // token_version giữ lại để mỗi lần gửi tin và mỗi lượt quét so với DB:
      // phiên bị thu hồi SAU lúc nối thì socket phải chết theo.
      client.data.user = {
        id: userId,
        email: payload.email,
        full_name: payload.full_name,
        role: payload.role,
        token_version: dbUser.token_version,
      } satisfies NguoiTrenSocket;

      // Cập nhật last_seen cho user khi vừa kết nối socket
      const now = new Date();
      await this.userRepository.update(userId, { last_seen: now });

      // Không còn map nào để cập nhật: socket vừa nối là đã nằm trong adapter,
      // và mọi câu hỏi "ai đang online" đều đi qua userIdsDangOnline().

      // Broadcast tới tất cả client rằng user này vừa online
      this.server.emit('user_presence', {
        user_id: userId,
        online: true,
        last_seen: now,
      });
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
      this.server.emit('user_presence', {
        user_id: userId,
        online: false,
        last_seen: now,
      });
    }
  }

  /**
   * Chỉ người mua hoặc người bán của hội thoại được vào phòng (A-07).
   *
   * Bản trước join thẳng theo id client gửi. Mọi tin được phát vào phòng
   * `conv_<id>` (receive_message), nên chỉ cần đăng nhập rồi đếm id từ 1 là
   * nghe lén được mọi cuộc trò chuyện, trong khi HTTP GET .../messages đã kiểm
   * thành viên từ lâu. Hội thoại không tồn tại và người ngoài nhận CÙNG một câu
   * lỗi, để không dò được id nào có thật.
   */
  @SubscribeMessage('join_conversation')
  async handleJoinConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() conversationId: number,
  ) {
    const userId = (client.data as { user?: { id: number } }).user?.id;
    if (!(await this.phienConHieuLuc(client))) return;
    const conv = await this.chatService.getConversationById(
      Number(conversationId),
    );
    if (
      !userId ||
      !conv ||
      (conv.buyer?.id !== userId && conv.seller?.id !== userId)
    ) {
      client.emit(
        'error',
        'Bạn không phải là thành viên của cuộc trò chuyện này',
      );
      return;
    }
    await client.join(`conv_${conv.id}`);
  }

  // Client yêu cầu server trả về danh sách userId đang online (để sync lần đầu)
  @SubscribeMessage('request_online_users')
  async handleRequestOnlineUsers(@ConnectedSocket() client: Socket) {
    const onlineIds = await this.userIdsDangOnline();
    client.emit('online_users_snapshot', { user_ids: onlineIds });
  }

  @SubscribeMessage('leave_conversation')
  handleLeaveConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() conversationId: number,
  ) {
    client.leave(`conv_${conversationId}`);
  }

  /**
   * PHIÊN BỊ THU HỒI THÌ SOCKET PHẢI CHẾT.
   *
   * Mọi đường thu hồi phiên (khoá tài khoản, đăng xuất, đổi vai trò, đổi/đặt
   * lại mật khẩu, refresh bị dùng lại) đều tăng token_version. handleConnection
   * chỉ so MỘT LẦN lúc nối, nên trước đây socket đang mở sống tiếp: vẫn gửi
   * tin, vẫn nghe tin trong các phòng đã vào.
   *
   * VÌ SAO KIỂM Ở ĐÂY CHỨ KHÔNG PHÁT SỰ KIỆN TỪ CHỖ TĂNG token_version.
   * Phát sự kiện thì ngắt ngay lập tức, nhưng phải sửa sáu chỗ ở hai module
   * (auth, admin) và chỗ thứ bảy ai đó thêm sau này mà quên phát là lỗ lại mở.
   * Ở đây không phụ thuộc ai nhớ gì: (1) mỗi lần gửi tin, vào phòng là so lại
   * với DB, một câu SELECT theo khoá chính, đã bị giới hạn nhịp chặn trên; (2)
   * socket chỉ NGHE thì lượt quét mỗi 30 giây bắt được. Đánh đổi: một socket
   * chỉ nghe sống thêm tối đa 30 giây sau khi bị thu hồi.
   */
  private async phienConHieuLuc(client: Socket): Promise<boolean> {
    const user = (client.data as { user?: NguoiTrenSocket }).user;
    if (!user) return false;
    const dbUser = await this.userRepository.findOne({
      where: { id: user.id },
    });
    if (
      !dbUser ||
      dbUser.is_locked ||
      dbUser.token_version !== user.token_version
    ) {
      client.emit(
        'error',
        'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại',
      );
      client.disconnect(true);
      return false;
    }
    return true;
  }

  /**
   * Lượt quét: socket của tiến trình NÀY (server.local) mà phiên đã bị thu hồi
   * thì ngắt. Mỗi bản api quét phần của mình, một câu SELECT cho cả lượt.
   */
  async quetPhienDaThuHoi(): Promise<void> {
    const sockets = await this.server.local.fetchSockets();
    const ids = [
      ...new Set(
        sockets
          .map((s) => (s.data as { user?: NguoiTrenSocket }).user?.id)
          .filter((id): id is number => typeof id === 'number'),
      ),
    ];
    if (!ids.length) return;
    const dbUsers = await this.userRepository.find({
      where: { id: In(ids) },
      select: ['id', 'token_version', 'is_locked'],
    });
    const theoId = new Map(dbUsers.map((u) => [u.id, u]));
    for (const s of sockets) {
      const user = (s.data as { user?: NguoiTrenSocket }).user;
      if (!user) continue;
      const db = theoId.get(user.id);
      if (!db || db.is_locked || db.token_version !== user.token_version) {
        s.disconnect(true);
      }
    }
  }

  afterInit() {
    this.henQuet = setInterval(() => {
      this.quetPhienDaThuHoi().catch(() => undefined);
    }, CHU_KY_QUET_MS);
    // Không giữ tiến trình sống chỉ vì lượt quét (test, tắt máy êm).
    this.henQuet.unref();
  }

  onModuleDestroy() {
    if (this.henQuet) clearInterval(this.henQuet);
    void this.nhipGui.dong();
  }

  @SubscribeMessage('send_message')
  async handleMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    raw: { conversationId: number; content: string; images?: string[] },
  ) {
    const user = client.data.user;
    if (!user) return;
    if (!(await this.phienConHieuLuc(client))) return;

    // Đếm cả lần gửi sai dữ liệu: nếu không thì bắn payload hỏng liên tục là
    // một cách né giới hạn nhịp. Đếm theo NGƯỜI DÙNG, chung mọi socket.
    const nguoi = (client.data as { user: NguoiTrenSocket }).user;
    if (!(await this.nhipGui.conTrongHan(nguoi.id))) {
      client.emit('error', 'Bạn gửi tin quá nhanh, vui lòng chờ một chút');
      return;
    }

    // ValidationPipe toàn cục chỉ chạy cho HTTP, nên payload socket phải tự
    // kiểm. Dùng chung luật với POST .../messages (SendMessageDto).
    const payload = plainToInstance(SendMessageSocketDto, raw ?? {});
    const loi = await validate(payload);
    if (loi.length) {
      const dauTien = Object.values(loi[0].constraints ?? {})[0];
      client.emit('error', dauTien ?? 'Tin nhắn không hợp lệ');
      return;
    }

    try {
      const message = await this.chatService.sendMessage(
        payload.conversationId,
        { content: payload.content, images: payload.images || [] },
        user,
      );

      // Cập nhật last_seen (heartbeat khi gửi tin)
      await this.userRepository.update(user.id, { last_seen: new Date() });
      this.server
        .to(`conv_${payload.conversationId}`)
        .emit('receive_message', message);

      // Tạo notification cho người nhận
      const conversation = await this.chatService.getConversationById(
        payload.conversationId,
      );
      if (conversation) {
        const recipientId =
          conversation.buyer?.id === user.id
            ? conversation.seller?.id
            : conversation.buyer?.id;
        if (recipientId) {
          await this.notificationsService.create({
            user_id: recipientId,
            type: 'message' as any,
            title: 'Tin nhắn mới',
            content: `${user.full_name}: ${payload.content}`,
            data: {
              conversation_id: payload.conversationId,
              sender_id: user.id,
            },
          });
        }
      }

      return message;
    } catch (err: any) {
      client.emit('error', err.message);
    }
  }
}
