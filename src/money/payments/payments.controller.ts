import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Query, Req } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { JwtAuthGuard } from '@identity/auth/jwt-auth.guard';
import { ResponseMessage } from '@common/decorators/response.decorator';
import { User } from '@common/decorators/user.decorator';
import type { IUser } from '@identity/users/users.interface';

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService
  ) {}


  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Xử lý thanh toán thành công')
  @Post()
  create(@Body() createPaymentDto: CreatePaymentDto, @User() user: IUser) {
    return this.paymentsService.create(createPaymentDto, user);
  }

  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Lấy danh sách giao dịch thành công')
  @Get()
  findAll(
    @Query('currentPage') currentPage: string,
    @Query('limit') limit: string,
    @Query('type') type: string,
    @User() user: IUser,
  ) {
    return this.paymentsService.findAll(currentPage, limit, type, user);
  }

  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Lấy số dư ví thành công')
  @Get('wallet/balance')
  getBalance(@User() user: IUser) {
    return this.paymentsService.getBalance(user);
  }

  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Lấy chi tiết giao dịch thành công')
  @Get(':id')
  findOne(@Param('id') id: string, @User() user: IUser) {
    return this.paymentsService.findOne(+id, user);
  }

  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Cập nhật giao dịch thành công')
  @Patch(':id')
  update(@Param('id') id: string, @Body() updatePaymentDto: UpdatePaymentDto, @User() user: IUser) {
    return this.paymentsService.update(+id, updatePaymentDto, user);
  }

  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Xóa giao dịch thành công')
  @Delete(':id')
  remove(@Param('id') id: string, @User() user: IUser) {
    return this.paymentsService.remove(+id, user);
  }
}

