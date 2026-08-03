import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { EscrowsService } from './escrows.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ResponseMessage } from '../common/decorators/response.decorator';
import { Public } from '../common/decorators/public.decorator';
import { User } from '../common/decorators/user.decorator';
import type { IUser } from '../users/users.interface';

@Controller('escrows')
export class EscrowsController {
  constructor(private readonly escrowsService: EscrowsService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  @ResponseMessage('Lấy danh sách escrow thành công')
  findAll(@Query('page') page: string, @Query('limit') limit: string, @Query('status') status: string) {
    return this.escrowsService.findAll(+page || 1, +limit || 20, status);
  }

  @UseGuards(JwtAuthGuard)
  @Get('order/:orderId')
  @ResponseMessage('Lấy escrow theo đơn hàng thành công')
  findByOrder(@Param('orderId') orderId: string) {
    return this.escrowsService.findByOrder(+orderId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('seller/:sellerId')
  @ResponseMessage('Lấy escrow của người bán thành công')
  findBySeller(
    @Param('sellerId') sellerId: string,
    @Query('page') page: string,
    @Query('limit') limit: string,
    @Query('status') status: string,
  ) {
    return this.escrowsService.findBySeller(+sellerId, +page || 1, +limit || 20, status);
  }

  @UseGuards(JwtAuthGuard)
  @Get('held/:sellerId')
  @ResponseMessage('Lấy số dư đang giữ thành công')
  getHeldBalance(@Param('sellerId') sellerId: string) {
    return this.escrowsService.getHeldBalance(+sellerId);
  }
}