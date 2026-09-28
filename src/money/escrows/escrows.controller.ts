import { Controller, ForbiddenException, Get, Param, Query, UseGuards } from '@nestjs/common';
import { EscrowsService } from './escrows.service';
import { JwtAuthGuard } from '@identity/auth/jwt-auth.guard';
import { AdminGuard } from '@common/guards/admin.guard';
import { ResponseMessage } from '@common/decorators/response.decorator';
import { Public } from '@common/decorators/public.decorator';
import { User } from '@common/decorators/user.decorator';
import type { IUser } from '@identity/users/users.interface';
import { Escrow } from './entities/escrow.entity';
import { ApiPaginated, ApiShape } from '@common/decorators/api-response.decorator';

@Controller('escrows')
export class EscrowsController {
  constructor(private readonly escrowsService: EscrowsService) {}

  // Toàn sàn: chỉ admin. Trước 28/09 ai đăng nhập cũng tải được mọi escrow
  // kèm thông tin người mua/bán (audit B-03).
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiPaginated(Escrow)
  @Get()
  @ResponseMessage('Lấy danh sách escrow thành công')
  findAll(@Query('page') page: string, @Query('limit') limit: string, @Query('status') status: string) {
    return this.escrowsService.findAll(+page || 1, +limit || 20, status);
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
  async findBySeller(
    @Param('sellerId') sellerId: string,
    @Query('page') page: string,
    @Query('limit') limit: string,
    @Query('status') status: string,
    @User() user: IUser,
  ) {
    this.assertSelfOrAdmin(+sellerId, user);
    return this.escrowsService.findBySeller(+sellerId, +page || 1, +limit || 20, status);
  }

  @UseGuards(JwtAuthGuard)
  @ApiShape({ held_balance: 'number' })
  @Get('held/:sellerId')
  @ResponseMessage('Lấy số dư đang giữ thành công')
  async getHeldBalance(@Param('sellerId') sellerId: string, @User() user: IUser) {
    this.assertSelfOrAdmin(+sellerId, user);
    return this.escrowsService.getHeldBalance(+sellerId);
  }

  /** Người bán chỉ xem tiền của chính mình; admin xem của bất kỳ ai. */
  private assertSelfOrAdmin(sellerId: number, user: IUser) {
    if (user.role !== 'admin' && user.id !== sellerId) {
      throw new ForbiddenException('Bạn chỉ xem được escrow của chính mình');
    }
  }
}