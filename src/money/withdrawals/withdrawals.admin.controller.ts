import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { WithdrawalsService } from './withdrawals.service';
import { JwtAuthGuard } from '@identity/auth/jwt-auth.guard';
import { AdminGuard } from '@common/guards/admin.guard';
import { ResponseMessage } from '@common/decorators/response.decorator';
import { User } from '@common/decorators/user.decorator';
import type { IUser } from '@identity/users/users.interface';
import { ProcessWithdrawalDto } from './dto/process-withdrawal.dto';

@Controller('admin/withdrawals')
@UseGuards(JwtAuthGuard, AdminGuard)
export class WithdrawalsAdminController {
  constructor(private readonly withdrawalsService: WithdrawalsService) {}

  @Get()
  @ResponseMessage('Lấy danh sách yêu cầu rút tiền thành công')
  findAll(
    @Query('page') page: string,
    @Query('limit') limit: string,
    @Query('status') status: string,
  ) {
    return this.withdrawalsService.findAll(+page || 1, +limit || 20, status);
  }

  @Patch(':id/approve')
  @ResponseMessage('Duyệt yêu cầu rút tiền thành công')
  approve(@Param('id') id: string, @User() user: IUser) {
    return this.withdrawalsService.approve(+id, user.id);
  }

  @Patch(':id/reject')
  @ResponseMessage('Từ chối yêu cầu rút tiền thành công')
  reject(
    @Param('id') id: string,
    @Body() dto: ProcessWithdrawalDto,
    @User() user: IUser,
  ) {
    return this.withdrawalsService.reject(+id, user.id, dto.note);
  }
}