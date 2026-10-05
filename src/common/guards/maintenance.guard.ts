import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { SettingsService } from '@ops/settings/settings.service';

export const MAINTENANCE_KEY = 'maintenance_mode';

/**
 * Chế độ bảo trì — chặn ở TẦNG API, không phải tầng giao diện.
 *
 * VÌ SAO PHẢI Ở ĐÂY: trang /maintenance bên frontend chỉ là một tấm biển. Chặn
 * bằng cách chuyển hướng trình duyệt thì ai gọi thẳng API vẫn đặt được hàng,
 * vẫn thanh toán, vẫn sửa dữ liệu — mà "bảo trì" thường có nghĩa là đang chạy
 * migration, tức là đúng lúc KHÔNG được có ai ghi vào database. Một công tắc
 * bảo trì không chặn được ai còn nguy hơn là không có, vì admin sẽ tin là site
 * đã đóng.
 *
 * BỐN LỐI LUÔN MỞ, và mỗi lối có lý do bắt buộc:
 *
 *  1. admin — nếu không thì bật xong là tự nhốt mình ở ngoài, không ai tắt được.
 *  2. /auth/* — admin phải ĐĂNG NHẬP ĐƯỢC ĐÃ rồi mới là admin. Chặn lối này
 *     thì khoá luôn cả người duy nhất có quyền mở khoá.
 *  3. /settings/public — chính là chỗ frontend đọc cờ. Chặn nó thì middleware
 *     không biết site đang bảo trì, và không ai được chuyển tới trang thông báo.
 *  4. GET /settings — bảng quản trị đọc trạng thái công tắc để vẽ đúng.
 *
 * ĐỌC CÓ NHỚ TẠM: cờ này bị hỏi ở MỌI request. Truy vấn database mỗi lần là
 * thêm một round-trip cho mỗi lượt gọi API chỉ để đọc một chữ "true"/"false".
 * Nhớ tạm 10 giây: đủ ngắn để bật/tắt thấy tác dụng gần như tức thì, đủ dài để
 * gánh nặng bằng không.
 */
@Injectable()
export class MaintenanceGuard implements CanActivate {
  private cache: { value: boolean; expiresAt: number } = {
    value: false,
    expiresAt: 0,
  };

  constructor(
    private readonly settingsService: SettingsService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Tự đọc vai trò từ token, KHÔNG dựa vào req.user.
   *
   * Đây là chỗ tôi đã đoán sai và phép thử bắt được: guard TOÀN CỤC chạy TRƯỚC
   * guard cấp controller/route trong Nest, không phải sau. Nên khi guard này
   * chạy thì JwtAuthGuard chưa chạy và req.user vẫn rỗng — kể cả admin. Kết quả
   * đo được: admin bật bảo trì xong tự nhốt mình ở ngoài, GET /admin/stats trả
   * 503, không còn đường nào tắt công tắc ngoài việc sửa thẳng database.
   *
   * VERIFY chứ không decode: `jwt.decode` chỉ tách chuỗi ra chứ không kiểm chữ
   * ký, nên ai cũng tự đúc được một token ghi role:'admin' và đi xuyên qua chế
   * độ bảo trì.
   */
  private async isAdmin(req: Request): Promise<boolean> {
    const header = req.headers?.authorization;
    if (!header?.startsWith('Bearer ')) return false;
    try {
      const payload = await this.jwtService.verifyAsync(header.slice(7), {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET') || '',
      });
      return payload?.role === 'admin';
    } catch {
      // Token hỏng/hết hạn thì coi như khách. Không ném lỗi ở đây: việc báo
      // "token không hợp lệ" là của JwtAuthGuard, guard này chỉ hỏi đúng một
      // câu "có phải admin không".
      return false;
    }
  }

  private async isMaintenanceOn(): Promise<boolean> {
    const now = Date.now();
    if (now < this.cache.expiresAt) return this.cache.value;
    let value = false;
    try {
      value = (await this.settingsService.getValue(MAINTENANCE_KEY)) === 'true';
    } catch {
      // Database hỏng thì KHÔNG đóng cửa site. Bảo trì là một quyết định của
      // con người; một lỗi đọc bảng settings không phải là quyết định đó.
      value = this.cache.value;
    }
    this.cache = { value, expiresAt: now + 10_000 };
    return value;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { user?: any }>();

    // req.path đã bỏ tiền tố /api/v1 chưa thì tuỳ cấu hình, nên xét cả hai dạng.
    const path = req.path || req.url || '';
    const alwaysOpen =
      path.includes('/auth/') ||
      path.endsWith('/settings/public') ||
      (req.method === 'GET' && path.endsWith('/settings')) ||
      path.endsWith('/health');
    if (alwaysOpen) return true;

    if (!(await this.isMaintenanceOn())) return true;

    if (await this.isAdmin(req)) return true;

    throw new ServiceUnavailableException(
      'Zoldify đang bảo trì. Bạn quay lại sau một lát nhé.',
    );
  }
}
