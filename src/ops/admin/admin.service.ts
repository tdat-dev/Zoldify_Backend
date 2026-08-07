import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateAdminDto } from './dto/create-admin.dto';
import { UpdateAdminDto } from './dto/update-admin.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Order, OrderStatus } from '@ordering/orders/entities/order.entity';
import { Product } from '@catalog/products/entities/product.entity';
import { ILike, Repository } from 'typeorm';
import { User } from '@identity/users/entities/user.entity';
import { Setting } from '@ops/settings/entities/setting.entity';
import { Withdrawal, WithdrawalStatus } from '@money/withdrawals/entities/withdrawal.entity';

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
  ) { }
  async getUsers(page: number, limit: number, q?: string, role?: string, is_locked?: string) {
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
      meta: { current: page, pageSize: limit, pages: Math.ceil(total / limit), total },
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

    return { ...user, orders_count: ordersCount, products_count: productsCount };
  }

  async toggleUserLock(id: number) {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng');
    if (user.role === 'admin') throw new BadRequestException('Không thể khóa tài khoản admin');

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
    if (!validRoles.includes(role)) throw new BadRequestException('Vai trò không hợp lệ');

    user.role = role as any;
    await this.userRepository.save(user);
    return { id: user.id, role: user.role };
  }

  async updateUser(id: number, dto: Partial<User>) {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng');

    await this.userRepository.update(id, dto);
    return this.userRepository.findOne({ where: { id } });
  }

  async deleteUser(id: number) {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng');
    if (user.role === 'admin') throw new BadRequestException('Không thể xóa tài khoản admin');

    await this.userRepository.softDelete(id);
    return { message: 'Xóa người dùng thành công' };
  }

  async getDashboardStats() {
    const [totalUsers, totalProducts, totalOrders, revenueResult] = await Promise.all([
      this.userRepository.count(),
      this.productRepository.count(),
      this.orderRepository.count(),
      this.orderRepository
        .createQueryBuilder('order')
        .select('COALESCE(SUM(order.final_amount), 0)', 'total')
        .where('order.status = :status', { status: 'delivered' })
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
      let setting = await this.settingRepository.findOne({ where: { key } });
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
      meta: { current: page, pageSize: limit, pages: Math.ceil(total / limit), total },
      result,
    };
  }

  async approveWithdrawal(id: number, adminId: number) {
    const withdrawal = await this.withdrawalRepository.findOne({
      where: { id },
      relations: ['user'],
    });
    if (!withdrawal) throw new NotFoundException('Không tìm thấy yêu cầu rút tiền');
    if (withdrawal.status !== WithdrawalStatus.PENDING) {
      throw new BadRequestException('Yêu cầu đã được xử lý');
    }

    withdrawal.status = WithdrawalStatus.APPROVED;
    withdrawal.approved_by = { id: adminId } as any;
    withdrawal.processed_at = new Date();
    return this.withdrawalRepository.save(withdrawal);
  }

  async rejectWithdrawal(id: number, adminId: number, note?: string) {
    const withdrawal = await this.withdrawalRepository.findOne({
      where: { id },
      relations: ['user'],
    });
    if (!withdrawal) throw new NotFoundException('Không tìm thấy yêu cầu rút tiền');
    if (withdrawal.status !== WithdrawalStatus.PENDING) {
      throw new BadRequestException('Yêu cầu đã được xử lý');
    }

    await this.userRepository.increment(
      { id: withdrawal.user.id },
      'balance',
      Number(withdrawal.amount),
    );

    withdrawal.status = WithdrawalStatus.REJECTED;
    withdrawal.note = note || '';
    withdrawal.approved_by = { id: adminId } as any;
    withdrawal.processed_at = new Date();
    return this.withdrawalRepository.save(withdrawal);
  }



}
