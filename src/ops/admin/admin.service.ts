import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { VAI_TRO_DAT_DUOC } from './dto/change-role.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Order, OrderStatus } from '@ordering/orders/entities/order.entity';
import { Product } from '@catalog/products/entities/product.entity';
import { ILike, Repository } from 'typeorm';
import { User } from '@identity/users/entities/user.entity';
import { Setting } from '@ops/settings/entities/setting.entity';
import {
  Withdrawal,
  WithdrawalStatus,
} from '@money/withdrawals/entities/withdrawal.entity';
import { WithdrawalsService } from '@money/withdrawals/withdrawals.service';
import { OrdersService } from '@ordering/orders/orders.service';
import { ProductsService } from '@catalog/products/products.service';
import { UpdateUserByAdminDto } from './dto/update-user-by-admin.dto';
import { normalizePagination } from '@common/dto/pagination.dto';

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(Setting)
    private readonly settingRepository: Repository<Setting>,
    @InjectRepository(Withdrawal)
    private readonly withdrawalRepository: Repository<Withdrawal>,
    private readonly withdrawalsService: WithdrawalsService,
    private readonly ordersService: OrdersService,
    private readonly productsService: ProductsService,
  ) {}
  async getUsers(
    page: number,
    limit: number,
    q?: string,
    role?: string,
    is_locked?: string,
  ) {
    const where: any = {};
    if (q) where.full_name = ILike(`%${q}%`);
    if (role) where.role = role;
    if (is_locked !== undefined) where.is_locked = is_locked === 'true' ? 1 : 0;

    // Trang admin cũng là một danh sách: `?limit=1000000` nạp cả bảng users,
    // `?page=-5` ra skip âm và 500. Khuôn chung (rà soát 26/10 mục 3).
    const { page: trang, size, offset } = normalizePagination(page, limit, 20);

    const [result, total] = await this.userRepository.findAndCount({
      where,
      skip: offset,
      take: size,
      order: { created_at: 'DESC' },
    });

    return {
      meta: {
        current: trang,
        pageSize: size,
        pages: Math.ceil(total / size),
        total,
      },
      result,
    };
  }

  async getUserDetail(id: number) {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng');

    const [ordersCount, productsCount] = await Promise.all([
      this.orderRepository.count({ where: { user: { id } } }),
      this.productRepository.count({ where: { seller: { id } } }),
    ]);

    return {
      ...user,
      orders_count: ordersCount,
      products_count: productsCount,
    };
  }

  /**
   * Khoá / mở khoá tài khoản.
   *
   * `khoa` là TRẠNG THÁI ĐÍCH. Bản cũ chỉ biết đọc rồi lật: admin bấm hai lần,
   * hay trình duyệt gửi lại request, là khoá rồi mở luôn, và không có cách
   * nào nói "tôi muốn KHOÁ". Có trạng thái đích thì gọi lại bao nhiêu lần cũng
   * cùng kết quả. Bỏ trống `khoa` thì vẫn lật như cũ: web admin hiện gọi
   * PATCH /admin/users/:id/toggle-lock không có body.
   *
   * Thu hồi phiên CHỈ khi trạng thái thật sự đổi sang khoá. Dọn dẹp thì chạy
   * MỖI LẦN đặt trạng thái đích, đổi hay không:
   *  · khoá: ẩn hàng đang bán (người bán bị khoá không xác nhận hay giao được
   *    nữa) và huỷ đơn pending chưa trả tiền của họ, để kho không bị giữ tới
   *    khi cron 48 giờ dọn;
   *  · mở khoá: bày lại những tin đã bị ẩn lúc khoá.
   * VÌ SAO KHÔNG CHỈ KHI ĐỔI (review 26/10): dọn dẹp chạy SAU khi khoá đã
   * ghi. Bản đầu gắn nó vào "trạng thái có đổi không", nên dọn hỏng giữa chừng
   * thì lần gọi lại thấy "đã khoá rồi" và bỏ qua mãi mãi. Cả hai việc đều làm
   * lại được vô hại (đổi trạng thái có điều kiện, huỷ đơn bỏ qua đơn đã huỷ).
   */
  async toggleUserLock(id: number, khoa?: boolean) {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng');
    if (user.role === 'admin')
      throw new BadRequestException('Không thể khóa tài khoản admin');

    const dich = khoa ?? !user.is_locked;
    const doi = Boolean(user.is_locked) !== dich;
    if (doi) {
      // `update` đúng hai cột, không `save` cả entity đã đọc: `save` ghi đè
      // mọi cột bằng bản đọc từ trước, kể cả `role` vừa bị admin khác đổi.
      // Khoá thì thu hồi luôn mọi phiên đang có: JwtStrategy và socket chat so
      // token_version với DB ở mỗi lần xác thực (audit B-04).
      const tokenVersion = dich
        ? (user.token_version || 0) + 1
        : user.token_version;
      await this.userRepository.update(
        { id: user.id },
        { is_locked: dich, token_version: tokenVersion },
      );
    }

    let anSanPham = 0;
    let huyDon: number[] = [];
    if (dich) {
      ({ anSanPham, huyDon } = await this.donHangVaDonCua(user.id));
    } else {
      anSanPham = -(await this.productsService.moLaiHangCuaNguoiBan(user.id));
    }
    return {
      id: user.id,
      is_locked: dich,
      message: dich ? 'Đã khóa tài khoản' : 'Đã mở khóa tài khoản',
      // Dương: số tin vừa bị ẩn; âm: số tin vừa được bày lại.
      san_pham_doi: anSanPham,
      don_da_huy: huyDon,
    };
  }

  /** Ẩn hàng rồi huỷ đơn chờ chưa trả của một người bán bị khoá/xoá. */
  private async donHangVaDonCua(
    userId: number,
  ): Promise<{ anSanPham: number; huyDon: number[] }> {
    // Ẩn hàng TRƯỚC: chặn đơn mới, rồi mới dọn đơn cũ.
    const anSanPham = await this.productsService.anHangCuaNguoiBan(userId);
    const huyDon = await this.ordersService.huyDonChoCuaNguoiBan(userId);
    return { anSanPham, huyDon };
  }

  async changeUserRole(id: number, role: string) {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng');

    // Cùng danh sách với DTO: service cũng được gọi không qua HTTP.
    if (!VAI_TRO_DAT_DUOC.includes(role))
      throw new BadRequestException('Vai trò không hợp lệ');

    user.role = role as any;
    // Thu hồi mọi phiên đang có (B-08). JwtStrategy lấy role từ PAYLOAD của
    // token, không đọc lại DB, nên admin vừa bị hạ vẫn cầm token role=admin và
    // dùng tiếp các route admin tới khi token hết hạn, làm mới bằng refresh
    // token cũ cũng được. Tăng token_version làm JwtStrategy, socket chat và
    // /auth/refresh từ chối mọi token cũ, giống cách toggleUserLock làm.
    // Người bị đổi vai trò đăng nhập lại để nhận token mang vai trò mới.
    user.token_version = (user.token_version || 0) + 1;
    await this.userRepository.save(user);
    return { id: user.id, role: user.role };
  }

  async updateUser(id: number, dto: UpdateUserByAdminDto) {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng');

    // M-01: Chặn ghi các cột nhạy cảm — DTO chỉ là type hint, validation pipe ở
    // controller mới lọc, nhưng service có thể được gọi trực tiếp (test, script).
    // Danh sách cột CẤM: password, role, token_version, is_locked, refresh_token.
    const cam = [
      'password',
      'role',
      'token_version',
      'is_locked',
      'refresh_token',
    ] as const;
    for (const k of cam) {
      if (k in dto) throw new BadRequestException(`Không được sửa cột ${k}`);
    }

    await this.userRepository.update(id, dto);
    return this.userRepository.findOne({ where: { id } });
  }

  async deleteUser(id: number) {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng');
    if (user.role === 'admin')
      throw new BadRequestException('Không thể xóa tài khoản admin');

    // Dọn TRƯỚC khi xoá mềm: tài khoản đã xoá thì không ai còn đường vào trang
    // admin của nó để dọn lại. Hàng của người bị xoá tới 26/10 vẫn `active`
    // trên trang chủ, đặt được, mà không còn ai để giao.
    const { anSanPham, huyDon } = await this.donHangVaDonCua(user.id);
    await this.userRepository.softDelete(id);
    return {
      message: 'Xóa người dùng thành công',
      san_pham_da_an: anSanPham,
      don_da_huy: huyDon,
    };
  }

  async getDashboardStats() {
    const [totalUsers, totalProducts, totalOrders, revenueResult] =
      await Promise.all([
        this.userRepository.count(),
        this.productRepository.count(),
        this.orderRepository.count(),
        // DOANH THU = TIỀN ĐÃ NHẬN, KHÔNG PHẢI ĐƠN ĐÃ GIAO.
        //
        // Bản cũ chỉ lọc `status = 'delivered'`. Một đơn đã giao mà chưa thu
        // được tiền (COD chưa đối soát) thì không phải doanh thu đã nhận.
        // `orders.getStats` đã sửa theo hướng này ở BUG-21; để hai bảng điều
        // khiển tính khác nhau là hai con số "doanh thu" cùng tồn tại.
        //
        // Thứ tự điều kiện khớp với index `idx_paid_status_amount`
        // (is_paid, status, final_amount) — có `final_amount` ở cuối nên MySQL
        // đọc xong ngay trong index. Đo trên 1.000 đơn:
        //   trước: type=ALL key=NULL              rows=1000
        //   sau:   type=ref key=idx_paid_status_amount rows=681  Using index
        this.orderRepository
          .createQueryBuilder('order')
          .select('COALESCE(SUM(order.final_amount), 0)', 'total')
          .where('order.is_paid = :paid', { paid: true })
          .andWhere('order.status = :status', { status: 'delivered' })
          .getRawOne(),
      ]);

    const pendingOrders = await this.orderRepository.count({
      where: { status: OrderStatus.PENDING },
    });

    const totalRevenue = Number(revenueResult?.total || 0);

    return {
      total_users: totalUsers,
      total_products: totalProducts,
      total_orders: totalOrders,
      total_revenue: totalRevenue,
      pending_orders: pendingOrders,
      completed_orders: totalOrders - pendingOrders,
    };
  }
  async getSettings() {
    return this.settingRepository.find();
  }

  async updateSettings(updates: Record<string, string>) {
    for (const [key, value] of Object.entries(updates)) {
      const setting = await this.settingRepository.findOne({ where: { key } });
      if (setting) {
        setting.value = value;
        await this.settingRepository.save(setting);
      } else {
        await this.settingRepository.save(
          this.settingRepository.create({ key, value }),
        );
      }
    }
    return this.settingRepository.find();
  }

  // ── WITHDRAWALS ──

  async getWithdrawals(page: number, limit: number, status?: string) {
    const where: any = {};
    if (status) where.status = status;
    const { page: trang, size, offset } = normalizePagination(page, limit, 20);

    const [result, total] = await this.withdrawalRepository.findAndCount({
      where,
      relations: ['user', 'approved_by'],
      skip: offset,
      take: size,
      order: { created_at: 'DESC' },
    });

    return {
      meta: {
        current: trang,
        pageSize: size,
        pages: Math.ceil(total / size),
        total,
      },
      result,
    };
  }

  // Ba hàm dưới đây uỷ quyền hết cho WithdrawalsService.
  //
  // Trước đây admin có BẢN SAO riêng của cùng logic, và bản sao đó cộng thẳng
  // vào users.balance. Hai chỗ cùng làm một việc theo hai cách khác nhau thì
  // sớm muộn cũng lệch — ở đây là lệch về tiền. Chỗ duy nhất được đổi số dư
  // vẫn phải là sổ cái.
  //
  // ops gọi money là chiều phụ thuộc hợp lệ, nên import này không phá ranh giới.

  async approveWithdrawal(id: number, adminId: number) {
    return this.withdrawalsService.approve(id, adminId);
  }

  /** Admin xác nhận đã chuyển khoản xong — tiền rời khỏi hệ thống ở bước này */
  async completeWithdrawal(id: number, adminId: number) {
    return this.withdrawalsService.complete(id, adminId);
  }

  async rejectWithdrawal(id: number, adminId: number, note?: string) {
    return this.withdrawalsService.reject(id, adminId, note);
  }
}
