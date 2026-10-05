import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import type { IUser } from '@identity/users/users.interface';
import { User } from '@identity/users/entities/user.entity';
import { Product } from '@catalog/products/entities/product.entity';
import { Order } from '@ordering/orders/entities/order.entity';
import { Review } from './entities/review.entity';
import { InteractionsService } from './interactions.service';

/**
 * ĐÁNH GIÁ SẢN PHẨM — module này trước hôm nay không có bài kiểm nào.
 *
 * Ba bất biến ở đây đều là PHÂN QUYỀN, và chúng nằm trọn trong mã TypeScript
 * chứ không trong database — nên repository giả là cách kiểm trung thực, cùng
 * quy tắc đã ghi ở `follows.service.spec.ts`: kiểm ở nơi bất biến thật sự sống.
 *
 *   1. Chưa mua thì không được đánh giá. Không có nó, bất kỳ ai cũng dìm sao
 *      shop đối thủ — trên một sàn C2C thì các shop cạnh tranh trực tiếp.
 *   2. Mỗi người một đánh giá cho một sản phẩm. Không có nó, một tài khoản
 *      bơm được điểm trung bình lên hoặc xuống bao nhiêu tuỳ thích.
 *   3. Chỉ người viết hoặc admin mới sửa/xoá được.
 *
 * Điều kiện "đã mua" khắt khe hơn nghe tưởng: đơn phải THUỘC VỀ người đó, phải
 * ở trạng thái `delivered`, VÀ phải chứa đúng sản phẩm ấy. Bỏ sót một trong ba
 * là mở một đường khác nhau để đánh giá hàng chưa từng mua.
 */
describe('InteractionsService — ai được đánh giá cái gì', () => {
  const nguoiMua: IUser = { id: 7, role: 'buyer' } as IUser;
  const nguoiKhac: IUser = { id: 8, role: 'buyer' } as IUser;
  const quanTri: IUser = { id: 9, role: 'admin' } as IUser;

  /**
   * `create` dựng một QueryBuilder để hỏi "người này đã mua chưa". Mock trả về
   * đúng thứ `getOne()` trả: một đơn, hoặc null.
   */
  function orderRepoGia(daMua: boolean) {
    const qb = {
      innerJoin: () => qb,
      where: () => qb,
      andWhere: () => qb,
      getOne: () => Promise.resolve(daMua ? ({ id: 1 } as Order) : null),
    };
    return {
      createQueryBuilder: () => qb,
    } as unknown as Repository<Order>;
  }

  function dungService(opts: {
    sanPham?: Partial<Product> | null;
    daMua?: boolean;
    daDanhGia?: Partial<Review> | null;
    danhGiaTheoId?: Partial<Review> | null;
  }) {
    const daLuu: Array<Partial<Review>> = [];
    const daXoaMem: number[] = [];

    const reviewRepo = {
      findOne: ({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(
          // `create` hỏi theo (user, product); `update`/`remove` hỏi theo id.
          'id' in where
            ? (opts.danhGiaTheoId ?? null)
            : (opts.daDanhGia ?? null),
        ),
      create: (r: Partial<Review>) => r,
      save: (r: Partial<Review>) => {
        daLuu.push(r);
        return Promise.resolve(r);
      },
      softDelete: (id: number) => {
        daXoaMem.push(id);
        return Promise.resolve({ affected: 1 });
      },
    } as unknown as Repository<Review>;

    const service = new InteractionsService(
      {} as Repository<User>,
      {
        findOne: () => Promise.resolve(opts.sanPham ?? null),
      } as unknown as Repository<Product>,
      reviewRepo,
      orderRepoGia(opts.daMua ?? false),
    );

    return { service, daLuu, daXoaMem };
  }

  const dto = { product_id: 100, order_id: 500, rating: 5, comment: 'tot' };

  // ── Tạo đánh giá ─────────────────────────────────────────────────────────
  it('sản phẩm không tồn tại → NotFound', async () => {
    const { service } = dungService({ sanPham: null });
    await expect(service.create(dto, nguoiMua)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('CHƯA MUA thì không được đánh giá', async () => {
    // Bất biến quan trọng nhất của file. `getOne()` trả null nghĩa là không có
    // đơn nào vừa thuộc về người này, vừa đã giao, vừa chứa sản phẩm này.
    const { service, daLuu } = dungService({
      sanPham: { id: 100 },
      daMua: false,
    });

    await expect(service.create(dto, nguoiMua)).rejects.toThrow(
      BadRequestException,
    );
    expect(daLuu).toHaveLength(0);
  });

  it('đã mua thì đánh giá được', async () => {
    const { service, daLuu } = dungService({
      sanPham: { id: 100 },
      daMua: true,
      daDanhGia: null,
    });

    await service.create(dto, nguoiMua);
    expect(daLuu).toHaveLength(1);
    expect(daLuu[0].rating).toBe(5);
  });

  it('KHÔNG được đánh giá cùng một sản phẩm hai lần', async () => {
    // Thiếu chặn này thì một tài khoản bơm điểm trung bình lên hay xuống bao
    // nhiêu tuỳ thích, chỉ bằng cách gửi lại cùng một request.
    const { service, daLuu } = dungService({
      sanPham: { id: 100 },
      daMua: true,
      daDanhGia: { id: 1 },
    });

    await expect(service.create(dto, nguoiMua)).rejects.toThrow(
      BadRequestException,
    );
    expect(daLuu).toHaveLength(0);
  });

  // ── Sửa và xoá ───────────────────────────────────────────────────────────
  it('không sửa được đánh giá của người khác', async () => {
    const { service, daLuu } = dungService({
      danhGiaTheoId: { id: 1, user: { id: nguoiMua.id } as User },
    });

    await expect(service.update(1, { rating: 1 }, nguoiKhac)).rejects.toThrow(
      BadRequestException,
    );
    expect(daLuu).toHaveLength(0);
  });

  it('chính chủ sửa được', async () => {
    const { service, daLuu } = dungService({
      danhGiaTheoId: { id: 1, user: { id: nguoiMua.id } as User, rating: 5 },
    });

    await service.update(1, { rating: 2 }, nguoiMua);
    expect(daLuu[0].rating).toBe(2);
  });

  it('admin sửa được đánh giá của người khác', async () => {
    // Cần cho việc gỡ nội dung vi phạm. Nhưng nó cũng là lý do task #34 tồn
    // tại: admin sửa đánh giá của người khác phải để lại vết trong
    // `admin_action_logs`.
    const { service, daLuu } = dungService({
      danhGiaTheoId: { id: 1, user: { id: nguoiMua.id } as User, rating: 5 },
    });

    await service.update(1, { rating: 3 }, quanTri);
    expect(daLuu[0].rating).toBe(3);
  });

  it('không xoá được đánh giá của người khác', async () => {
    const { service, daXoaMem } = dungService({
      danhGiaTheoId: { id: 1, user: { id: nguoiMua.id } as User },
    });

    await expect(service.remove(1, nguoiKhac)).rejects.toThrow(
      BadRequestException,
    );
    expect(daXoaMem).toHaveLength(0);
  });

  it('xoá là XOÁ MỀM, không mất bản ghi', async () => {
    // `softDelete` chứ không `delete`: đánh giá đã xoá vẫn là bằng chứng khi
    // có tranh chấp giữa người mua và người bán.
    const { service, daXoaMem } = dungService({
      danhGiaTheoId: { id: 1, user: { id: nguoiMua.id } as User },
    });

    await service.remove(1, nguoiMua);
    expect(daXoaMem).toEqual([1]);
  });

  it('sửa đánh giá không tồn tại → NotFound', async () => {
    const { service } = dungService({ danhGiaTheoId: null });
    await expect(service.update(999, { rating: 1 }, nguoiMua)).rejects.toThrow(
      NotFoundException,
    );
  });
});
