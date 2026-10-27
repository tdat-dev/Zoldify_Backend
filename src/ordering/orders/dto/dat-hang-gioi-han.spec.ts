import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateOrderDto } from './create-order.dto';
import { PaymentMethod } from '@common/enums/payment.enum';

/**
 * POST /orders nhận chuỗi và mảng không giới hạn độ dài.
 *
 * `receiver_name` là varchar(100), `receiver_phone` varchar(20), `province` /
 * `district` varchar(100), `ghn_ward_code` varchar(20): gửi dài hơn là MySQL
 * strict mode ném "Data too long" thành 500, sau khi đơn đã đi qua cả vòng
 * khoá kho. `shipping_address` và `note` là `text` (64KB): không lỗi, nhưng
 * một ghi chú 60KB nằm trên mọi màn đơn hàng và mọi thông báo. Và
 * `cart_item_ids` không trần: một mảng 100 nghìn phần tử là một câu `IN (...)`
 * 100 nghìn tham số.
 *
 * Bài kiểm này đỏ cho tới khi DTO chặn ở cửa (400).
 */
describe('CreateOrderDto có trần cho mọi chuỗi và mảng', () => {
  const hopLe = {
    shipping_address: 'So 1 duong A',
    receiver_name: 'Nguoi Nhan',
    receiver_phone: '0900000000',
    payment_method: PaymentMethod.COD,
    ghn_district_id: 1442,
    ghn_ward_code: '20101',
  };

  const loi = async (them: Record<string, unknown>) =>
    (
      await validate(plainToInstance(CreateOrderDto, { ...hopLe, ...them }))
    ).map((e) => e.property);

  it('đơn hợp lệ không có lỗi', async () => {
    expect(await loi({})).toEqual([]);
    expect(
      await loi({ cart_item_ids: [1, 2, 3], note: 'Giao giờ hành chính' }),
    ).toEqual([]);
  });

  it.each([
    ['receiver_name', 101],
    ['receiver_phone', 21],
    ['shipping_address', 256],
    ['province', 101],
    ['district', 101],
    ['ghn_ward_code', 21],
    ['note', 501],
  ])('%s dài hơn %i ký tự bị từ chối', async (truong, dai) => {
    expect(await loi({ [truong]: 'x'.repeat(dai) })).toContain(truong);
    // Đúng trần thì vẫn qua.
    expect(await loi({ [truong]: 'x'.repeat(dai - 1) })).not.toContain(truong);
  });

  it('cart_item_ids: rỗng, quá 50 phần tử, hay phần tử không nguyên đều bị từ chối', async () => {
    expect(await loi({ cart_item_ids: [] })).toContain('cart_item_ids');
    expect(
      await loi({ cart_item_ids: Array.from({ length: 51 }, (_, i) => i + 1) }),
    ).toContain('cart_item_ids');
    expect(await loi({ cart_item_ids: [1, 2.5] })).toContain('cart_item_ids');
    expect(
      await loi({ cart_item_ids: Array.from({ length: 50 }, (_, i) => i + 1) }),
    ).not.toContain('cart_item_ids');
  });
});
