import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateShopDto } from './dto/create-shop.dto';
import { UpdateShopDto } from './dto/update-shop.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Shop, ShopStatus } from './entities/shop.entity';
import { User } from '@identity/users/entities/user.entity';
import {
  Product,
  ProductStatus,
} from '@catalog/products/entities/product.entity';
import { Follow } from '@catalog/follows/entities/follow.entity';
import { OrderItem } from '@ordering/orders/entities/order-item.entity';
import type { IUser } from '@identity/users/users.interface';
import { normalizePagination } from '@common/dto/pagination.dto';
import { demCoTran, metaCoTran, trangCoTran } from '@common/dem-co-tran';

@Injectable()
export class ShopService {
  constructor(
    @InjectRepository(Shop)
    private readonly shopRepository: Repository<Shop>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(Follow)
    private readonly followRepository: Repository<Follow>,
    @InjectRepository(OrderItem)
    private readonly orderItemRepository: Repository<OrderItem>,
  ) {}

  async create(createShopDto: CreateShopDto, user: IUser) {
    const existing = await this.shopRepository.findOne({
      where: { user: { id: user.id } },
    });
    if (existing) {
      throw new BadRequestException('Bạn đã có shop rồi');
    }
    const slugExists = await this.shopRepository.findOne({
      where: { slug: createShopDto.slug },
    });
    if (slugExists) {
      throw new BadRequestException('Slug này đã được sử dụng');
    }

    const shop = this.shopRepository.create({
      ...createShopDto,
      user: { id: user.id },
    });

    return this.shopRepository.save(shop);
  }

  async getMyShop(user: IUser) {
    const shop = await this.shopRepository.findOne({
      where: { user: { id: user.id } },
      relations: ['user'],
    });
    if (!shop) {
      throw new NotFoundException('Bạn chưa có shop');
    }
    return shop;
  }

  async update(updateShopDto: UpdateShopDto, user: IUser) {
    const shop = await this.getMyShop(user);

    if (updateShopDto.slug && updateShopDto.slug !== shop.slug) {
      const slugExists = await this.shopRepository.findOne({
        where: { slug: updateShopDto.slug },
      });
      if (slugExists) {
        throw new BadRequestException('Slug này đã được sử dụng');
      }
    }

    await this.shopRepository.update(shop.id, updateShopDto);
    return this.shopRepository.findOne({ where: { id: shop.id } });
  }

  /**
   * Thông tin shop cho route CÔNG KHAI GET /shop/:sellerId.
   *
   * Dựng bằng DANH SÁCH TRẮNG chứ không trả thẳng dòng `shops`. Bản trước trả
   * nguyên dòng kèm `relations: ['user']`, tức:
   *   - các cột pickup_*: đây là sàn C2C, người bán gửi hàng từ NHÀ MÌNH, nên
   *     pickup_address/pickup_phone/pickup_name là địa chỉ nhà và số riêng của
   *     họ, phơi cho người chưa đăng nhập. Chủ shop đọc chúng qua GET /shop/me;
   *     web và app không đọc pickup_* từ route này (kiểm 25/10).
   *   - nguyên dòng users của chủ shop: email, số điện thoại, vai trò,
   *     token_version.
   * Danh sách trắng thay vì xoá từng cột: thêm cột nhạy cảm mới vào bảng shops
   * thì nó không tự lọt ra.
   */
  async getShopInfo(sellerId: number) {
    const shopDb = await this.shopRepository.findOne({
      where: { user: { id: sellerId } },
      relations: ['user'],
    });

    let shop: Record<string, unknown>;
    if (shopDb) {
      shop = {
        id: shopDb.id,
        name: shopDb.name,
        slug: shopDb.slug,
        description: shopDb.description,
        logo: shopDb.logo,
        banner: shopDb.banner,
        phone: shopDb.phone,
        address: shopDb.address,
        status: shopDb.status,
        created_at: shopDb.created_at,
        updated_at: shopDb.updated_at,
        user: shopDb.user
          ? {
              id: shopDb.user.id,
              full_name: shopDb.user.full_name,
              avatar: shopDb.user.avatar,
              created_at: shopDb.user.created_at,
            }
          : undefined,
      };
    } else {
      const user = await this.userRepository.findOne({
        where: { id: sellerId },
        select: ['id', 'full_name', 'avatar', 'created_at'],
      });
      if (!user) throw new BadRequestException('Không tìm thấy shop');
      shop = { name: user.full_name, logo: user.avatar };
    }

    const [productCount, followerCount] = await Promise.all([
      this.productRepository.count({
        where: { seller: { id: sellerId }, status: ProductStatus.ACTIVE },
      }),
      this.followRepository.count({ where: { following: { id: sellerId } } }),
    ]);

    return { ...shop, productCount, followerCount };
  }

  async getShopProducts(sellerId: number, rawPage: number, rawLimit: number) {
    // Route công khai: không ép thì ?limit=1000000 nạp cả kho hàng của shop vào
    // RAM, và ?page=-3 cho skip âm. Ép về [1, MAX_PAGE_SIZE] như mọi danh sách
    // khác; mặc định 20 giữ nguyên hành vi cũ của controller.
    const {
      page,
      size: limit,
      offset,
    } = normalizePagination(rawPage, rawLimit, 20);
    const where = { seller: { id: sellerId }, status: ProductStatus.ACTIVE };
    // Trần độ sâu như /products (?page=9000 không thành OFFSET 179980), và
    // đếm có trần: shop lớn không phải đếm hết kho ở mỗi lần lật trang.
    const { rows, ...tong } = await trangCoTran({
      offset,
      size: limit,
      layDong: (take) =>
        this.productRepository.find({
          where,
          relations: ['category'],
          skip: offset,
          take,
          order: { created_at: 'DESC' },
        }),
      dem: () =>
        demCoTran(
          this.productRepository
            .createQueryBuilder('product')
            .setFindOptions({ where }),
        ),
    });

    return { meta: metaCoTran(page, limit, tong), result: rows };
  }

  async getSellerOrders(
    sellerId: number,
    rawPage: number,
    rawLimit: number,
    status: string | undefined,
    user: IUser, // BẮT BUỘC: guard mặc định mở (fail-open) nếu tuỳ chọn — dữ liệu người khác chảy ra im lặng
  ) {
    // B5-1: Chặn quyền xem đơn hàng — chỉ chủ shop hoặc admin được xem.
    // Check ở SERVICE (không ở controller): đảm bảo bất biến an toàn dù gọi từ đâu.
    // user BẮT BUỘC phải truyền vào — không cho phép undefined.
    if (user.role !== 'admin' && user.id !== sellerId) {
      throw new ForbiddenException('Bạn không có quyền xem đơn hàng này');
    }

    // Cùng trần với getShopProducts: mỗi dòng ở đây kéo theo đơn, người mua và
    // sản phẩm, nên limit không trần còn đắt hơn.
    const {
      page,
      size: limit,
      offset,
    } = normalizePagination(rawPage, rawLimit, 20);

    // PHÂN TRANG THEO ĐƠN, KHÔNG THEO DÒNG HÀNG.
    //
    // Bản cũ `findAndCount` trên `order_items` rồi mới gom theo đơn: đơn ba món
    // vắt qua hai trang (trang sau hiện món còn lại như một đơn riêng),
    // `limit=20` trả ít hơn 20 đơn, và `meta.total` đếm số MÓN nên app tính số
    // trang sai (ba đơn ba món ra total 9). Đo bằng
    // `don-nguoi-ban-phan-trang.spec.ts`.
    //
    // Nay ba bước, cùng khuôn với `OrdersService.findAll`: đếm đơn DISTINCT,
    // lấy id đơn của trang, rồi mới nạp món của đúng những đơn đó. Đơn đã xoá
    // mềm bị loại ở cả ba bước (join thường của TypeORM tự thêm điều kiện
    // deleted_at, ghi rõ ra để không ai phải nhớ).
    const locDon = () => {
      const qb = this.orderItemRepository
        .createQueryBuilder('oi')
        .innerJoin('oi.product', 'p')
        .innerJoin('oi.order', 'o')
        .where('p.seller_id = :sellerId', { sellerId })
        .andWhere('o.deleted_at IS NULL');
      if (status) qb.andWhere('o.status = :status', { status });
      return qb;
    };

    // Trần độ sâu và đếm có trần như mọi danh sách khác (rà soát 28/10 mục
    // 6): người bán lớn có hàng trăm nghìn dòng hàng, `COUNT(DISTINCT)` không
    // trần và `?page=9000` đều bắt MySQL gom hết rồi mới trả 20 đơn.
    //
    // KHÔNG đi qua `order_shipments.seller_id` dù bảng đó có index và một
    // dòng mỗi (đơn, người bán): dòng vận đơn chỉ được tạo lúc người bán bấm
    // giao, nên đơn `pending`/`confirmed` chưa có dòng nào và sẽ biến mất
    // khỏi màn của người bán (đo bằng `don-nguoi-ban-doi-chieu.spec.ts`).
    // Muốn nhanh hơn nữa cần một cột/bảng (đơn, người bán) ghi lúc ĐẶT hàng.
    //
    // Mới nhất trước theo id đơn (id tăng dần theo thời gian tạo), thay cho
    // `id DESC` của dòng hàng bản cũ: cùng thứ tự với người dùng nhìn thấy.
    const { rows: pageIds, ...tong } = await trangCoTran({
      offset,
      size: limit,
      layDong: async (take) => {
        const idRows = await locDon()
          .select('o.id', 'id')
          .groupBy('o.id')
          .orderBy('o.id', 'DESC')
          .offset(offset)
          .limit(take)
          .getRawMany<{ id: number }>();
        return idRows.map((r) => Number(r.id));
      },
      dem: () => demCoTran(locDon(), undefined, { cot: 'o.id' }),
    });

    // Chỉ món của CHÍNH người bán này: đơn nhiều người bán thì món của người
    // khác không thuộc về màn này (cùng luật với OrdersService.findOne).
    const items = pageIds.length
      ? await this.orderItemRepository.find({
          where: {
            order: { id: In(pageIds) },
            product: { seller: { id: sellerId } },
          },
          relations: ['order', 'order.user', 'product'],
          order: { id: 'DESC' },
        })
      : [];
    // Xếp món theo thứ tự đơn của trang để Map bên dưới giữ đúng thứ tự đó.
    const viTri = new Map(pageIds.map((id, i) => [id, i]));
    items.sort(
      (a, b) => (viTri.get(a.order.id) ?? 0) - (viTri.get(b.order.id) ?? 0),
    );

    const orderMap = new Map<number, any>();
    for (const item of items) {
      if (!orderMap.has(item.order.id)) {
        orderMap.set(item.order.id, {
          ...item.order,
          // Người bán chỉ cần biết ai nhận (receiver_* đã có trên đơn), không
          // cần email, số điện thoại tài khoản, vai trò của người mua. Cùng
          // cách cắt với OrdersService.findOne khi người gọi chỉ là người bán.
          user: item.order.user
            ? { id: item.order.user.id, full_name: item.order.user.full_name }
            : item.order.user,
          items: [],
        });
      }
      orderMap.get(item.order.id).items.push(item);
    }

    const result = Array.from(orderMap.values());

    return { meta: metaCoTran(page, limit, tong), result };
  }
}
