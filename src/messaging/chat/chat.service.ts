import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not } from 'typeorm';
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
  async createConversation(createConversationDto: CreateConversationDto, user: IUser) {
    const { seller_id, product_id } = createConversationDto;

    const product = await this.productRepository.findOne({ where: { id: product_id } });
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

  // Lấy danh sách cuộc trò chuyện của user hiện tại
  async getMyConversations(user: IUser) {
    const conversations = await this.conversationRepository.find({
      where: [
        { buyer: { id: user.id } },
        { seller: { id: user.id } },
      ],
      relations: ['buyer', 'seller', 'product'],
      order: { updated_at: 'DESC' },
    });

    // Gắn thêm tin nhắn cuối cùng và số tin chưa đọc cho mỗi conversation
    const result = await Promise.all(
      conversations.map(async (conv) => {
        const lastMessage = await this.messageRepository.findOne({
          where: { conversation: { id: conv.id } },
          order: { created_at: 'DESC' },
        });

        // Đếm tin nhắn chưa đọc (không tính tin do user này gửi)
        const unreadCount = await this.messageRepository.count({
          where: {
            conversation: { id: conv.id },
            is_read: false,
            sender: { id: Not(user.id) },
          },
        });

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
          last_message: lastMessage,
          unread_count: unreadCount,
        };
      }),
    );

    return { result };
  }

  // Lấy tin nhắn trong 1 cuộc trò chuyện
  async getMessages(conversationId: number, currentPage: string, limit: string, user: IUser) {
    const conversation = await this.conversationRepository.findOne({
      where: { id: conversationId },
      relations: ['buyer', 'seller'],
    });

    if (!conversation) {
      throw new NotFoundException('Không tìm thấy cuộc trò chuyện');
    }

    // Kiểm tra user có trong cuộc trò chuyện này không
    if (conversation.buyer.id !== user.id && conversation.seller.id !== user.id) {
      throw new BadRequestException('Bạn không phải là thành viên của cuộc trò chuyện này');
    }

    const numPage = currentPage ? parseInt(currentPage) : 1;
    const numLimit = limit ? parseInt(limit) : 20;
    const offset = (numPage - 1) * numLimit;

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
  async sendMessage(conversationId: number, sendMessageDto: SendMessageDto, user: IUser) {
    const conversation = await this.conversationRepository.findOne({
      where: { id: conversationId },
      relations: ['buyer', 'seller'],
    });

    if (!conversation) {
      throw new NotFoundException('Không tìm thấy cuộc trò chuyện');
    }

    if (conversation.buyer.id !== user.id && conversation.seller.id !== user.id) {
      throw new BadRequestException('Bạn không phải là thành viên của cuộc trò chuyện này');
    }

    const { content, images } = sendMessageDto;

    const message = this.messageRepository.create({
      conversation: { id: conversationId },
      sender: { id: user.id },
      content,
      images,
    });

    // Cập nhật updated_at của conversation
    await this.conversationRepository.update(conversationId, { updated_at: new Date() });

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
  async getUnreadCount(user: IUser) {
    const conversations = await this.conversationRepository.find({
      where: [
        { buyer: { id: user.id } },
        { seller: { id: user.id } },
      ],
    });

    const conversationIds = conversations.map((c) => c.id);

    if (conversationIds.length === 0) {
      return { unread_count: 0 };
    }

    const count = await this.messageRepository
      .createQueryBuilder('message')
      .where('message.conversation_id IN (:...ids)', { ids: conversationIds })
      .andWhere('message.is_read = :is_read', { is_read: false })
      .andWhere('message.sender_id != :userId', { userId: user.id })
      .getCount();

    return { unread_count: count };
  }
}
