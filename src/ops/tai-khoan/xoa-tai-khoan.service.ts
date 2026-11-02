import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { compareSync } from 'bcrypt';
import { ProductsService } from '@catalog/products/products.service';
import { LedgerService } from '@money/ledger/ledger.service';
import { LedgerOwnerType, LedgerPurpose } from '@money/ledger/ledger.types';
import { UserRole } from '@identity/users/entities/user.entity';
import { formatMoney } from '@common/money';

/** Mọi trạng thái chưa kết thúc của `OrderStatus` (giống products.service). */
const DON_CHUA_XONG = `('pending', 'confirmed', 'processing', 'shipping')`;

/** Tên hiển thị thay cho tên thật sau khi xoá: đánh giá, tin nhắn cũ vẫn còn. */
const TEN_DA_XOA = 'Tài khoản đã xoá';

/** Mã lý do chặn, cho app rẽ nhánh mà không phải đọc câu chữ. */
export type LyDoChanXoa = 'open_orders' | 'escrow_holding' | 'wallet_balance';

/**
 * Người dùng tự xoá tài khoản (D-14, E2E mobile 02/11; Google Play bắt buộc).
 *
 * VÌ SAO NẰM Ở `ops` CHỨ KHÔNG Ở `identity/auth`. Xoá tài khoản phải hỏi đơn
 * hàng (ordering), ký quỹ và ví (money), rồi ẩn hàng (catalog). Luật ranh giới
 * cấm identity với sang ba nhóm đó; `ops` là nhóm duy nhất được gọi tất cả, và
 * `AdminService.deleteUser` cũng ở đây vì đúng lý do ấy. Route vẫn là
 * `/auth/account` cho app dễ tìm.
 *
 * KHÁC GÌ ADMIN XOÁ. Admin xoá mềm và GIỮ email, tên, số điện thoại để còn
 * khôi phục (đăng nhập Google bằng email đó bị báo "liên hệ hỗ trợ để khôi
 * phục"). Người dùng tự xoá thì dữ liệu cá nhân phải đi thật: tên, email, số
 * điện thoại, ảnh, địa chỉ bị xoá trắng; email gốc được trả lại nên đăng ký lại
 * bằng nó là một tài khoản mới tinh.
 *
 * Dòng `users` KHÔNG bị xoá cứng: đơn, đánh giá, tin nhắn, bút toán sổ cái đều
 * trỏ vào nó, và sổ cái thì không được mất dòng nào.
 */
@Injectable()
export class XoaTaiKhoanService {
  private readonly logger = new Logger(XoaTaiKhoanService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly productsService: ProductsService,
    private readonly ledger: LedgerService,
  ) {}

  async xoaTaiKhoan(
    userId: number,
    password?: string,
  ): Promise<{ message: string }> {
    const [u] = await this.dataSource.query<
      Array<{ id: number; role: UserRole; password: string | null }>
    >(
      'SELECT id, role, password FROM users WHERE id = ? AND deleted_at IS NULL',
      [userId],
    );
    if (!u) throw new NotFoundException('Người dùng không tồn tại');

    // Quản trị viên tự xoá mình là mất một người giữ chìa khoá mà không ai
    // duyệt. Muốn nghỉ thì quản trị viên khác hạ vai trò rồi mới xoá.
    if (u.role === UserRole.ADMIN || u.role === UserRole.MODERATOR) {
      throw new BadRequestException(
        'Tài khoản quản trị không tự xoá được. Nhờ quản trị viên khác hạ vai trò trước.',
      );
    }

    // Tài khoản Google được tạo với password = '' (auth.controller firebaseLogin):
    // họ chưa từng có mật khẩu nên không có gì để gõ lại. Đã đăng nhập bằng
    // Google là đã chứng minh chủ tài khoản ở lượt cấp token.
    if (u.password) {
      if (!password) {
        throw new BadRequestException(
          'Nhập mật khẩu hiện tại để xác nhận xoá tài khoản',
        );
      }
      if (!compareSync(password, u.password)) {
        throw new BadRequestException('Mật khẩu không chính xác');
      }
    }

    await this.chanNeuCon(userId);

    // Ẩn hàng TRƯỚC rồi đếm lại đơn bán: giữa lần đếm ở trên và lúc ẩn, một
    // người mua vẫn có thể vừa đặt món của người này. Ẩn xong thì không ai đặt
    // thêm được nữa, đếm lại mà thấy đơn mới thì bày hàng ra lại và từ chối.
    await this.productsService.anHangCuaNguoiBan(userId);
    if ((await this.demDonBan(userId)) > 0) {
      await this.productsService.moLaiHangCuaNguoiBan(userId);
      await this.chanNeuCon(userId);
    }

    await this.dataSource.transaction(async (em) => {
      // token_version + 1: mọi access token đang cầm bị JwtStrategy từ chối,
      // refresh token cũng chết (refresh so token_version). is_locked chặn
      // login() nếu ai đó còn đường vào. Email đổi sang địa chỉ không gửi được
      // (.invalid, RFC 2606) để trả email gốc lại cho khoá UNIQUE.
      await em.query(
        `UPDATE users
            SET full_name = ?, email = ?, phone_number = NULL, avatar = NULL,
                gender = NULL, password = '', refresh_token = NULL,
                email_verified = 0, is_locked = 1,
                token_version = token_version + 1, deleted_at = NOW(6)
          WHERE id = ?`,
        [TEN_DA_XOA, `deleted-${userId}@deleted.zoldify.invalid`, userId],
      );
      // Đóng shop và xoá số điện thoại, địa chỉ lấy hàng: không còn đơn nào
      // đang giao nên GHN không cần tới chúng nữa.
      await em.query(
        `UPDATE shops
            SET status = 'inactive', phone = NULL, address = NULL,
                pickup_name = NULL, pickup_phone = NULL, pickup_address = NULL
          WHERE user_id = ?`,
        [userId],
      );
      // Đơn cũ đã chụp lại người nhận/địa chỉ vào chính nó, nên xoá sổ địa chỉ
      // không làm hỏng lịch sử đơn của người bán.
      await em.query('DELETE FROM addresses WHERE user_id = ?', [userId]);
    });

    // Ngoài transaction và nuốt lỗi, giống logout(): phiên đã chết ở trên,
    // còn sót push token thì cùng lắm máy nhận thêm vài thông báo tới khi FCM
    // báo token chết.
    try {
      await this.dataSource.query('DELETE FROM push_tokens WHERE user_id = ?', [
        userId,
      ]);
    } catch (err) {
      this.logger.warn(
        `Không gỡ được push token khi xoá tài khoản ${userId}: ${(err as Error).message}`,
      );
    }

    return { message: 'Đã xoá tài khoản' };
  }

  /** Ném 400 kèm mọi lý do còn chặn, để người dùng xử lý một lượt cho xong. */
  private async chanNeuCon(userId: number): Promise<void> {
    const lyDo: Array<{ code: LyDoChanXoa; message: string }> = [];

    const [mua, ban] = await Promise.all([
      this.demDonMua(userId),
      this.demDonBan(userId),
    ]);
    if (mua + ban > 0) {
      const phan = [
        mua > 0 ? `${mua} đơn mua` : '',
        ban > 0 ? `${ban} đơn bán` : '',
      ].filter(Boolean);
      lyDo.push({
        code: 'open_orders',
        message:
          `Bạn còn ${phan.join(' và ')} chưa hoàn tất. ` +
          'Hoàn tất hoặc huỷ các đơn này trước khi xoá tài khoản.',
      });
    }

    // Đơn đã "delivered" mà tiền còn đang giữ ký quỹ (chờ hết hạn khiếu nại)
    // thì người mua còn quyền khiếu nại, người bán còn tiền sắp về.
    const [{ n: kyQuy }] = await this.dataSource.query<Array<{ n: string }>>(
      `SELECT COUNT(*) AS n FROM escrows
        WHERE status = 'holding' AND (buyer_id = ? OR seller_id = ?)`,
      [userId, userId],
    );
    if (Number(kyQuy) > 0) {
      lyDo.push({
        code: 'escrow_holding',
        message:
          `Còn ${Number(kyQuy)} khoản tiền đơn hàng đang được giữ chờ hoàn tất. ` +
          'Đợi các khoản này được giải ngân hoặc hoàn tiền rồi xoá tài khoản.',
      });
    }

    const [khaDung, choRut] = await Promise.all([
      this.ledger.getBalance(
        LedgerOwnerType.USER,
        userId,
        LedgerPurpose.AVAILABLE,
      ),
      this.ledger.getBalance(
        LedgerOwnerType.USER,
        userId,
        LedgerPurpose.WITHDRAWAL_PENDING,
      ),
    ]);
    if (khaDung !== 0n || choRut !== 0n) {
      const cau: string[] = [];
      if (khaDung !== 0n) {
        cau.push(
          `Ví của bạn còn ${formatMoney(Number(khaDung))}. ` +
            'Rút hết tiền về ngân hàng trước khi xoá tài khoản.',
        );
      }
      if (choRut !== 0n) {
        cau.push(
          `Còn lệnh rút ${formatMoney(Number(choRut))} đang chờ chuyển khoản. ` +
            'Đợi lệnh rút hoàn tất rồi xoá tài khoản.',
        );
      }
      lyDo.push({ code: 'wallet_balance', message: cau.join(' ') });
    }

    if (lyDo.length > 0) {
      throw new BadRequestException({
        message: lyDo.map((l) => l.message).join(' '),
        error: 'Bad Request',
        reasons: lyDo.map((l) => l.code),
      });
    }
  }

  private async demDonMua(userId: number): Promise<number> {
    const [{ n }] = await this.dataSource.query<Array<{ n: string }>>(
      `SELECT COUNT(*) AS n FROM orders
        WHERE user_id = ? AND deleted_at IS NULL AND status IN ${DON_CHUA_XONG}`,
      [userId],
    );
    return Number(n);
  }

  /** Đơn chưa xong có ít nhất một món của người này (đơn nhiều người bán). */
  private async demDonBan(userId: number): Promise<number> {
    const [{ n }] = await this.dataSource.query<Array<{ n: string }>>(
      `SELECT COUNT(DISTINCT o.id) AS n
         FROM products p
         JOIN order_items oi ON oi.product_id = p.id
         JOIN orders o ON o.id = oi.order_id
        WHERE p.seller_id = ?
          AND o.deleted_at IS NULL
          AND o.status IN ${DON_CHUA_XONG}`,
      [userId],
    );
    return Number(n);
  }
}
