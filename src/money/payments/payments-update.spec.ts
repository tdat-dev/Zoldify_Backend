import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { AdminGuard } from '@common/guards/admin.guard';
import { IUser } from '@identity/users/users.interface';
import { UserRole } from '@identity/users/entities/user.entity';
import {
  PaymentStatus,
  PaymentType,
  PaymentMethod,
} from '@common/enums/payment.enum';

/**
 * Bài kiểm cho một lỗ hổng đã bịt (audit A-01, 28/09).
 *
 * `PATCH /api/v1/payments/:id` chỉ cần đăng nhập. Người mua tạo link PayOS là
 * có một Payment PENDING của chính mình; gửi `{"status": "success"}` là
 * `update()` đặt SUCCESS rồi ghi `orders.is_paid = true`. Không đồng nào đi qua
 * sổ cái, không có escrow, nhưng người bán thấy đơn đã trả tiền và giao hàng.
 *
 * Không cần database: điều cần khẳng định là KHÔNG đường nào ở đây ghi được
 * `is_paid`. orderRepository giả nổ ngay nếu bị gọi update.
 */
describe('PaymentsService.update: không đánh dấu đã trả tiền được', () => {
  const buyer: IUser = {
    id: 7,
    email: 'kev@t.local',
    full_name: 'Kẻ thử lách',
    role: UserRole.BUYER,
    avatar: '',
  };
  const admin: IUser = { ...buyer, id: 1, role: UserRole.ADMIN };

  const makeService = () => {
    const payment = {
      id: 42,
      status: PaymentStatus.PENDING,
      type: PaymentType.ORDER_PAYMENT,
      payment_method: PaymentMethod.PAYOS,
      order: { id: 99 },
      user: { id: buyer.id },
    };
    const paymentRepo = {
      findOne: async () => payment,
      save: async (x: unknown) => x,
    };
    const orderRepo = {
      update: () => {
        throw new Error('update() không được phép ghi vào bảng orders');
      },
    };
    const service = new PaymentsService(
      paymentRepo as never,
      orderRepo as never,
      {} as never,
      {} as never,
    );
    return { service, payment };
  };

  it('người mua gửi status=success thì bị cấm, đơn không bị chạm', async () => {
    const { service, payment } = makeService();
    await expect(
      service.update(42, { status: PaymentStatus.SUCCESS }, buyer),
    ).rejects.toThrow(ForbiddenException);
    expect(payment.status).toBe(PaymentStatus.PENDING);
  });

  it('admin cũng không chuyển sang success bằng đường này được', async () => {
    const { service, payment } = makeService();
    await expect(
      service.update(42, { status: PaymentStatus.SUCCESS }, admin),
    ).rejects.toThrow(BadRequestException);
    expect(payment.status).toBe(PaymentStatus.PENDING);
  });

  it('admin vẫn đổi được sang trạng thái không mang tiền (failed)', async () => {
    const { service } = makeService();
    const result: any = await service.update(
      42,
      { status: PaymentStatus.FAILED },
      admin,
    );
    expect(result.status).toBe(PaymentStatus.FAILED);
  });

  it('admin không xoá được giao dịch đã thành công (chứng từ tiền)', async () => {
    const { service, payment } = makeService();
    payment.status = PaymentStatus.SUCCESS;
    await expect(service.remove(42, admin)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('PATCH và DELETE /payments/:id chỉ dành cho admin', () => {
    for (const handler of ['update', 'remove'] as const) {
      const guards: unknown[] =
        Reflect.getMetadata(
          '__guards__',
          PaymentsController.prototype[handler],
        ) ?? [];
      expect(guards).toContain(AdminGuard);
    }
  });
});
