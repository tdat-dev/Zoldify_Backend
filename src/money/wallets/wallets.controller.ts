import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { WalletsService } from './wallets.service';
import { ResponseMessage } from '@common/decorators/response.decorator';
import { User } from '@common/decorators/user.decorator';
import type { IUser } from '@identity/users/users.interface';
import { TopupDto } from './dto/topup.dto';
import { TransferDto } from './dto/transfer.dto';
import { WalletTransaction } from './entities/wallet-transaction.entity';
import {
  ApiPaginated,
  ApiShape,
} from '@common/decorators/api-response.decorator';
import { JwtAuthGuard } from '@identity/auth/jwt-auth.guard';
import { AdminGuard } from '@common/guards/admin.guard';

/**
 * Guard đặt ở CẤP LỚP, không rải từng route.
 *
 * Tới 14/08 lớp này không có guard nào cả. Bốn route đều đọc `user.id` từ
 * `@User()`, mà `@User()` chỉ trả `request.user` — thứ do JwtAuthGuard gắn vào.
 * Không guard thì `request.user` là undefined, nên cả bốn route trả 500 cho
 * người lạ thay vì 401. Đặt ở cấp lớp để route thêm sau này không thể quên.
 */
@Controller('wallets')
@UseGuards(JwtAuthGuard)
export class WalletsController {
  constructor(private readonly walletsService: WalletsService) {}

  /**
   * Nạp ví thủ công — CHỈ admin.
   *
   * Hàm `WalletsService.topup()` cộng thẳng vào sổ cái mà không đòi bằng chứng
   * tiền thật đã về. Chú thích của chính nó đã nói rõ nó dành cho "thao tác tay
   * của admin". Trước hôm nay route này không có guard nào, tức là nó phơi một
   * hàm in tiền ra Internet.
   *
   * Người dùng nạp tiền bằng PayOS: POST /payos/create-link type = topup.
   */
  @UseGuards(AdminGuard)
  @Post('topup')
  @ResponseMessage('Nạp ví thành công')
  topup(@User() user: IUser, @Body() dto: TopupDto) {
    return this.walletsService.topup(
      user.id,
      dto.amount,
      dto.reference,
      dto.note,
    );
  }

  @ApiShape({ balance: 'number' })
  @Get('balance')
  @ResponseMessage('Lấy số dư vì thành công')
  getBalance(@User() user: IUser) {
    return this.walletsService.getBalance(user.id);
  }

  @ApiPaginated(WalletTransaction)
  @Get('transactions')
  @ResponseMessage('Lấy lịch sử giao dịch thành công')
  getTransactions(
    @Query('page') page: string,
    @Query('limit') limit: string,
    @Query('type') type: string,
    @User() user: IUser,
  ) {
    return this.walletsService.getTransactions(
      user.id,
      +page || 1,
      +limit || 20,
      type,
    );
  }

  @Post('transfer')
  @ResponseMessage('Chuyển tiền thành công')
  transfer(@Body() dto: TransferDto, @User() user: IUser) {
    return this.walletsService.transfer(
      user.id,
      dto.to_user_id,
      dto.amount,
      dto.note,
    );
  }
}
