import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from '@nestjs/cache-manager';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Product, ProductStatus } from './entities/product.entity';
import { Follow } from '../follows/entities/follow.entity';
import { Repository, ILike, Between, Not } from 'typeorm';
import { IUser } from 'src/users/users.interface';
import { NotificationsService } from '../notifications/notifications.service';


@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(Follow)
    private readonly followRepository: Repository<Follow>,
    private readonly notificationsService: NotificationsService,
    @Inject(CACHE_MANAGER)
    private cacheManager: Cache,
  ) { }

  async create(createProductDto: CreateProductDto, user: IUser) {
    const { name, price, image, images, description, slug, category_id, brand, spec, stock, condition, is_freeship } = createProductDto;
    const firstImage = image || (images?.length ? images[0] : undefined);
    const newProduct = this.productRepository.create({
      condition,
      name,
      price,
      image: firstImage,
      images: images || (image ? [image] : undefined),
      description,
      slug,
      category: { id: category_id },
      seller: { id: user.id },
      brand,
      spec,
      stock,
      is_freeship: is_freeship || false,
    });
    const saved = await this.productRepository.save(newProduct);

    // Notify all followers of the seller
    const followers = await this.followRepository.find({
      where: { following_id: user.id },
      select: ['follower_id'],
    });
    await Promise.all(
      followers.map((f) =>
        this.notificationsService.create({
          user_id: f.follower_id,
          type: 'new_product' as any,
          title: `${user.full_name || 'Shop'} vừa đăng sản phẩm mới`,
          content: `${name} — ${Number(price).toLocaleString('vi-VN')}đ`,
          data: { product_id: saved.id, seller_id: user.id },
        }).catch(() => null)
      )
    );

    return this.findOne(saved.id);
  }

  async findAll(currentPage: string, limit: string, qs: any) {
    const numPage = currentPage ? parseInt(currentPage) : 1;
    const numLimit = limit ? parseInt(limit) : 10;
    const offset = (numPage - 1) * numLimit;

    let order: any = { created_at: 'DESC' };
    if (qs.sort === 'price_asc') {
      order = { price: 'ASC' };
    } else if (qs.sort === 'price_desc') {
      order = { price: 'DESC' };
    } else if (qs.sort === 'newest') {
      order = { created_at: 'DESC' };
    } else if (qs.sort === 'best_selling') {
      order = { sold_count: 'DESC' };
    } else if (qs.sort === 'most_viewed') {
      order = { view_count: 'DESC' };
    } else if (qs.sort === 'featured') {
      order = { sold_count: 'DESC', view_count: 'DESC' };
    }

    let result, totalItems;

    if (qs.q) {
      const rawQ = String(qs.q).trim();
      const qb = this.productRepository.createQueryBuilder('product')
        .leftJoinAndSelect('product.category', 'category');

      if (rawQ.length >= 4) {
        const safeQ = rawQ
          .replace(/[+\-><()~*"@]/g, ' ')
          .trim()
          .split(/\s+/)
          .filter((w) => w.length >= 2)
          .map((w) => `${w}*`)
          .join(' ');
        if (safeQ) {
          qb.where(
            'MATCH(product.name, product.description) AGAINST (:q IN BOOLEAN MODE)',
            { q: safeQ },
          );
        } else {
          qb.where('product.name LIKE :q', { q: `%${rawQ}%` });
        }
      } else {
        qb.where('product.name LIKE :q', { q: `%${rawQ}%` });
      }

      if (qs.category_id) {
        qb.andWhere('product.category_id = :catId', { catId: Number(qs.category_id) });
      }
      if (qs.price_min) {
        qb.andWhere('product.price >= :pmin', { pmin: Number(qs.price_min) });
      }
      if (qs.price_max) {
        qb.andWhere('product.price <= :pmax', { pmax: Number(qs.price_max) });
      }

      const orderField = Object.keys(order)[0];
      const orderDir = order[orderField];
      qb.orderBy(`product.${orderField}`, orderDir);
      if (qs.sort === 'featured') {
        qb.addOrderBy('product.view_count', 'DESC');
      }
      qb.andWhere('product.status != :banned', { banned: ProductStatus.BANNED });
      qb.skip(offset).take(numLimit);

      [result, totalItems] = await qb.getManyAndCount();
    } else {
      const where: any = { status: Not(ProductStatus.BANNED) };
      if (qs.category_id) {
        where.category = { id: Number(qs.category_id) };
      }
      if (qs.seller_id) {
        where.seller = { id: Number(qs.seller_id) };
      }
      if (qs.price_min || qs.price_max) {
        const min = qs.price_min ? Number(qs.price_min) : 0;
        const max = qs.price_max ? Number(qs.price_max) : 999999999;
        where.price = Between(min, max);
      }
      [result, totalItems] = await this.productRepository.findAndCount({
        where,
        skip: offset,
        take: numLimit,
        order,
        relations: ['category', 'seller'],
      });
    }

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
    const product = await this.productRepository.findOne({
      where: { id },
      relations: ['category', 'seller'], // Tự động load đầy đủ thông tin danh mục và người bán sản phẩm
    });
    if (!product) {
      throw new NotFoundException(`Không tìm thấy sản phẩm có ID #${id}!`);
    }
    // TODO: re-enable view_count tracking khi có Redis hoặc batch job
    // Lý do: increment() mỗi lần GET sẽ race condition khi nhiều request đồng thời,
    // và gây write amplification trên mỗi lượt xem chi tiết sản phẩm.
    // Giải pháp tương lai: dùng Redis INCR + flush về MySQL theo batch (5-10 phút/lần),
    // hoặc đẩy vào message queue xử lý async.
    // await this.productRepository.increment({ id }, 'view_count', 1);
    return product;
  }

  async update(id: number, updateProductDto: UpdateProductDto, user: IUser) {
    const product = await this.productRepository.findOne({
      where: { id },
      relations: ['seller'],
    });
    if (!product) {
      throw new NotFoundException(`Không tìm thấy sản phẩm có ID #${id}!`);
    }

    // Ownership check: chỉ owner hoặc admin
    if (user.role !== 'admin' && product.seller.id !== user.id) {
      throw new ForbiddenException('Bạn không có quyền sửa sản phẩm này');
    }

    // Nếu trong dữ liệu update có category_id, map nó sang quan hệ Object
    const { category_id, ...restDto } = updateProductDto as any;
    const updateData: any = { ...restDto };
    if (category_id) {
      updateData.category = { id: category_id };
    }

    await this.productRepository.update(id, updateData);
    return await this.findOne(id);
  }

  async remove(id: number, user: IUser) {
    const product = await this.productRepository.findOne({
      where: { id },
      relations: ['seller'],
    });
    if (!product) {
      throw new NotFoundException(`Không tìm thấy sản phẩm! `);
    }
    if (user.role !== 'admin' && product.seller.id !== user.id) {
      throw new ForbiddenException('Bạn không có quyền xóa sản phẩm này');
    }
    await this.productRepository.update(id, { status: ProductStatus.BANNED });
    return { id, deleted: true };
  }

  async updateStock(productId: number, stock: number, userId: number, isAdmin: boolean) {
    const product = await this.productRepository.findOne({
      where: { id: productId },
      relations: ['seller'],
    });
    if (!product) throw new NotFoundException('Không tìm thấy sản phẩm');

    // Auth check: chỉ owner hoặc admin
    if (!isAdmin && product.seller.id !== userId) {
      throw new ForbiddenException('Bạn không có quyền sửa sản phẩm này');
    }

    product.stock = stock;
    await this.productRepository.save(product);
    return product;
  }
}
