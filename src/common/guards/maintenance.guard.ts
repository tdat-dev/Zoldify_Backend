import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SettingsService } from '../../settings/settings.service';

/**
 * Maintenance Guard
 * 
 * Kiểm tra cờ `maintenance_mode` từ SettingsService.
 * Nếu hệ thống đang bảo trì, chặn TẤT CẢ request và trả về lỗi 503, TRỪ các trường hợp:
 * - Request đến `/api/admin/*` (để Admin thao tác)
 * - Request đến `/api/auth/*` (để Admin đăng nhập)
 * - Request đến `/api/settings/public` (để Frontend check trạng thái bảo trì)
 */
@Injectable()
export class MaintenanceGuard implements CanActivate {
  constructor(private readonly settingsService: SettingsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const path = request.path;

    // Các đường dẫn cho phép bypass kể cả khi bảo trì
    const allowedPaths = [
      '/api/v1/admin',
      '/api/v1/auth',
      '/api/v1/settings',
    ];
    const isAllowed = allowedPaths.some((allowedPath) => path.startsWith(allowedPath));

    if (isAllowed) {
      return true;
    }

    const isMaintenance = await this.settingsService.getValue('maintenance_mode');
    
    if (isMaintenance === 'true') {
      throw new ServiceUnavailableException('Hệ thống đang được bảo trì. Vui lòng quay lại sau.');
    }

    return true;
  }
}
