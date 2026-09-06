import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { normalizePagination } from '@common/dto/pagination.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Conversation } from './entities/conversation.entity';
import { Message } from './entities/message.entity';
import { Product } from '@catalog/products/entities/product.entity';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { IUser } from '@identity/users/users.interface';

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(Conversation)
    private readonly conversationRepository: Repository<Conversation>,
    @InjectRepository(Message)
    private readonly messageRepository: Repository<Message>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
  ) {}

  // --- CONVERSATIONS ---

  // Tạo cuộc trò chuyện mới
  async createConversation(
    createConversationDto: CreateConversationDto,
    user: IUser,
  ) {
    const { seller_id, product_id } = createConversationDto;

    const product = await this.productRepository.findOne({
      where: { id: product_id },
    });
    if (!product) {
      throw new NotFoundException('Không tìm thấy sản phẩm');
    }

    // Kiểm tra đã có conversation giữa buyer và seller về product này chưa
    const existing = await this.conversationRepository.findOne({
      where: {
        buyer: { id: user.id },
        seller: { id: seller_id },
        product: { id: product_id },
      },
    });

    if (existing) {
      return existing; // Đã có rồi thì trả về luôn
    }

    const conversation = this.conversationRepository.create({
      buyer: { id: user.id },
      seller: { id: seller_id },
      product: { id: product_id },
    });

    return this.conversationRepository.save(conversation);
  }

  // Lấy conversation theo id (cho chat gateway)
  async getConversationById(conversationId: number) {
    return this.conversationRepository.findOne({
      where: { id: conversationId },
      relations: ['buyer', 'seller'],
    });
  }

  /**
   * Danh sách hội thoại của user hiện tại.
   *
   * BẢN CŨ CÓ BA LỖI CHỒNG LÊN NHAU, và cả ba đều là loại Epic 1–3 đã chữa ở
   * nơi khác rồi bỏ sót đúng chỗ này:
   *
   *   1. `find()` KHÔNG có `take` — nạp toàn bộ hội thoại của user về RAM.
   *      Đúng con bệnh `orders.findAll` hồi Epic 1.
   *   2. N+1 nhân đôi — mỗi hội thoại thêm hai truy vấn (tin cuối, đếm chưa
   *      đọc). 100 hội thoại là 201 truy vấn cho MỘT lần mở tab Chat.
   *   3. `Promise.all` bọc quanh N+1 làm nó TỆ HƠN chứ không tốt hơn: 200 truy
   *      vấn bắn ra đồng thời vào pool 15 kết nối (task #5 hạ từ 50 xuống 15).
   *      Chạy tuần tự thì chậm; chạy song song thì làm nghẽn cả pool, tức là
   *      kéo sập luôn những request khác không liên quan.
   *
   * Nay: một câu lấy trang hội thoại, một câu lấy tin cuối cho CẢ trang, một
   * câu đếm chưa đọc cho CẢ trang. Số truy vấn không đổi dù trang có bao nhiêu
   * hội thoại — `chat.service.spec.ts` canh đúng điều đó bằng cách đếm.
   *
   * TƯƠNG THÍCH NGƯỢC: vẫn trả `{ result }` như cũ, chỉ THÊM `meta`. Hai tham
   * số phân trang là tuỳ chọn. Nhưng mặc định nay chặn ở 20 hội thoại/trang —
   * người nào có nhiều hơn thế thì frontend phải gọi trang tiếp, giống thay
   * đổi Epic 3 đã thông báo cho cả nhóm.
   */
  async getMyConversations(user: IUser, currentPage?: string, limit?: string) {
    // 20 cho khớp `getMessages` — cùng màn hình Chat thì cùng nhịp trang.
    const {
      page: numPage,
      size: numLimit,
      offset,
    } = normalizePagination(currentPage, limit, 20);

    const [conversations, totalItems] =
      await this.conversationRepository.findAndCount({
        where: [{ buyer: { id: user.id } }, { seller: { id: user.id } }],
        relations: ['buyer', 'seller', 'product'],
        order: { updated_at: 'DESC' },
        skip: offset,
        take: numLimit,
      });

    const ids = conversations.map((c) => c.id);
    const tinCuoi = await this.tinNhanCuoiTheoLo(ids);
    const chuaDoc = await this.demChuaDocTheoLo(ids, user.id);

    const result = conversations.map((conv) => {
      const isBuyer = conv.buyer?.id === user.id;
      const partner = isBuyer ? conv.seller : conv.buyer;
      return {
        id: conv.id,
        created_at: conv.created_at,
        updated_at: conv.updated_at,
        buyer: conv.buyer,
        seller: conv.seller,
        product: conv.product,
        partner_name: partner?.full_name,
        partner_id: partner?.id,
        partner_avatar: partner?.avatar,
        partner_last_seen: partner?.last_seen,
        last_message: tinCuoi.get(conv.id) ?? null,
        unread_count: chuaDoc.get(conv.id) ?? 0,
      };
    });

    return {
      result,
      meta: {
        current: numPage,
        pageSize: numLimit,
        pages: Math.ceil(totalItems / numLimit),
        total: totalItems,
      },
    };
  }

  /**
   * Tin nhắn cuối của NHIỀU hội thoại trong MỘT câu.
   *
   * Dùng hàm cửa sổ `ROW_NUMBER()` của MySQL 8 thay vì `GROUP BY ... MAX()`:
   * cách `MAX(created_at)` chỉ cho biết THỜI ĐIỂM tin cuối, muốn lấy nội dung
   * thì phải join ngược lại bảng — và join ngược theo `created_at` sẽ trả HAI
   * dòng nếu hai tin cùng một mốc micro-giây. `ROW_NUMBER` xếp hạng rồi lấy
   * hạng 1, nên luôn đúng một dòng mỗi hội thoại.
   *
   * Chốt thứ tự bằng cả `id` chứ không chỉ `created_at`: hai tin cùng thời
   * điểm thì `id` lớn hơn là tin sau. Thiếu vế này thì kết quả đổi giữa các lần
   * chạy — loại lỗi chỉ lộ ra khi tin nhắn đến dồn dập.
   */
  private async tinNhanCuoiTheoLo(
    ids: number[],
  ): Promise<Map<number, Message>> {
    const m = new Map<number, Message>();
    if (!ids.length) return m;

    const rows = await this.messageRepository
      .createQueryBuilder('m')
      .select([
        'm.id AS id',
        'm.conversation_id AS conversation_id',
        'm.sender_id AS sender_id',
        'm.content AS content',
        'm.is_read AS is_read',
        'm.created_at AS created_at',
      ])
      .addSelect(
        'ROW_NUMBER() OVER (PARTITION BY m.conversation_id ORDER BY m.created_at DESC, m.id DESC)',
        'rn',
      )
      .where('m.conversation_id IN (:...ids)', { ids })
      .getRawMany<Record<string, unknown>>();

    for (const r of rows) {
      if (Number(r.rn) !== 1) continue;
      m.set(Number(r.conversation_id), r as unknown as Message);
    }
    return m;
  }

  /**
   * Số tin chưa đọc của NHIỀU hội thoại trong MỘT câu.
   *
   * Không tính tin do chính user gửi — người ta không "chưa đọc" tin của mình.
   */
  private async demChuaDocTheoLo(
    ids: number[],
    userId: number,
  ): Promise<Map<number, number>> {
    const m = new Map<number, number>();
    if (!ids.length) return m;

    const rows = await this.messageRepository
      .createQueryBuilder('m')
      .select('m.conversation_id', 'conversation_id')
      .addSelect('COUNT(*)', 'so')
      .where('m.conversation_id IN (:...ids)', { ids })
      .andWhere('m.is_read = 0')
      .andWhere('m.sender_id <> :userId', { userId })
      .groupBy('m.conversation_id')
      .getRawMany<{ conversation_id: number; so: string }>();

    for (const r of rows) m.set(Number(r.conversation_id), Number(r.so));
    return m;
  }

  // Lấy tin nhắn trong 1 cuộc trò chuyện
  async getMessages(
    conversationId: number,
    currentPage: string,
    limit: string,
    user: IUser,
  ) {
    const conversation = await this.conversationRepository.findOne({
      where: { id: conversationId },
      relations: ['buyer', 'seller'],
    });

    if (!conversation) {
      throw new NotFoundException('Không tìm thấy cuộc trò chuyện');
    }

    // Kiểm tra user có trong cuộc trò chuyện này không
    if (
      conversation.buyer.id !== user.id &&
      conversation.seller.id !== user.id
    ) {
      throw new BadRequestException(
        'Bạn không phải là thành viên của cuộc trò chuyện này',
      );
    }

    const {
      page: numPage,
      size: numLimit,
      offset,
      // Giữ mặc định 20 tin/trang như cũ (đa số endpoint khác mặc định 10).
    } = normalizePagination(currentPage, limit, 20);

    const [result, totalItems] = await this.messageRepository.findAndCount({
      where: { conversation: { id: conversationId } },
      skip: offset,
      take: numLimit,
      relations: ['sender'],
      order: { created_at: 'DESC' },
    });

    return {
      meta: {
        current: numPage,
        pageSize: numLimit,
        pages: Math.ceil(totalItems / numLimit),
        total: totalItems,
      },
      result: result.reverse(), // Đảo ngược để tin nhắn cũ lên đầu
    };
  }

  // Gửi tin nhắn
  async sendMessage(
    conversationId: number,
    sendMessageDto: SendMessageDto,
    user: IUser,
  ) {
    const conversation = await this.conversationRepository.findOne({
      where: { id: conversationId },
      relations: ['buyer', 'seller'],
    });

    if (!conversation) {
      throw new NotFoundException('Không tìm thấy cuộc trò chuyện');
    }

    if (
      conversation.buyer.id !== user.id &&
      conversation.seller.id !== user.id
    ) {
      throw new BadRequestException(
        'Bạn không phải là thành viên của cuộc trò chuyện này',
      );
    }

    const { content, images } = sendMessageDto;

    const message = this.messageRepository.create({
      conversation: { id: conversationId },
      sender: { id: user.id },
      content,
      images,
    });

    // Cập nhật updated_at của conversation
    await this.conversationRepository.update(conversationId, {
      updated_at: new Date(),
    });

    return this.messageRepository.save(message);
  }

  // Đánh dấu tin nhắn đã đọc
  async markAsRead(conversationId: number, user: IUser) {
    const conversation = await this.conversationRepository.findOne({
      where: { id: conversationId },
      relations: ['buyer', 'seller'],
    });

    if (!conversation) {
      throw new NotFoundException('Không tìm thấy cuộc trò chuyện');
    }

    // Đánh dấu đã đọc tất cả tin nhắn chưa đọc trong conversation này
    await this.messageRepository.update(
      {
        conversation: { id: conversationId },
        is_read: false,
      },
      { is_read: true },
    );

    return 'Đã đánh dấu tất cả tin nhắn đã đọc';
  }

  // Đếm số tin nhắn chưa đọc của user (tổng tất cả conversations)
  /**
   * Tổng số tin chưa đọc của user — MỘT câu truy vấn.
   *
   * Bản cũ nạp TOÀN BỘ hội thoại của user về RAM chỉ để lấy danh sách id, rồi
   * mới đếm. Nhẹ hơn N+1 nhiều (hai câu, không phải 2N), nhưng vẫn là hình
   * dạng "nạp cả bảng rồi lọc trong app" mà Epic 1 đã chữa ở `orders.findAll`
   * — và nó chạy mỗi lần app hiện chấm đỏ trên icon chat, tức là rất thường.
   *
   * Nay để database làm việc của nó: join sang `conversations` và lọc ngay
   * trong SQL. Không dòng nào của bảng hội thoại đi qua Node.
   */
  async getUnreadCount(user: IUser) {
    const count = await this.messageRepository
      .createQueryBuilder('m')
      .innerJoin('conversations', 'c', 'c.id = m.conversation_id')
      .where('(c.buyer_id = :userId OR c.seller_id = :userId)', {
        userId: user.id,
      })
      .andWhere('m.is_read = 0')
      .andWhere('m.sender_id <> :userId', { userId: user.id })
      .getCount();

    return { unread_count: count };
  }
}
