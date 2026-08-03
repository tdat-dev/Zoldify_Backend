import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
import { WalletsService } from './wallets.service';
import { ResponseMessage } from 'src/common/decorators/response.decorator';
import { User } from 'src/common/decorators/user.decorator';
import type { IUser } from 'src/users/users.interface';
import { TopupDto } from './dto/topup.dto';
import { TransferDto } from './dto/transfer.dto';

@Controller('wallets')
export class WalletsController {
  constructor(private readonly walletsService: WalletsService) { }

  @Post('topup')
  @ResponseMessage('Nạp ví thành công')
  topup(@User() user: IUser, @Body() dto: TopupDto) {
    return this.walletsService.topup(user.id, dto.amount, dto.reference, dto.note);
  }

  
  @Get('balance')
  @ResponseMessage('Lấy số dư vì thành công')
  getBalance(@User() user: IUser) {
    return this.walletsService.getBalance(user.id);
  }

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
