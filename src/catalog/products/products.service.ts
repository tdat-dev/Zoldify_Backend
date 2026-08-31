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
import { Repository, Between } from 'typeorm';
import { IUser } from '@identity/users/users.interface';
import { formatMoney } from '@common/money';
import { normalizePagination } from '@common/dto/pagination.dto';
import { NotificationsService } from '@messaging/notifications/notifications.service';

// TTL cache (ms). Detail được XOÁ tường minh khi ghi nên để dài hơn; list KHÔNG
// purge từng key (không liệt kê được key trên Redis một cách an toàn) nên TTL ngắn
// là lưới an toàn cuối chống stale — đúng chốt pre-mortem C4/C5.
const PRODUCT_DETAIL_TTL = 60_000; // 60s
const PRODUCT_LIST_TTL = 30_000; //  30s

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

  // ── Cache FAIL-OPEN ────────────────────────────────────────────────────────
  // Cache là phụ trợ tăng tốc, KHÔNG bao giờ được làm sập request. Mọi lỗi (Redis
  // rớt, timeout, serialize hỏng) đều bị nuốt và coi như cache-miss → đọc thẳng
  // DB. Đây là chốt pre-mortem C3: Redis chết thì app vẫn phục vụ, không throw.
  private detailKey(id: number): string {
    return `product:${id}`;
  }

  private async cacheGet<T>(key: string): Promise<T | undefined> {
    try {
      const v = await this.cacheManager.get<T>(key);
      return v ?? undefined;
    } catch {
      return undefined; // fail-open: coi như miss
    }
  }

  private async cacheSet(
    key: string,
    value: unknown,
    ttl: number,
  ): Promise<void> {
    try {
      await this.cacheManager.set(key, value, ttl);
    } catch {
      /* fail-open: không lưu được cũng không sao, DB vẫn phục vụ */
    }
  }

  private async cacheDel(key: string): Promise<void> {
    try {
      await this.cacheManager.del(key);
    } catch {
      /* fail-open */
    }
  }

  // wrap() của cache-manager là SINGLE-FLIGHT: nhiều request cùng miss một key sẽ
  // gộp thành DUY NHẤT một lần chạy loader (đo được: 1000 lời gọi đồng thời → 1
  // truy vấn DB), 999 cái còn lại chờ chung kết quả. Đây là thuốc trị thundering
  // herd (pre-mortem C5). Vẫn giữ fail-open (C3): cache lỗi → chạy loader thẳng DB.
  private async cacheWrap<T>(
    key: string,
    ttl: number,
    loader: () => Promise<T>,
  ): Promise<T> {
    try {
      return await this.cacheManager.wrap(key, loader, ttl);
    } catch {
      return loader();
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

    // Cache danh sách công khai (đọc-nhiều-đổi-ít). Key gồm ĐỦ mọi tham số ảnh
    // hưởng kết quả (pre-mortem C2: thiếu 1 tham số = trả nhầm trang cho request
    // khác). Endpoint @Public() không phụ thuộc user nên không rò dữ liệu cá nhân.
    const cacheKey =
      'products:list:' +
      JSON.stringify({
        page: numPage,
        size: numLimit,
        sort: qs.sort || '',
        q: qs.q || '',
        cat: qs.category_id || '',
        seller: qs.seller_id || '',
        pmin: qs.price_min || '',
        pmax: qs.price_max || '',
      });
    return this.cacheWrap(cacheKey, PRODUCT_LIST_TTL, () =>
      this.queryProductList(numPage, numLimit, offset, qs),
    );
  }

  // Truy vấn DANH SÁCH thực sự (phần nặng: filter + phân trang + đếm tổng). Tách
  // riêng để findAll bọc cache single-flight quanh đúng phần này.
  private async queryProductList(
    numPage: number,
    numLimit: number,
    offset: number,
    qs: any,
  ) {
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
    const key = this.detailKey(id);
    const cached = await this.cacheGet<Product>(key);
    if (cached) return cached;

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
    await this.cacheSet(key, product, PRODUCT_DETAIL_TTL);
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
    // Invalidate detail TRƯỚC khi đọc lại: xoá bản cũ để findOne nạp lại bản mới,
    // không để user thấy dữ liệu lỗi thời (pre-mortem C1/C4).
    await this.cacheDel(this.detailKey(id));
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
    await this.cacheDel(this.detailKey(id));
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
    await this.cacheDel(this.detailKey(productId));
    return product;
  }
}
