import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from '@nestjs/cache-manager';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Product, ProductStatus } from './entities/product.entity';
import { Follow } from '@catalog/follows/entities/follow.entity';
import { Shop } from '@catalog/shop/entities/shop.entity';
import { Repository, Between, MoreThan } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { IUser } from '@identity/users/users.interface';
import { formatMoney } from '@common/money';
import { normalizePagination } from '@common/dto/pagination.dto';
import { NotificationsService } from '@messaging/notifications/notifications.service';
import Redis from 'ioredis';
import { StockEventsService } from '@catalog/stock/stock-events.service';
import {
  DuLieuBaoHangMoi,
  HangDoiViecNen,
  JOB_BAO_HANG_MOI,
} from '@common/hang-doi';

/** Báo hàng mới: đọc người theo dõi theo lô bấy nhiêu dòng một lần. */
const LO_NGUOI_THEO_DOI = 500;
/** Báo hàng mới: tối đa bấy nhiêu lời gọi tạo thông báo chạy cùng lúc. */
const SONG_SONG_THONG_BAO = 10;

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
  private readonly logger = new Logger(ProductsService.name);
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
    private readonly stockEvents: StockEventsService,
    // @Optional: các spec dựng ProductsService bằng tay với sáu tham số cũ;
    // thiếu hàng đợi thì `xepBaoHangMoi` tự đi đường lùi.
    @Optional() private readonly hangDoi?: HangDoiViecNen,
  ) {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      // Fail-open: không có Redis thì bỏ đếm view_count, tuyệt đối không chặn boot
      console.warn(
        '[ProductsService] REDIS_URL không có — bỏ qua đếm view_count',
      );
      return;
    }
    this.redis = new Redis(redisUrl, {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
    });
    // Kết nối đếm view_count không phải lý do để tiến trình còn sống: unref
    // socket sau mỗi lần nối (cả lần nối lại). Đo 26/10: có REDIS_URL thì mọi
    // spec dựng service này giữ jest tới hết hạn 10 phút của nghiem-thu dù đã
    // xanh hết; api và worker vẫn sống nhờ HTTP server và kết nối BullMQ.
    this.redis.on('connect', () => {
      (
        this.redis as unknown as { stream?: { unref?: () => void } }
      ).stream?.unref?.();
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

  /**
   * Bỏ bản nhớ của một sản phẩm và của danh sách, cho nơi khác đổi số liệu
   * hiển thị của sản phẩm (điểm, lượt đánh giá) mà không đi qua update() ở đây.
   */
  async invalidateProductCache(id: number): Promise<void> {
    await this.cacheDel(this.detailKey(id));
    await this.moiDanhSach();
  }

  /**
   * ẨN mọi hàng đang bán của một người bán, khi tài khoản bị khoá hoặc xoá.
   *
   * Dùng `draft` vì enum `products.status` không có trạng thái "bị ẩn" riêng,
   * KÈM dấu `hidden_by_lock_at` để mở khoá biết tin nào bị ẩn ở đây. Bản đầu
   * không có dấu và mở khoá bày lại MỌI tin `draft` của người bán, kể cả bản
   * nháp thật (review 26/10, đo bằng `khoa-xoa-nguoi-ban.spec.ts`).
   *
   * Chỉ chạm tin còn `active`: khoá lặp không đè dấu của lần trước.
   *
   * Trả về số tin đã ẩn. Xoá cache chi tiết từng tin và đổi đời danh sách:
   * tin bị ẩn phải biến khỏi trang chủ ngay, không đợi TTL.
   */
  async anHangCuaNguoiBan(sellerId: number): Promise<number> {
    return this.doiTrangThaiHangCuaNguoiBan(sellerId, 'status = :active', {
      status: ProductStatus.DRAFT,
      hidden_by_lock_at: () => 'NOW()',
    });
  }

  /**
   * Ngược lại của `anHangCuaNguoiBan`, khi admin mở khoá tài khoản: CHỈ tin
   * mang dấu `hidden_by_lock_at` (bị ẩn vì khoá), rồi xoá dấu.
   */
  async moLaiHangCuaNguoiBan(sellerId: number): Promise<number> {
    return this.doiTrangThaiHangCuaNguoiBan(
      sellerId,
      'status = :draft AND hidden_by_lock_at IS NOT NULL',
      { status: ProductStatus.ACTIVE, hidden_by_lock_at: null },
    );
  }

  private async doiTrangThaiHangCuaNguoiBan(
    sellerId: number,
    dieuKien: string,
    giaTri: QueryDeepPartialEntity<Product>,
  ): Promise<number> {
    const thamSo = {
      sellerId,
      active: ProductStatus.ACTIVE,
      draft: ProductStatus.DRAFT,
    };
    const ids = (
      await this.productRepository
        .createQueryBuilder('p')
        .select('p.id', 'id')
        // Cột không gắn bí danh: một bảng, nên `status` hay `hidden_by_lock_at`
        // trỏ đúng cột, và cùng một chuỗi điều kiện dùng được cho câu UPDATE.
        .where(`seller_id = :sellerId AND ${dieuKien}`, thamSo)
        .getRawMany<{ id: number }>()
    ).map((p) => Number(p.id));
    if (ids.length === 0) return 0;

    // Điều kiện lặp lại trong WHERE của câu UPDATE: tin nào vừa đổi trạng thái
    // giữa lúc đọc và lúc ghi thì không bị kéo theo.
    const kq = await this.productRepository
      .createQueryBuilder()
      .update(Product)
      .set(giaTri)
      .where(`id IN (:...ids) AND ${dieuKien}`, { ...thamSo, ids })
      .execute();
    for (const id of ids) await this.cacheDel(this.detailKey(id));
    await this.moiDanhSach();
    return kq.affected ?? 0;
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

    await this.xepBaoHangMoi({
      seller_id: user.id,
      seller_name: user.full_name || 'Shop',
      product_id: saved.id,
      product_name: name,
      price: Number(price),
      currency,
    });

    return this.findOne(saved.id);
  }

  /**
   * BÁO NGƯỜI THEO DÕI QUA HÀNG ĐỢI, KHÔNG TRONG REQUEST.
   *
   * Tới 26/10 `create` làm `await Promise.all(followers.map(create thông
   * báo))` ngay trong POST /products: mỗi người theo dõi một INSERT và một
   * lần đẩy FCM, tất cả cùng lúc. Người bán có 5.000 người theo dõi là 5.000
   * lời hứa song song, hồ 50 kết nối của api cạn, và người bán chờ hết mới
   * thấy "Đăng bán thành công"; FCM treo là request treo theo (đo bằng
   * `thong-bao-hang-moi.spec.ts`).
   *
   * Nay request chỉ xếp MỘT job; worker gọi `phatThongBaoHangMoi`. `jobId`
   * theo id sản phẩm: lỡ xếp hai lần thì BullMQ chỉ giữ một.
   *
   * ĐƯỜNG LÙI khi không xếp được (máy dev không Redis, Redis sập): chạy cùng
   * hàm đó NGAY TRONG TIẾN TRÌNH nhưng KHÔNG chờ. Request vẫn trả về ngay; cái
   * giá là việc báo không còn được worker gánh, và mất nếu tiến trình tắt giữa
   * chừng. Thông báo là việc phụ, mất một lượt báo còn hơn chặn đăng bán.
   */
  private async xepBaoHangMoi(d: DuLieuBaoHangMoi): Promise<void> {
    const daXep =
      (await this.hangDoi?.them(
        JOB_BAO_HANG_MOI,
        d,
        `bao-hang-moi-${d.product_id}`,
      )) ?? false;
    if (daXep) return;
    void this.phatThongBaoHangMoi(d).catch((e: unknown) =>
      this.logger.error(
        `Báo hàng mới #${d.product_id} (chạy trong tiến trình) hỏng: ` +
          `${(e as Error)?.message ?? String(e)}`,
      ),
    );
  }

  /**
   * Phần việc của WORKER: báo hàng mới cho mọi người theo dõi người bán.
   *
   * Đọc người theo dõi theo lô 500 dòng, nhảy bằng `id > con trỏ` chứ không
   * OFFSET (cùng lý do với sitemap: OFFSET sâu bắt MySQL đếm bỏ cả phần đã
   * đọc). Mỗi lô chạy tối đa 10 lời gọi cùng lúc: đủ nhanh, mà không bao giờ
   * chiếm quá 10 kết nối của hồ (worker chỉ có 5, phần dư xếp hàng chờ chứ
   * không lỗi).
   *
   * Một người hỏng (FCM từ chối, user đã xoá) KHÔNG chặn người khác và không
   * làm job hỏng: job hỏng thì BullMQ có thể chạy lại từ đầu và báo trùng cho
   * những người đã nhận. Chỉ lỗi đọc người theo dõi mới làm job hỏng.
   */
  async phatThongBaoHangMoi(
    d: DuLieuBaoHangMoi,
  ): Promise<{ da_bao: number; hong: number }> {
    let daBao = 0;
    let hong = 0;
    let sau = 0;
    for (;;) {
      const lo = await this.followRepository.find({
        where: { following_id: d.seller_id, id: MoreThan(sau) },
        select: { id: true, follower_id: true },
        order: { id: 'ASC' },
        take: LO_NGUOI_THEO_DOI,
      });
      if (lo.length === 0) break;
      sau = lo[lo.length - 1].id;

      let ke = 0;
      const mot = async (): Promise<void> => {
        while (ke < lo.length) {
          const f = lo[ke++];
          try {
            await this.notificationsService.create({
              user_id: f.follower_id,
              type: 'new_product' as any,
              title: `${d.seller_name || 'Shop'} vừa đăng sản phẩm mới`,
              // Không ghép cứng chữ "đ": một món niêm yết bằng USD mà báo cho
              // người theo dõi là "2.400đ" thì sai lệch hơn hai mươi lần.
              content: `${d.product_name}: ${formatMoney(d.price, d.currency)}`,
              data: { product_id: d.product_id, seller_id: d.seller_id },
            });
            daBao++;
          } catch {
            hong++;
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(SONG_SONG_THONG_BAO, lo.length) }, mot),
      );
      if (lo.length < LO_NGUOI_THEO_DOI) break;
    }
    if (hong > 0) {
      this.logger.warn(
        `Báo hàng mới #${d.product_id}: ${daBao} người nhận, ${hong} lượt hỏng.`,
      );
    }
    return { da_bao: daBao, hong };
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
        pmin: String(qs.price_min ?? ''),
        pmax: String(qs.price_max ?? ''),
        // Lọc tình trạng đến từ nhánh prod, gộp vào sau khi cache đã có. Thiếu
        // dòng này thì ?condition=new nhận nhầm danh sách chưa lọc từ cache.
        cond: String(qs.condition ?? ''),
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
    // Đọc một lần, dùng cho cả hai nhánh truy vấn bên dưới.
    const condition = qs.condition ? String(qs.condition) : undefined;
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

      if (condition) {
        qb.andWhere('product.condition = :cond', { cond: condition });
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
      if (condition) {
        where.condition = condition;
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
    if (cached) {
      // ĐẾM CẢ LƯỢT TRÚNG CACHE. Tới 26/10 lời gọi đếm nằm SAU dòng này, dù
      // comment trên nó viết "bỏ trước khi kiểm cache": TTL chi tiết 60 giây
      // nên mỗi phút mỗi sản phẩm chỉ đếm được một lượt xem, và sắp xếp
      // `most_viewed` thật ra đang sắp theo số lần cache hết hạn. Đo bằng
      // `cache-va-dem-sau-dat-huy.spec.ts`: 3 lượt xem, đếm được 1.
      await this.demLuotXem(id);
      return cached;
    }

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

    // Lượt trượt cache: đếm SAU khi biết sản phẩm có thật, để id bậy không đẻ
    // khoá `view_count:*` rác trong Redis.
    await this.demLuotXem(id);

    await this.cacheSet(key, product, PRODUCT_DETAIL_TTL);
    return product;
  }

  /**
   * Tăng view_count bằng Redis INCR (atomic, không race condition).
   * Key: `view_count:{productId}`. Flush về MySQL theo batch mỗi 5 phút bởi
   * job `flush-view-count` trong worker.
   */
  private async demLuotXem(id: number): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.incr(`view_count:${id}`);
    } catch {
      // on('error') chỉ bắt sự kiện kết nối, không bắt lệnh bị từ chối.
      // Đo được: "Stream isn't writeable and enableOfflineQueue options is false"
      // Fail-open: Redis lỗi không được làm route 500.
    }
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
    const { category_id, stock, expected_stock, ...restDto } = updateProductDto;
    const updateData: QueryDeepPartialEntity<Product> = { ...restDto };
    if (category_id) {
      updateData.category = { id: category_id };
    }

    // KHO KHÔNG ĐƯỢC GHI TUYỆT ĐỐI Ở ĐÂY.
    //
    // Trước 26/10 `stock` đi chung `productRepository.update` với mọi cột khác,
    // tức `UPDATE products SET stock = 50` vô điều kiện. Đó đúng là cái bẫy
    // TC-P1-06 đã đóng ở `updateStock`, chỉ khác cửa vào: trang sửa sản phẩm
    // của web (`product/[id]/edit`) LUÔN gửi kèm `stock` nó đọc lúc mở form,
    // nên người bán chỉ sửa tên mà trong lúc đó có 3 món được bán thì 3 món
    // ấy quay lại kho. Đo bằng `gia-va-kho-hop-le.spec.ts`.
    //
    // Không gỡ hẳn `stock` khỏi PATCH này vì chính trang đó cần nó; cho đi
    // qua cùng một câu UPDATE có điều kiện với `updateStock`. Ghi kho TRƯỚC
    // các cột khác: kho bị từ chối (409) thì không cột nào đã đổi.
    //
    // Gửi lại đúng số đang có mà không kèm `expected_stock` là trường hợp
    // thường gặp nhất (form gửi nguyên mọi ô): bỏ qua, không ghi gì cả. Nếu
    // ghi thì chính lúc kho vừa giảm, số cũ trên form sẽ cộng ngược món đã bán.
    let khoMoi: number | undefined;
    if (stock !== undefined) {
      const dangCo = Number(product.stock);
      if (expected_stock !== undefined || Number(stock) !== dangCo) {
        await this.ghiKhoCoDieuKien(
          id,
          Number(stock),
          expected_stock ?? dangCo,
        );
        khoMoi = Number(stock);
      }
    }

    if (Object.keys(updateData).length > 0) {
      await this.productRepository.update(id, updateData);
    }
    // Invalidate detail TRƯỚC khi đọc lại: xoá bản cũ để findOne nạp lại bản mới,
    // không để user thấy dữ liệu lỗi thời (pre-mortem C1/C4).
    await this.cacheDel(this.detailKey(id));
    await this.moiDanhSach();
    if (khoMoi !== undefined) {
      // Cùng chỗ phát với `updateStock`: người đang xem trang phải thấy kho
      // mới, dù người bán đổi nó từ trang sửa chứ không từ ô kho nhanh.
      await this.stockEvents.phat(id, khoMoi);
    }
    return await this.findOne(id);
  }

  /**
   * Một câu UPDATE chỉ chạm cột `stock`, kèm khoá lạc quan `stock = kyVong`.
   * Dùng chung cho `updateStock` và `update`: hai cửa vào phải chung một luật,
   * nếu không thì cửa nào dễ hơn sẽ thành đường vòng (đúng chuyện đã xảy ra).
   */
  private async ghiKhoCoDieuKien(
    productId: number,
    stock: number,
    kyVong: number,
  ): Promise<void> {
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

    // KHÔNG XOÁ MÓN ĐANG NẰM TRONG ĐƠN CHƯA XONG.
    //
    // Xoá mềm làm sản phẩm biến khỏi mọi truy vấn thường (TypeORM tự thêm
    // `deleted_at IS NULL`, kể cả ở phép JOIN). Đơn đang giao mà món của nó bị
    // xoá thì `applyCancellation` không thấy `item.product` để hoàn kho, trang
    // đơn của người bán mất dòng hàng, và `cancelSale` không còn nhận ra ai là
    // người bán. Tới 26/10 không có chốt nào: người bán xoá được món vừa bán
    // ngay khi đơn còn `shipping` (đo bằng `khoa-xoa-nguoi-ban.spec.ts`).
    //
    // SQL thô chứ không qua entity OrderItem: catalog không được import
    // ordering (luật ranh giới). Bốn trạng thái là mọi trạng thái chưa kết
    // thúc của `OrderStatus`.
    const [{ n }] = await this.productRepository.query<Array<{ n: number }>>(
      `SELECT COUNT(DISTINCT o.id) AS n
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
        WHERE oi.product_id = ?
          AND o.deleted_at IS NULL
          AND o.status IN ('pending', 'confirmed', 'processing', 'shipping')`,
      [id],
    );
    if (Number(n) > 0) {
      throw new BadRequestException(
        `Sản phẩm đang nằm trong ${Number(n)} đơn hàng chưa hoàn tất nên chưa ` +
          'xoá được. Xử lý xong các đơn đó trước; muốn ngừng bán ngay thì đặt ' +
          'tồn kho về 0.',
      );
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
    await this.ghiKhoCoDieuKien(productId, stock, kyVong);

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
    const moi = await this.productRepository.findOneOrFail({
      where: { id: productId },
      relations: ['seller'],
    });

    // TỒN KHO REAL-TIME (task #26b) — chỗ phát thứ ba.
    //
    // Đặt SAU khi đã đọc lại từ database: `moi.stock` là con số thật sau câu
    // UPDATE ở trên, còn `stock` truyền vào chỉ là thứ người bán mong muốn —
    // khoá lạc quan (`expectedStock`) có thể đã từ chối nó.
    //
    // `phat()` không bao giờ ném: người bán sửa kho xong không được nhận lỗi
    // chỉ vì Redis đang hỏng.
    await this.stockEvents.phat(productId, moi.stock);

    return moi;
  }
}
