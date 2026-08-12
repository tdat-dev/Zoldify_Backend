import { Controller, Get, Body, Patch, UseGuards } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { ResponseMessage } from '@common/decorators/response.decorator';
import { Public } from '@common/decorators/public.decorator';
import { JwtAuthGuard } from '@identity/auth/jwt-auth.guard';
import { AdminGuard } from '@common/guards/admin.guard';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Public()
  @Get('public')
  @ResponseMessage('Lấy thông tin cài đặt công khai thành công')
  getPublic() {
    return this.settingsService.getPublic();
  }

  /**
   * ĐỌC được thì cần đăng nhập; GHI thì phải là admin.
   *
   * Bản trước hai endpoint dưới đây chỉ có JwtAuthGuard, nghĩa là BẤT KỲ tài
   * khoản nào đăng nhập cũng sửa được cài đặt toàn hệ thống — đổi tên site, đổi
   * mô tả, và (từ nay) bật được chế độ bảo trì để đóng cửa cả sàn. Không có gì
   * trong giao diện dẫn tới đó, nhưng endpoint thì gọi thẳng bằng curl là xong.
   *
   * AdminGuard đã có sẵn trong repo từ trước, chỉ là chỗ này quên gắn.
   */
  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get()
  @ResponseMessage('Lấy tất cả thông tin cài đặt thành công')
  findAll() {
    return this.settingsService.findAll();
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Patch()
  @ResponseMessage('Cập nhập cài đặt thành công')
  update(@Body() updates: Record<string, string>) {
    return this.settingsService.update(updates);
  }
}
