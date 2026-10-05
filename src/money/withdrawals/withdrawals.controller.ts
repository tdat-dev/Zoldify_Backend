import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Query } from '@nestjs/common';
import { WithdrawalsService } from './withdrawals.service';
import { CreateWithdrawalDto } from './dto/create-withdrawal.dto';
import { UpdateWithdrawalDto } from './dto/update-withdrawal.dto';
import { ResponseMessage } from '@common/decorators/response.decorator';
import type { IUser } from '@identity/users/users.interface'
import { User } from '@common/decorators/user.decorator';
import { JwtAuthGuard } from '@identity/auth/jwt-auth.guard';
import { Withdrawal } from './entities/withdrawal.entity';
import { ApiPaginated } from '@common/decorators/api-response.decorator';

@Controller('withdrawals')
export class WithdrawalsController {
  constructor(private readonly withdrawalsService: WithdrawalsService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  @ResponseMessage('Tạo yêu cầu rút tiền thành công')
  create(@Body() dto: CreateWithdrawalDto, @User() user: IUser) {
    return this.withdrawalsService.create(user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @ApiPaginated(Withdrawal)
  @Get('me')
  @ResponseMessage('Lấy lịch sử rút tiền thành công')
  getMyWithdrawals(
    @Query('page') page: string,
    @Query('limit') limit: string,
    @User() user: IUser,
  ) {
    return this.withdrawalsService.findByUser(user.id, Number(page) || 1, Number(limit) || 20);
  }

  
}
