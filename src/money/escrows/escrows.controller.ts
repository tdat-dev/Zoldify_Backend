import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { EscrowsService } from './escrows.service';
import { JwtAuthGuard } from '@identity/auth/jwt-auth.guard';
import { ResponseMessage } from '@common/decorators/response.decorator';
import { User } from '@common/decorators/user.decorator';
import type { IUser } from '@identity/users/users.interface';
import { Escrow } from './entities/escrow.entity';
import {
  ApiPaginated,
  ApiShape,
} from '@common/decorators/api-response.decorator';

/**
 * Bốn đường ĐỌC ký quỹ.
 *
 * Tới 25/09 cả bốn chỉ có `JwtAuthGuard` và dừng ở đó — không đường nào hỏi
 * người đang gọi là ai. Bất kỳ tài khoản nào đăng nhập, kể cả vừa đăng ký, đều
 * đọc được ký quỹ của cả sàn: ai mua gì của ai, bao nhiêu tiền, mỗi shop đang
 * có bao nhiêu tiền chờ về. Sàn C2C thì các shop cạnh tranh trực tiếp với nhau.
 *
 * Việc kiểm quyền nằm trong `EscrowsService`, không nằm ở đây. Controller là
 * một cửa; service là cái két. Kiểm ở cửa thì cửa thứ hai mở ra sau này — một
 * controller khác, một job, một lời gọi nội bộ — sẽ đi thẳng vào két.
 * Controller chỉ có nhiệm vụ chuyển `user` xuống.
 */
@Controller('escrows')
export class EscrowsController {
  constructor(private readonly escrowsService: EscrowsService) {}

  @UseGuards(JwtAuthGuard)
  @ApiPaginated(Escrow)
  @Get()
  @ResponseMessage('Lấy danh sách escrow thành công')
  findAll(
    @Query('page') page: string,
    @Query('limit') limit: string,
    @Query('status') status: string,
    @User() user: IUser,
  ) {
    return this.escrowsService.findAll(+page || 1, +limit || 20, status, user);
  }

  @UseGuards(JwtAuthGuard)
  @Get('order/:orderId')
  @ResponseMessage('Lấy escrow theo đơn hàng thành công')
  findByOrder(@Param('orderId') orderId: string, @User() user: IUser) {
    return this.escrowsService.findByOrder(+orderId, user);
  }

  @UseGuards(JwtAuthGuard)
  @ApiPaginated(Escrow)
  @Get('seller/:sellerId')
  @ResponseMessage('Lấy escrow của người bán thành công')
  findBySeller(
    @Param('sellerId') sellerId: string,
    @Query('page') page: string,
    @Query('limit') limit: string,
    @Query('status') status: string,
    @User() user: IUser,
  ) {
    return this.escrowsService.findBySeller(
      +sellerId,
      +page || 1,
      +limit || 20,
      status,
      user,
    );
  }

  @UseGuards(JwtAuthGuard)
  @ApiShape({ held_balance: 'number' })
  @Get('held/:sellerId')
  @ResponseMessage('Lấy số dư đang giữ thành công')
  getHeldBalance(@Param('sellerId') sellerId: string, @User() user: IUser) {
    return this.escrowsService.getHeldBalance(+sellerId, user);
  }
}
