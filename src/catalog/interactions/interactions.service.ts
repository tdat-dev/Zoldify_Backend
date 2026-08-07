import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { User } from '@identity/users/entities/user.entity';
import { Product } from '@catalog/products/entities/product.entity';
import { Review } from './entities/review.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IUser } from '@identity/users/users.interface';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { Order, OrderStatus } from '@ordering/orders/entities/order.entity';

@Injectable()
export class InteractionsService {
  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    @InjectRepository(Product) private readonly productRepository: Repository<Product>,
    @InjectRepository(Review) private readonly reviewRepository: Repository<Review>,
    @InjectRepository(Order) private readonly orderRepository: Repository<Order>,

  ) { }

  async create(createInteractionDto: CreateReviewDto, user: IUser) {

    const { product_id, order_id, rating, comment, images } = createInteractionDto;
    const product = await this.productRepository.findOne({ where: { id: product_id } });

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
      throw new BadRequestException('Bạn chưa mua sản phẩm này hoặc đơn hàng chưa giao');
    }

    const existing = await this.reviewRepository.findOne({
      where: { user: { id: user.id }, product: { id: product_id } }
    });
    if (existing) {
      throw new BadRequestException('Bạn đã đánh giá sản phẩm này rồi');
    }

    const review = this.reviewRepository.create({
      product,
      order: { id: order_id },
      user: { id: user.id },
      rating,
      comment,
      images,
    });

    return this.reviewRepository.save(review);
  }

  async findByProduct(productId: number, currentPage: string, limit: string) {
    const numPage = currentPage ? parseInt(currentPage) : 1;
    const numLimit = limit ? parseInt(limit) : 10;
    const offset = (numPage - 1) * numLimit;

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
      result,
    };
  }

  async findAll(currentPage: string, limit: string, user: IUser) {
    const numPage = currentPage ? parseInt(currentPage) : 1;
    const numLimit = limit ? parseInt(limit) : 10;
    const offset = (numPage - 1) * numLimit;

    const where: any = {};

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
      result,
    };
  }
  async findOne(id: number) {
    const review = await this.reviewRepository.findOne({
      where: { id },
      relations: ['user', 'product']
    });

    if (!review) {
      throw new NotFoundException(`Không tìm thấy đánh giá với ID ${id}`);
    }

    return review;
  }

  async update(id: number, UpdateReviewDto: UpdateReviewDto, user: IUser) {
    const review = await this.reviewRepository.findOne({
      where: { id },
      relations: ['user']
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

    return this.reviewRepository.save(review);
  }

  async remove(id: number, user: IUser) {
    const review = await this.reviewRepository.findOne({ where: { id }, relations: ['user'] })
    if (!review) {
      throw new NotFoundException(`Không tìm thấy đánh giá! `)
    }
    if (review.user.id !== user.id && user.role !== 'admin') {
      throw new BadRequestException('Bạn không có quyền xóa đánh giá này');
    }
    await this.reviewRepository.softDelete(id);
    return 'Xóa đánh giá thành công';
  }
}
