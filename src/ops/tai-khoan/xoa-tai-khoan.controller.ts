import { Body, Controller, Delete, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBody } from '@nestjs/swagger';
import { JwtAuthGuard } from '@identity/auth/jwt-auth.guard';
import { User } from '@common/decorators/user.decorator';
import { ResponseMessage } from '@common/decorators/response.decorator';
import { ApiEntity } from '@common/decorators/api-response.decorator';
import { MessageResponseDto } from '@common/dto/message-response.dto';
import type { IUser } from '@identity/users/users.interface';
import { XoaTaiKhoanService } from './xoa-tai-khoan.service';
import { DeleteAccountDto } from './dto/delete-account.dto';

/**
 * Cùng tiền tố `auth` với AuthController để app tìm thấy ở chỗ quen
 * (`DELETE /api/v1/auth/account`); lý do tách ra `ops` ghi ở service.
 */
@Controller('auth')
@UseGuards(JwtAuthGuard)
export class XoaTaiKhoanController {
  constructor(private readonly svc: XoaTaiKhoanService) {}

  /**
   * Xoá tài khoản của chính người đang đăng nhập.
   *
   * 400 kèm `reasons` (`open_orders`, `escrow_holding`, `wallet_balance`) khi
   * còn việc dở; 400 khi thiếu/sai mật khẩu với tài khoản có mật khẩu.
   */
  // Nhịp như đổi mật khẩu: mỗi lần gọi là một lần so bcrypt, không để ai dùng
  // route này dò mật khẩu bằng token lấy được.
  @Throttle({
    short: { limit: 1, ttl: 1000 },
    medium: { limit: 5, ttl: 60000 },
  })
  @ApiEntity(MessageResponseDto)
  @ApiBody({ type: DeleteAccountDto, required: false })
  @Delete('account')
  @ResponseMessage('Xoá tài khoản thành công')
  xoaTaiKhoan(@User() user: IUser, @Body() dto: DeleteAccountDto) {
    // `dto` có thể rỗng: tài khoản Google gọi không kèm body.
    return this.svc.xoaTaiKhoan(user.id, dto?.password);
  }
}
