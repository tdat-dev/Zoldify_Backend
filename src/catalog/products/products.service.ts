import {
  BadRequestException,
  ConflictException,
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
import { Product, ProductStatus } from './entities/product.entity';
import { Follow } from '@catalog/follows/entities/follow.entity';
import { Shop } from '@catalog/shop/entities/shop.entity';
import { Repository, Between } from 'typeorm';
import { IUser } from '@identity/users/users.interface';
import { formatMoney } from '@common/money';
import { normalizePagination } from '@common/dto/pagination.dto';
import { NotificationsService } from '@messaging/notifications/notifications.service';
import Redis from 'ioredis';

// TTL cache (ms). Detail được XOÁ tường minh khi ghi nên để dài hơn.
const PRODUCT_DETAIL_TTL = 60_000; // 60s
const PRODUCT_LIST_TTL = 30_000; //  30s

/**
 * "Đời" của cache danh sách — cách làm mới TẤT CẢ khoá danh sách bằng một lần ghi.
 *
 * VẤN ĐỀ. Khoá cache danh sách gồm 8 tham số (trang, cỡ trang, sắp xếp, từ khoá,
 * danh mục, người bán, khoảng giá). Nhân lên là hàng nghìn khoá, và không liệt kê
 * được: `SCAN` trên Redis vừa đắt vừa không có trong giao diện của cache-manager.
 *
 * Nên trước đây KHÔNG chỗ nào xoá cache danh sách cả — chỉ có TTL 30s đỡ. Hệ quả
 * người dùng thấy: **người bán bấm "Đăng bán" xong, tới 30 giây sau hàng của mình
 * mới hiện ra trong danh sách.** Đó là đánh đổi có ý thức, nhưng chọn sai phía.
 *
 * CÁCH LÀM. Không xoá khoá — ĐỔI KHÔNG GIAN KHOÁ. Mỗi khoá danh sách mang thêm
 * một con số "đời". Ghi sản phẩm thì đặt đời = thời điểm hiện tại; từ đó mọi khoá
 * đời cũ không ai với tới nữa và tự hết hạn theo TTL của chính chúng.
 *
 * VÌ SAO DÙNG `Date.now()` CHỨ KHÔNG PHẢI BỘ ĐẾM TĂNG DẦN. Vì tăng dần cần
 * đọc-rồi-ghi, mà hai người bán ghi cùng lúc sẽ cùng đọc một giá trị rồi cùng ghi
 * đè — mất một nhịp. `Date.now()` chỉ ghi, không đọc, nên không có chỗ đua.
 *
 * VÌ SAO TTL CỦA ĐỜI PHẢI DÀI HƠN HẲN TTL DANH SÁCH. Nếu khoá đời hết hạn trước,
 * nó về lại 0, và những mục cache thời "đời 0" còn sống sẽ SỐNG LẠI. 24 giờ so
 * với 30 giây là khoảng cách đủ để chuyện đó không xảy ra.
 */
const PRODUCT_LIST_GEN_KEY = 'products:list:gen';
const PRODUCT_LIST_GEN_TTL = 24 * 60 * 60_000; // 24h

/** Nhớ "đời" bao lâu trong tiến trình trước khi hỏi lại cache. Xem `doiDanhSach`. */
const DOI_NHO_MS = 1_000;

@Injectable()
export class ProductsService {
  private readonly redis: Redis | null = null;

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
  ) {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      // Fail-open: không có Redis thì bỏ đếm view_count, tuyệt đối không chặn boot
      console.warn('[ProductsService] REDIS_URL không có — bỏ qua đếm view_count');
      return;
    }
    this.redis = new Redis(redisUrl, {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
    });
    this.redis.on('error', (err) => {
      // on('error') chỉ bắt SỰ KIỆN KẾT NỐI, không bắt lệnh bị từ chối.
      // Lệnh incr/get/set bị reject là promise rejection riêng, phải try/catch ở chỗ gọi.
      // Đo được: "Stream isn't writeable and enableOfflineQueue options is false" khi Redis mất.
    });
  }

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

  /**
   * Đời hiện tại của cache danh sách, có NHỚ TRONG TIẾN TRÌNH.
   *
   * VÌ SAO PHẢI NHỚ, DÙ ĐÃ CÓ CACHE.
   *
   * Đọc đời là một lần chạm cache nữa trên mỗi request danh sách. Với cache
   * in-memory thì gần như miễn phí — và đó chính là chỗ suýt đọc nhầm. Đo lại
   * bằng `LOADTEST_REDIS=1 npm run loadtest`, tức đúng cấu hình production:
   *
   *   song song      1      10      50     100
   *   không nhớ    452   1.693   2.201   2.263  rps
   *   bản cũ       607   2.199   2.460   2.506  rps
   *                −26%    −23%    −11%    −10%
   *
   * Một vòng đi-về Redis nữa lấy mất tới một phần tư thông lượng. Nhớ lại trong
   * một giây thì chi phí đó chia cho số request trong giây ấy.
   *
   * ĐÁNH ĐỔI, NÓI RÕ. Khi chạy nhiều bản api: bản A ghi, bản B có thể còn phục
   * vụ danh sách cũ thêm tối đa `DOI_NHO_MS`. Đó là 1 giây, so với 30 giây của
   * cách cũ. Còn chính bản vừa ghi thì thấy ngay, vì `moiDanhSach` cập nhật
   * luôn phần nhớ của nó.
   */
  private doiNho = 0;
  private doiNhoLuc = 0;

  private async doiDanhSach(): Promise<number> {
    const bayGio = Date.now();
    if (bayGio - this.doiNhoLuc < DOI_NHO_MS) return this.doiNho;
    const doi = (await this.cacheGet<number>(PRODUCT_LIST_GEN_KEY)) ?? 0;
    this.doiNho = doi;
    this.doiNhoLuc = bayGio;
    return doi;
  }

  /**
   * Làm mới TOÀN BỘ cache danh sách bằng một lần ghi.
   *
   * Gọi sau MỌI thao tác đổi thứ hiện trong danh sách: đăng mới, sửa, xoá, đổi
   * kho. Không gọi ở chỗ tăng lượt xem — sắp xếp `most_viewed` có hơi cũ đi
   * trong vòng TTL cũng không sao, còn nếu bật đời ở mỗi lượt xem thì cache
   * chẳng còn tác dụng gì nữa.
   *
   * Fail-open như mọi thao tác cache khác: không đặt được đời thì cùng lắm danh
   * sách cũ thêm 30 giây, chứ không được làm hỏng việc đăng bán.
   */
  private async moiDanhSach(): Promise<void> {
    const doi = Date.now();
    // Cập nhật phần nhớ TRƯỚC: bản api vừa ghi phải thấy danh sách mới ngay ở
    // request kế tiếp, không đợi hết một giây nhớ. Đây là trường hợp hay gặp
    // nhất — người bán bấm "Đăng bán" rồi lập tức xem lại danh sách.
    this.doiNho = doi;
    this.doiNhoLuc = doi;
    await this.cacheSet(PRODUCT_LIST_GEN_KEY, doi, PRODUCT_LIST_GEN_TTL);
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
    // Hàng mới phải hiện trong danh sách NGAY, không đợi hết TTL 30 giây.
    await this.moiDanhSach();

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
      `products:list:g${await this.doiDanhSach()}:` +
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

  /**
   * Hàng của CHÍNH người bán đang đăng nhập — đủ mọi trạng thái.
   *
   * Vì sao phải có đường riêng: `findAll` là endpoint CÔNG KHAI (`@Public()`),
   * không có `req.user`, nên nó không phân biệt được "người bán xem hàng của
   * mình" với "người lạ hỏi hàng của người bán đó". Từ 25/09 nó lọc cứng
   * `status = active` để tin nháp và tin bị từ chối duyệt không bày ra cho
   * người ngoài.
   *
   * Nhưng trang "Sản phẩm của tôi" thì CẦN thấy đủ — nó hiện huy hiệu trạng
   * thái cho từng tin (`profile/products/page.tsx`). Nên đường này nhận
   * `sellerId` từ TOKEN chứ không từ query, và trả về mọi trạng thái.
   *
   * KHÔNG CACHE. Người bán vừa sửa tin phải thấy ngay, và đây là trang một
   * người dùng tự xem của mình — không có gì để chia sẻ giữa các request.
   */
  async findMine(sellerId: number, page: number, limit: number) {
    const { size, offset } = normalizePagination(String(page), String(limit));

    const [result, total] = await this.productRepository.findAndCount({
      where: { seller: { id: sellerId } },
      relations: { category: true },
      skip: offset,
      take: size,
      order: { created_at: 'DESC' },
    });

    return {
      meta: {
        current: page,
        pageSize: size,
        pages: Math.ceil(total / size),
        total,
      },
      result,
    };
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

      // Nhánh TÌM KIẾM cũng phải lọc — xem lời giải thích ở nhánh dưới.
      // Thiếu dòng này thì gõ đúng tên một tin đã bị từ chối là thấy nó ngay.
      qb.andWhere('product.status = :active', {
        active: ProductStatus.ACTIVE,
      });

      const orderField = Object.keys(order)[0];
      const orderDir = order[orderField];
      qb.orderBy(`product.${orderField}`, orderDir);
      if (qs.sort === 'featured') {
        qb.addOrderBy('product.view_count', 'DESC');
      }
      qb.skip(offset).take(numLimit);

      [result, totalItems] = await qb.getManyAndCount();
    } else {
      // CHỈ HIỆN HÀNG ĐANG MỞ BÁN.
      //
      // Tới 25/09 không nhánh nào của hàm này lọc `status`. Nên mọi tin `draft`
      // (người bán còn đang soạn), `pending` (chờ duyệt) và `rejected` (đã bị
      // từ chối duyệt) đều hiện ra cho bất kỳ ai mở trang chủ — và vì danh sách
      // sắp theo `created_at DESC`, tin vừa bị từ chối nằm ngay ĐẦU trang.
      //
      // Nặng nhất là `rejected`: quản trị viên vừa từ chối một tin vì nội dung
      // không phù hợp, mà nó vẫn được bày ra.
      //
      // `orders.create` đã chặn MUA hàng không `active` (BUG-10b), nhưng chặn ở
      // cửa sau không xoá được việc nó bày ra ở cửa trước.
      //
      // Người bán xem hàng CỦA CHÍNH MÌNH thì đi qua `findMine()` — có xác
      // thực, và trả về đủ mọi trạng thái kèm huy hiệu.
      const where: any = { status: ProductStatus.ACTIVE };
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

    // Tăng view_count bằng Redis INCR (atomic, không race condition).
    // Key: `view_count:{productId}`. Flush về MySQL theo batch mỗi 5 phút
    // bởi job `flush-view-count` trong worker.
    // BỎ TRƯỚC KHI KIỂM CACHE: TTL 60s khiến chỉ lượt đầu tiên mỗi phút được đếm
    // nếu để sau `if (cached) return cached;` — phá vỡ sort=most_viewed.
    const viewCountKey = `view_count:${id}`;
    if (this.redis) {
      try {
        await this.redis.incr(viewCountKey);
      } catch (err) {
        // on('error') chỉ bắt sự kiện kết nối, không bắt lệnh bị từ chối.
        // Đo được: "Stream isn't writeable and enableOfflineQueue options is false"
        // Fail-open: Redis lỗi không được làm route 500.
      }
    }

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
    await this.moiDanhSach();
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
    await this.moiDanhSach();
    return { id, deleted: true };
  }

  /**
   * Người bán đặt lại số tồn kho.
   *
   * ĐỌC RỒI GHI CẢ ENTITY LÀ CÁCH XOÁ SẠCH CÔNG CHỐNG ĐUA CỦA TASK #2.
   *
   * Bản cũ: `findOne()` → `product.stock = stock` → `save(product)`. Không khoá
   * dòng, không điều kiện, và `save()` ghi **toàn bộ** entity chứ không riêng
   * cột `stock`.
   *
   * `orders.create` trừ kho bằng `UPDATE ... SET stock = stock - n WHERE stock
   * >= n` dưới khoá `FOR UPDATE` — rất chắc. Nhưng chắc tới đâu cũng vô nghĩa
   * nếu có một lần ghi khác đè lên bằng giá trị đọc từ trước:
   *
   *   t0  người bán mở trang sửa, hàm này đọc stock = 50
   *   t1  ba người mua đặt 3 món  -> stock = 47  (transaction, có khoá, đúng)
   *   t2  save(product) ghi đè    -> stock = 50  ← ba món vừa bán quay về kho
   *
   * Đo bằng TC-P1-06, ép xen kẽ bằng spy trên `findOne`: kho về 50 sau khi đã
   * bán 3. Ở production cửa sổ đó mở ra ngẫu nhiên, và càng đông người mua thì
   * càng hay trúng.
   *
   * Tệ hơn số lượng: `save()` còn ghi đè `price`, `status`, `sold_count` bằng
   * bản đọc từ trước — người bán bấm "lưu tồn kho" có thể lùi giá về giá cũ.
   *
   * CÁCH SỬA: một câu `UPDATE` chỉ chạm ĐÚNG cột `stock`, kèm **khoá lạc quan**
   * `WHERE stock = :kyVong`. Người gọi phải nói ra "tôi đang nhìn thấy N" —
   * không khớp thì từ chối thay vì đè. Không cần `FOR UPDATE`: một câu UPDATE
   * có điều kiện đã là nguyên tử ở tầng database, và nó không giữ khoá qua một
   * lượt request như bản đọc-rồi-ghi.
   *
   * MẶC ĐỊNH LÀ SỐ VỪA ĐỌC Ở NGAY TRÊN, không phải tuỳ chọn. Client cũ không
   * phải sửa gì mà cửa sổ giữa `findOne` và `UPDATE` của chính hàm này vẫn
   * đóng — đó đúng là cửa sổ mà TC-P1-06 ép mở ra.
   *
   * `expectedStock` do client truyền vào thì mạnh hơn: nó đóng cửa sổ dài hơn,
   * từ lúc trang sửa được tải cho tới lúc bấm lưu. Frontend nên gửi kèm số nó
   * đang hiển thị.
   */
  async updateStock(
    productId: number,
    stock: number,
    userId: number,
    isAdmin: boolean,
    expectedStock?: number,
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

    const kyVong = expectedStock ?? Number(product.stock);

    const kq = await this.productRepository
      .createQueryBuilder()
      .update(Product)
      .set({ stock })
      .where('id = :id AND stock = :kyVong', { id: productId, kyVong })
      .execute();
    if (kq.affected !== 1) {
      throw new ConflictException(
        'Tồn kho vừa thay đổi (có đơn hàng mới hoặc người khác vừa sửa). ' +
          'Mời bạn tải lại trang rồi nhập số mới.',
      );
    }

    await this.cacheDel(this.detailKey(productId));
    await this.moiDanhSach();

    // Đọc lại từ database thay vì trả `product` đã nạp từ trước: sau câu UPDATE
    // ở trên, bản trong bộ nhớ là bản cũ.
    //
    // `findOneOrFail` chứ không `findOne`: kiểu trả về phải là `Product`, không
    // phải `Product | null`. Plugin Swagger của Nest suy ra schema từ kiểu trả
    // về, và một union có `null` làm nó tụt xuống `type: object` — tức
    // `openapi.json` mất `$ref` tới Product và ba client mất kiểu của endpoint
    // này. Bản vá BUG-06 đã vô tình gây đúng chuyện đó; `npm run openapi:check`
    // bắt được.
    //
    // Về nghiệp vụ thì ném cũng đúng hơn: sản phẩm vừa được UPDATE ở dòng trên
    // mà đọc lại không thấy nghĩa là có người vừa xoá nó giữa chừng — đó là
    // chuyện cần biết, không phải chuyện trả `null` rồi đi tiếp.
    return this.productRepository.findOneOrFail({
      where: { id: productId },
      relations: ['seller'],
    });
  }
}
