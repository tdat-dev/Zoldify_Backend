import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
import { UpdateUserByAdminDto } from './dto/update-user-by-admin.dto';

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

    const [result, total] = await this.userRepository.findAndCount({
      where,
      skip: (page - 1) * limit,
      take: limit,
      order: { created_at: 'DESC' },
    });

    return {
      meta: {
        current: page,
        pageSize: limit,
        pages: Math.ceil(total / limit),
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

  async toggleUserLock(id: number) {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng');
    if (user.role === 'admin')
      throw new BadRequestException('Không thể khóa tài khoản admin');

    user.is_locked = !user.is_locked;
    await this.userRepository.save(user);
    return {
      id: user.id,
      is_locked: user.is_locked,
      message: user.is_locked ? 'Đã khóa tài khoản' : 'Đã mở khóa tài khoản',
    };
  }

  async changeUserRole(id: number, role: string) {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng');

    const validRoles = ['buyer', 'seller', 'admin', 'moderator'];
    if (!validRoles.includes(role))
      throw new BadRequestException('Vai trò không hợp lệ');

    user.role = role as any;
    await this.userRepository.save(user);
    return { id: user.id, role: user.role };
  }

  async updateUser(id: number, dto: UpdateUserByAdminDto) {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng');

    // M-01: Chặn ghi các cột nhạy cảm — DTO chỉ là type hint, validation pipe ở
    // controller mới lọc, nhưng service có thể được gọi trực tiếp (test, script).
    // Danh sách cột CẤM: password, role, token_version, is_locked, refresh_token.
    const cam = ['password', 'role', 'token_version', 'is_locked', 'refresh_token'] as const;
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

    await this.userRepository.softDelete(id);
    return { message: 'Xóa người dùng thành công' };
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

    const [result, total] = await this.withdrawalRepository.findAndCount({
      where,
      relations: ['user', 'approved_by'],
      skip: (page - 1) * limit,
      take: limit,
      order: { created_at: 'DESC' },
    });

    return {
      meta: {
        current: page,
        pageSize: limit,
        pages: Math.ceil(total / limit),
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
