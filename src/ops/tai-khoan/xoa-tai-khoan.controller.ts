import { Body, Controller, Delete, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@identity/auth/jwt-auth.guard';
import { User } from '@common/decorators/user.decorator';
import type { IUser } from '@identity/users/users.interface';
import { XoaTaiKhoanService } from './xoa-tai-khoan.service';
import { DeleteAccountDto } from './dto/delete-account.dto';

@Controller('auth')
@UseGuards(JwtAuthGuard)
export class XoaTaiKhoanController {
  constructor(private readonly svc: XoaTaiKhoanService) {}

  @Delete('account')
  xoaTaiKhoan(@User() user: IUser, @Body() dto: DeleteAccountDto) {
    return this.svc.xoaTaiKhoan(user.id, dto?.password);
  }
}
