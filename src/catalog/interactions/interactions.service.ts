import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { normalizePagination } from '@common/dto/pagination.dto';
import { User } from '@identity/users/entities/user.entity';
import { Product } from '@catalog/products/entities/product.entity';
import { Review } from './entities/review.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IUser } from '@identity/users/users.interface';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { Order, OrderStatus } from '@ordering/orders/entities/order.entity';

/**
 * Đánh giá trả ra ngoài chỉ kèm id, tên, ảnh của người viết.
 *
 * Cả ba route đọc đánh giá (GET /interactions/product/:id là @Public, GET
 * /interactions và /interactions/:id chỉ cần đăng nhập) từng trả nguyên User:
 * ai cũng gom được email và số điện thoại của mọi người từng đánh giá (tìm ra
 * khi soát lỗi H-01 và review 06/10). Một hàm cho cả ba để route sau này thêm
 * vào không quên lọc.
 */
function withPublicUser<T extends { user?: User | null }>(review: T) {
  const u = review.user;
  return {
    ...review,
    user: u ? { id: u.id, full_name: u.full_name, avatar: u.avatar } : null,
  };
}

@Injectable()
export class InteractionsService {
  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(Review)
    private readonly reviewRepository: Repository<Review>,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
  ) {}

  async create(createInteractionDto: CreateReviewDto, user: IUser) {
    const { product_id, order_id, rating, comment, images } =
      createInteractionDto;
    const product = await this.productRepository.findOne({
      where: { id: product_id },
    });

    if (!product) {
      throw new NotFoundException('Không tìm thấy sản phẩm');
    }
    const hasPurchased = await this.orderRepository
      .createQueryBuilder('order')
      .innerJoin('order.items', 'item')
      .where('order.id = :orderId', { orderId: order_id })
      .andWhere('order.user = :userId', { userId: user.id })
      .andWhere('order.status = :status', { status: OrderStatus.DELIVERED })
      .andWhere('item.product_id = :productId', { productId: product_id })
      .getOne();
    if (!hasPurchased) {
      throw new BadRequestException(
        'Bạn chưa mua sản phẩm này hoặc đơn hàng chưa giao',
      );
    }

    // withDeleted: khoá UNIQUE idx_user_product tính cả dòng đã xoá mềm. Bỏ qua
    // dòng đó ở đây thì INSERT bên dưới đâm vào khoá và trả 500 (test máy ảo
    // 07/10: người mua xoá đánh giá rồi viết lại).
    const existing = await this.reviewRepository.findOne({
      where: { user: { id: user.id }, product: { id: product_id } },
      withDeleted: true,
      select: { id: true, deleted_at: true },
    });
    if (existing && !existing.deleted_at) {
      throw new BadRequestException('Bạn đã đánh giá sản phẩm này rồi');
    }
    if (existing) {
      // Dùng lại đúng dòng cũ: ghi đè nội dung, bỏ dấu xoá, tính ngày viết từ
      // bây giờ để nó đứng đầu danh sách như một đánh giá mới.
      await this.reviewRepository.restore(existing.id);
      await this.reviewRepository.update(existing.id, {
        order: { id: order_id },
        rating,
        comment,
        images: images ?? [],
        created_at: new Date(),
      });
      await this.refreshProductStats(product_id);
      return this.reviewRepository.findOneOrFail({
        where: { id: existing.id },
      });
    }

    const review = this.reviewRepository.create({
      product,
      order: { id: order_id },
      user: { id: user.id },
      rating,
      comment,
      images,
    });

    const saved = await this.reviewRepository.save(review);
    await this.refreshProductStats(product_id);
    return saved;
  }

  /**
   * Tính lại điểm trung bình và số lượt đánh giá của MỘT sản phẩm từ bảng
   * reviews (bỏ bản đã xoá mềm). Gọi sau mọi thao tác đổi đánh giá.
   *
   * Tính lại toàn phần chứ không cộng trừ dần: cộng trừ thì một lần lỗi giữa
   * chừng là lệch vĩnh viễn, còn tính lại thì lần sau tự đúng. Một sản phẩm có
   * vài trăm đánh giá, AVG/COUNT theo index product_id là rẻ.
   */
  private async refreshProductStats(productId: number): Promise<void> {
    await this.productRepository.query(
      `UPDATE products SET
         rating_avg = COALESCE((SELECT ROUND(AVG(r.rating), 2) FROM reviews r
                                WHERE r.product_id = ? AND r.deleted_at IS NULL), 0),
         review_count = (SELECT COUNT(*) FROM reviews r
                         WHERE r.product_id = ? AND r.deleted_at IS NULL)
       WHERE id = ?`,
      [productId, productId, productId],
    );
  }

  /**
   * Uy tín người bán, dựng từ số THẬT của các sản phẩm họ đăng: điểm trung bình
   * có trọng số theo số lượt đánh giá, tổng lượt đánh giá, tổng đã bán.
   *
   * Thay cho sellerStats() giả ở app (lỗi H-01), vốn còn có "% phản hồi". Chỉ số
   * đó không có dữ liệu nào đứng sau (không đo thời gian trả lời tin nhắn), nên
   * KHÔNG trả ra thay vì bịa.
   */
  async sellerStats(sellerId: number) {
    const rows = await this.productRepository.query<
      Array<{ c: string | number | null; s: string | number | null }>
    >(
      `SELECT SUM(review_count) AS c, SUM(rating_avg * review_count) AS s
       FROM products WHERE seller_id = ? AND deleted_at IS NULL`,
      [sellerId],
    );
    // "Đã bán" đếm số món trong đơn ĐÃ GIAO, không đọc products.sold_count:
    // không có dòng mã nào ghi cột đó (soát 06/10), nên nó luôn 0.
    const sold = await this.productRepository.query<
      Array<{ n: string | number | null }>
    >(
      `SELECT SUM(oi.quantity) AS n
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN products p ON p.id = oi.product_id
       WHERE p.seller_id = ? AND o.status = 'delivered'`,
      [sellerId],
    );
    const c = Number(rows[0]?.c ?? 0);
    const s = Number(rows[0]?.s ?? 0);
    return {
      rating: c > 0 ? Math.round((s / c) * 10) / 10 : 0,
      review_count: c,
      sold_count: Number(sold[0]?.n ?? 0),
    };
  }

  async findByProduct(productId: number, currentPage: string, limit: string) {
    const {
      page: numPage,
      size: numLimit,
      offset,
    } = normalizePagination(currentPage, limit);

    const [result, totalItems] = await this.reviewRepository.findAndCount({
      where: { product: { id: productId } },
      skip: offset,
      take: numLimit,
      relations: ['user'],
      order: { created_at: 'DESC' },
    });

    const { avg } = await this.reviewRepository
      .createQueryBuilder('review')
      .select('AVG(review.rating)', 'avg')
      .where('review.product_id = :productId', { productId })
      .getRawOne();

    return {
      meta: {
        current: numPage,
        pageSize: numLimit,
        pages: Math.ceil(totalItems / numLimit),
        total: totalItems,
        average_rating: avg ? Number(Number(avg).toFixed(1)) : 0,
      },
      result: result.map((r) => withPublicUser(r)),
    };
  }

  async findAll(
    currentPage: string,
    limit: string,
    user: IUser,
    mine?: boolean,
  ) {
    const {
      page: numPage,
      size: numLimit,
      offset,
    } = normalizePagination(currentPage, limit);

    // `mine`: đánh giá của chính người gọi. App cần biết món nào trong đơn đã
    // được đánh giá; trước đây nó tự nhớ trên máy (mất khi đổi máy, lỗi H-01).
    const where: any = mine ? { user: { id: user.id } } : {};

    const [result, totalItems] = await this.reviewRepository.findAndCount({
      where,
      skip: offset,
      take: numLimit,
      relations: ['user', 'product'],
      order: { created_at: 'DESC' },
    });

    const totalPages = Math.ceil(totalItems / numLimit);

    return {
      meta: {
        current: numPage,
        pageSize: numLimit,
        pages: totalPages,
        total: totalItems,
      },
      result: result.map((r) => withPublicUser(r)),
    };
  }
  async findOne(id: number) {
    const review = await this.reviewRepository.findOne({
      where: { id },
      relations: ['user', 'product'],
    });

    if (!review) {
      throw new NotFoundException(`Không tìm thấy đánh giá với ID ${id}`);
    }

    return withPublicUser(review);
  }

  async update(id: number, UpdateReviewDto: UpdateReviewDto, user: IUser) {
    const review = await this.reviewRepository.findOne({
      where: { id },
      relations: ['user', 'product'],
    });

    if (!review) {
      throw new NotFoundException(`Không tìm thấy đánh giá với ID ${id}`);
    }

    // Chỉ người tạo hoặc admin mới được sửa
    if (review.user.id !== user.id && user.role !== 'admin') {
      throw new BadRequestException('Bạn không có quyền sửa đánh giá này');
    }

    const { rating, comment, images } = UpdateReviewDto;

    if (rating !== undefined) {
      review.rating = rating;
    }
    if (comment !== undefined) {
      review.comment = comment;
    }
    if (images !== undefined) {
      review.images = images;
    }

    const saved = await this.reviewRepository.save(review);
    if (review.product?.id) await this.refreshProductStats(review.product.id);
    return saved;
  }

  async remove(id: number, user: IUser) {
    const review = await this.reviewRepository.findOne({
      where: { id },
      relations: ['user', 'product'],
    });
    if (!review) {
      throw new NotFoundException(`Không tìm thấy đánh giá! `);
    }
    if (review.user.id !== user.id && user.role !== 'admin') {
      throw new BadRequestException('Bạn không có quyền xóa đánh giá này');
    }
    await this.reviewRepository.softDelete(id);
    if (review.product?.id) await this.refreshProductStats(review.product.id);
    return 'Xóa đánh giá thành công';
  }
}
