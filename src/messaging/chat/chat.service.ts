import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { normalizePagination } from '@common/dto/pagination.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOneOptions, Repository } from 'typeorm';
import { Conversation } from './entities/conversation.entity';
import { Message } from './entities/message.entity';
import { Product } from '@catalog/products/entities/product.entity';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { IUser } from '@identity/users/users.interface';
import { User } from '@identity/users/entities/user.entity';
import { laAnhCuaSan } from '@common/public-url';

/**
 * Người kia trong khung chat, chỉ phần client cần: tên, ảnh, lần cuối online.
 *
 * Bản trước trả nguyên dòng users qua relations buyer/seller/sender: email, số
 * điện thoại, vai trò, token_version, is_locked. Nhắn hỏi giá một món là đọc
 * được email và số điện thoại tài khoản của người bán, trong khi sàn cố ý giữ
 * liên lạc trong khung chat. Cột giữ lại theo đúng thứ web và app đọc (kiểm
 * 26/10: partner_name, partner_avatar, partner_last_seen, sender.id). Lọc ở đây
 * chứ không SELECT, vì getMyConversations đếm số câu truy vấn
 * (chat.service.spec.ts) và đổi cách nạp quan hệ là đổi con số đó.
 */
function nguoiTrongChat(u: User | null | undefined): User {
  if (!u) return u as unknown as User;
  // Tài khoản đã xoá mềm: giữ id (client dựa vào sender.id để biết tin nào của
  // mình) nhưng không trả tên, ảnh của người đã rời sàn.
  if (u.deleted_at) {
    return {
      id: u.id,
      full_name: TEN_TAI_KHOAN_DA_XOA,
      avatar: null,
      last_seen: null,
    } as unknown as User;
  }
  return {
    id: u.id,
    full_name: u.full_name,
    avatar: u.avatar,
    last_seen: u.last_seen,
  } as User;
}

/** Tên hiển thị thay cho người kia khi tài khoản đó đã bị xoá. */
const TEN_TAI_KHOAN_DA_XOA = 'Tài khoản đã xoá';

/**
 * Nạp hội thoại KÈM người đã xoá mềm (`withDeleted`).
 *
 * `users` xoá mềm, nên nạp quan hệ thường thì người đã xoá thành `null`, và
 * mọi chỗ đọc `conversation.buyer.id` ném TypeError: người còn lại mở hội
 * thoại cũ nhận 500 (rà soát 27/10, đo bằng `chat-nguoi-da-xoa.spec.ts`).
 * Nạp kèm thì quan hệ luôn có `id` để kiểm thành viên, và `deleted_at` để biết
 * người kia đã đi. Bảng conversations không xoá mềm nên `withDeleted` không
 * kéo thêm hội thoại nào.
 */
const NAP_HOI_THOAI: Pick<
  FindOneOptions<Conversation>,
  'relations' | 'withDeleted'
> = {
  relations: ['buyer', 'seller'],
  withDeleted: true,
};

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
      relations: ['seller'],
    });
    if (!product) {
      throw new NotFoundException('Không tìm thấy sản phẩm');
    }

    // NGƯỜI BÁN LẤY TỪ SẢN PHẨM, KHÔNG LẤY TỪ BODY.
    //
    // Bản trước dùng nguyên seller_id client gửi, nên mở được hội thoại "về
    // sản phẩm X" với một người bất kỳ không liên quan tới X: nhắn rác tới ai
    // cũng được, kèm sản phẩm của người khác cho trông như thật. Web và app
    // đều gửi seller_id đúng là người bán của sản phẩm, nên seller_id trong
    // body giờ chỉ còn dùng để chặn ca tự nhắn với mình; giữ trường đó trong
    // DTO để client cũ không bị forbidNonWhitelisted từ chối.
    const sellerId = product.seller?.id;
    if (!sellerId) {
      throw new BadRequestException('Sản phẩm không có người bán');
    }
    if (sellerId === user.id || seller_id === user.id) {
      throw new BadRequestException('Bạn không thể nhắn tin với chính mình');
    }

    // Kiểm tra đã có conversation giữa buyer và seller về product này chưa
    const existing = await this.conversationRepository.findOne({
      where: {
        buyer: { id: user.id },
        seller: { id: sellerId },
        product: { id: product_id },
      },
    });

    if (existing) {
      return existing; // Đã có rồi thì trả về luôn
    }

    const conversation = this.conversationRepository.create({
      buyer: { id: user.id },
      seller: { id: sellerId },
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
      // KHÔNG `withDeleted` ở đây (khác NAP_HOI_THOAI): danh sách còn nạp
      // `product`, và nạp kèm bản ghi đã xoá là hiện lại cả sản phẩm đã gỡ.
      // Người kia đã xoá thì quan hệ là null: hiện "Tài khoản đã xoá" thay
      // vì một dòng không tên.
      const partner = (isBuyer ? conv.seller : conv.buyer) ?? {
        full_name: TEN_TAI_KHOAN_DA_XOA,
      };
      return {
        id: conv.id,
        created_at: conv.created_at,
        updated_at: conv.updated_at,
        buyer: nguoiTrongChat(conv.buyer),
        seller: nguoiTrongChat(conv.seller),
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
   * Tin nhắn cuối của NHIỀU hội thoại trong MỘT câu, và database chỉ trả đúng
   * MỘT dòng mỗi hội thoại.
   *
   * Bản trước dùng `ROW_NUMBER() OVER (PARTITION BY conversation_id)`: đúng,
   * nhưng nó xếp hạng MỌI tin của cả 20 hội thoại rồi trả TẤT CẢ về Node (kèm
   * `content` TEXT) để Node vứt hết trừ hạng 1. Đo 28/10 trên một hội thoại
   * 2000 tin: câu đó trả 2004 dòng để giữ 3 (`chat-tin-cuoi-nhieu-tin.spec.ts`).
   * Hai người nhắn nhau một năm là vài nghìn tin; 20 hội thoại như thế là vài
   * chục nghìn dòng TEXT trên heap 384MB của một bản api, cho một lần mở tab.
   *
   * Nay ba tầng, tầng nào cũng chỉ chạm vài mục index:
   *   1. `x`: MAX(created_at) theo hội thoại. Trên idx_conversation_created
   *      (conversation_id, created_at) MySQL đọc kiểu "skip scan for
   *      grouping": MỘT mục index mỗi hội thoại, bất kể hội thoại dài bao nhiêu.
   *   2. `y`: trong các tin đúng mốc đó, lấy MAX(id). Chính là vế chốt thứ tự
   *      `created_at DESC, id DESC` của bản cũ: hai tin cùng mốc thì id lớn hơn
   *      là tin sau, và join ngược theo mốc giờ không bao giờ trả HAI dòng.
   *   3. Nạp đúng dòng đó theo khoá chính.
   *
   * VÌ SAO KHÔNG DÙNG `JOIN LATERAL (... ORDER BY created_at DESC, id DESC
   * LIMIT 1)` hay subquery tương quan cùng kiểu. Đã thử trên MySQL 8.4 (bản
   * production dùng `mysql:8`): đứng một mình thì nó đọc index ngược và dừng
   * ở dòng đầu, nhưng khi `conversation_id` đến từ bảng ngoài thì optimizer
   * chuyển sang "Sort ... limit input to 1 row(s) per chunk", tức đọc HẾT mục
   * index của hội thoại rồi mới sắp xếp. Lại thành O(số tin), chỉ là trong
   * MySQL thay vì trong Node.
   *
   * KHÔNG lấy thẳng MAX(id): tin chèn sau mà mang mốc giờ sớm hơn (nhập dữ
   * liệu, đồng bộ lệch giờ) sẽ bị chọn nhầm. Bài kiểm có đúng ca đó.
   */
  private async tinNhanCuoiTheoLo(
    ids: number[],
  ): Promise<Map<number, Message>> {
    const m = new Map<number, Message>();
    if (!ids.length) return m;

    const rows = await this.messageRepository.query<
      Array<Record<string, unknown>>
    >(
      `SELECT m.id, m.conversation_id, m.sender_id, m.content, m.is_read,
              m.created_at
         FROM messages m
         JOIN (SELECT m1.conversation_id, MAX(m1.id) AS id
                 FROM messages m1
                 JOIN (SELECT conversation_id, MAX(created_at) AS t
                         FROM messages
                        WHERE conversation_id IN (?)
                        GROUP BY conversation_id) x
                   ON m1.conversation_id = x.conversation_id
                  AND m1.created_at = x.t
                GROUP BY m1.conversation_id) y
           ON m.id = y.id`,
      [ids],
    );

    for (const r of rows) {
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
      ...NAP_HOI_THOAI,
    });

    if (!conversation) {
      throw new NotFoundException('Không tìm thấy cuộc trò chuyện');
    }

    // Kiểm tra user có trong cuộc trò chuyện này không
    if (
      conversation.buyer?.id !== user.id &&
      conversation.seller?.id !== user.id
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
      // Tin của người đã xoá vẫn phải có `sender.id`, xem NAP_HOI_THOAI.
      withDeleted: true,
      order: { created_at: 'DESC' },
    });

    return {
      meta: {
        current: numPage,
        pageSize: numLimit,
        pages: Math.ceil(totalItems / numLimit),
        total: totalItems,
      },
      // Đảo ngược để tin nhắn cũ lên đầu; sender chỉ còn phần công khai.
      result: result
        .reverse()
        .map((m) => ({ ...m, sender: nguoiTrongChat(m.sender) })),
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
      ...NAP_HOI_THOAI,
    });

    if (!conversation) {
      throw new NotFoundException('Không tìm thấy cuộc trò chuyện');
    }

    if (
      conversation.buyer?.id !== user.id &&
      conversation.seller?.id !== user.id
    ) {
      throw new BadRequestException(
        'Bạn không phải là thành viên của cuộc trò chuyện này',
      );
    }

    // Người kia đã xoá tài khoản: không ai đọc tin này nữa. 400 kèm lý do chứ
    // không lặng lẽ lưu một tin không bao giờ tới.
    const nguoiKia =
      conversation.buyer?.id === user.id
        ? conversation.seller
        : conversation.buyer;
    if (!nguoiKia || nguoiKia.deleted_at) {
      throw new BadRequestException(
        'Người này đã xoá tài khoản Zoldify nên không nhận được tin nhắn nữa.',
      );
    }

    const { content, images } = sendMessageDto;

    // Ảnh chat thật luôn tải qua POST /files/upload, tức nằm trên host của sàn.
    // URL trỏ ra máy chủ khác là ảnh theo dõi (lộ IP, giờ mở tin của người
    // nhận), ảnh đổi nội dung sau khi gửi (sàn mất bằng chứng), hoặc
    // javascript:/data: chờ một client render không cẩn thận. Kiểm ở service để
    // cả HTTP lẫn socket đều đi qua.
    if ((images ?? []).some((u) => !laAnhCuaSan(u, process.env))) {
      throw new BadRequestException(
        'Ảnh đính kèm phải được tải lên qua Zoldify',
      );
    }

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
      ...NAP_HOI_THOAI,
    });

    // Cùng điều kiện thành viên với getMessages/sendMessage. Bản trước không
    // kiểm, nên ai đăng nhập cũng xoá được chấm đỏ của hội thoại người khác.
    // Người ngoài nhận CÙNG 404 như id không tồn tại: hai câu khác nhau là
    // cho người ngoài dò được id hội thoại nào có thật.
    if (
      !conversation ||
      (conversation.buyer?.id !== user.id &&
        conversation.seller?.id !== user.id)
    ) {
      throw new NotFoundException('Không tìm thấy cuộc trò chuyện');
    }

    // Chỉ đánh dấu tin của NGƯỜI KIA. Bản trước đánh dấu mọi tin chưa đọc, kể
    // cả tin người gọi vừa gửi: người mua mở hội thoại là tin của họ thành đã
    // đọc, người bán không bao giờ thấy chấm đỏ. Đếm chưa đọc
    // (getUnreadCount, demChuaDocTheoLo) đã loại tin của chính mình từ lâu.
    await this.messageRepository
      .createQueryBuilder()
      .update(Message)
      .set({ is_read: true })
      .where('conversation_id = :conversationId', { conversationId })
      .andWhere('is_read = 0')
      .andWhere('sender_id <> :userId', { userId: user.id })
      .execute();

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
