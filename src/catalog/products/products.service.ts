import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from '@nestjs/cache-manager';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Product } from './entities/product.entity';
import { Follow } from '@catalog/follows/entities/follow.entity';
import { Shop } from '@catalog/shop/entities/shop.entity';
import { Repository, ILike, Between } from 'typeorm';
import { IUser } from '@identity/users/users.interface';
import { formatMoney } from '@common/money';
import { normalizePagination } from '@common/dto/pagination.dto';
import { NotificationsService } from '@messaging/notifications/notifications.service';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(Follow)
    private readonly followRepository: Repository<Follow>,
    @InjectRepository(Shop)
    private readonly shopRepository: Repository<Shop>,
    private readonly notificationsService: NotificationsService,
    @Inject(CACHE_MANAGER)
    private cacheManager: Cache,
  ) {}

  /**
   * Chặn đăng bán khi người bán CHƯA khai địa chỉ lấy hàng.
   *
   * Sàn C2C: mỗi người bán tự gửi từ địa chỉ của mình. Thiếu pickup thì vận đơn
   * GHN buộc phải fallback về shop nền tảng — hàng bị coi như gửi từ chỗ khác,
   * người bán không giao được đúng. Chặn ngay từ lúc đăng, giống Shopee bắt khai
   * địa chỉ lấy hàng trước khi mở bán. Kiểm ĐÚNG 6 trường mà createOrder GHN cần.
   */
  private async assertSellerHasPickup(userId: number): Promise<void> {
    const shop = await this.shopRepository.findOne({
      where: { user: { id: userId } },
    });
    const ok =
      shop &&
      shop.pickup_name &&
      shop.pickup_phone &&
      shop.pickup_address &&
      shop.pickup_ward_name &&
      shop.pickup_district_name &&
      shop.pickup_province_name;
    if (!ok) {
      throw new BadRequestException(
        'Bạn cần khai địa chỉ lấy hàng ở Cài đặt shop trước khi đăng bán.',
      );
    }
  }

  async create(createProductDto: CreateProductDto, user: IUser) {
    await this.assertSellerHasPickup(user.id);

    // DANH SÁCH TRẮNG: trường nào không có tên ở đây thì KHÔNG được lưu, dù DTO
    // đã nhận và đã kiểm hợp lệ. `currency` vừa thêm dính đúng bẫy này — gửi
    // "USD" lên, API trả 201 như bình thường, mà bản ghi lưu xuống là "VND".
    // Không có lỗi nào ở đâu để mà thấy.
    const {
      name,
      price,
      currency,
      image,
      images,
      description,
      slug,
      category_id,
      brand,
      spec,
      stock,
      condition,
      is_freeship,
    } = createProductDto;
    const firstImage = image || (images?.length ? images[0] : undefined);
    const newProduct = this.productRepository.create({
      condition,
      name,
      price,
      // Bỏ trống thì để entity áp mặc định, đừng ghi đè bằng undefined.
      ...(currency ? { currency } : {}),
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
        this.notificationsService
          .create({
            user_id: f.follower_id,
            type: 'new_product' as any,
            title: `${user.full_name || 'Shop'} vừa đăng sản phẩm mới`,
            // Không ghép cứng chữ "đ": một món niêm yết bằng USD mà báo cho người
            // theo dõi là "2.400đ" thì sai lệch hơn hai mươi lần.
            content: `${name} — ${formatMoney(price, currency)}`,
            data: { product_id: saved.id, seller_id: user.id },
          })
          .catch(() => null),
      ),
    );

    return this.findOne(saved.id);
  }

  async findAll(currentPage: string, limit: string, qs: any) {
    // Chặn tham số phân trang: ?pageSize=1000000 sẽ take(1000000) nạp cả kho vào
    // RAM. Ép về [1, MAX_PAGE_SIZE], page ≥ 1, loại NaN/âm (dùng chung với orders).
    const {
      page: numPage,
      size: numLimit,
      offset,
    } = normalizePagination(currentPage, limit);

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
      const qb = this.productRepository
        .createQueryBuilder('product')
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
        qb.andWhere('product.category_id = :catId', {
          catId: Number(qs.category_id),
        });
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
      qb.skip(offset).take(numLimit);

      [result, totalItems] = await qb.getManyAndCount();
    } else {
      const where: any = {};
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
        relations: { category: true, seller: true },
        /**
         * CHỈ lấy vài cột của người bán và danh mục.
         *
         * Trước đây nạp nguyên bản ghi users cho MỖI sản phẩm, trên một endpoint
         * công khai không cần đăng nhập. Đo được: email và số điện thoại người
         * bán lộ ra với bất kỳ ai gọi API, và riêng đối tượng seller chiếm 43%
         * gói tin (532 byte/sản phẩm trong gói 24,6 KB).
         *
         * Ô hàng trong lưới chỉ cần tên và ảnh đại diện người bán. Không liệt kê
         * cột nào của chính sản phẩm ở đây — bỏ trống thì TypeORM lấy đủ, nên
         * thêm cột mới cho products sau này không phải sửa lại chỗ này.
         */
        select: {
          seller: { id: true, full_name: true, avatar: true },
          category: { id: true, name: true, slug: true },
        },
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
      relations: { category: true, seller: true },
      // Cùng lý do với findAll: trang chi tiết cũng công khai, nên chỉ đưa ra
      // phần người mua cần thấy về người bán. Bản trước trả cả email,
      // phone_number, email_verified, is_locked, token_version.
      select: {
        seller: { id: true, full_name: true, avatar: true, last_seen: true },
        category: { id: true, name: true, slug: true },
      },
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
    await this.productRepository.softDelete(id);
    return { id, deleted: true };
  }

  async updateStock(
    productId: number,
    stock: number,
    userId: number,
    isAdmin: boolean,
  ) {
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
