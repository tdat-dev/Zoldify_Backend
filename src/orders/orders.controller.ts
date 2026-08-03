import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Query, ForbiddenException } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { ResponseMessage } from 'src/common/decorators/response.decorator';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { User } from 'src/common/decorators/user.decorator';
import type { IUser } from 'src/users/users.interface';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Tạo đơn hàng thành công')
  @Post()
  create(@Body() createOrderDto: CreateOrderDto, @User() user: IUser) {
    return this.ordersService.create(createOrderDto, user);
  }

  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Lấy danh sách đơn hàng thành công')
  @Get()
  findAll(
    @Query('currentPage') currentPage: string,
    @Query('limit') limit: string,
    @Query('status') status: string,
    @Query('as') as: string,
    @User() user: IUser,
  ) {
    return this.ordersService.findAll(currentPage, limit, status, user, as);
  }

  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Lấy thống kê dashboard thành công')
  @Get('stats')
  getStats(@User() user: IUser) {
    if (user.role !== 'admin') {
      throw new ForbiddenException('Chỉ admin mới có quyền xem thống kê');
    }
    return this.ordersService.getStats();
  }

  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Lấy chi tiết đơn hàng thành công')
  @Get(':id')
  findOne(@Param('id') id: string, @User() user: IUser) {
    return this.ordersService.findOne(+id, user);
  }

  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Cập nhật trạng thái đơn hàng thành công')
  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() updateOrderDto: UpdateOrderDto, @User() user: IUser) {
    return this.ordersService.updateStatus(+id, updateOrderDto, user);
  }

  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Hủy đơn hàng thành công')
  @Patch(':id/cancel')
  cancel(@Param('id') id: string, @User() user: IUser) {
    return this.ordersService.cancel(+id, user);
  }

  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Hủy bán đơn hàng thành công')
  @Patch(':id/cancel-sale')
  cancelSale(@Param('id') id: string, @User() user: IUser) {
    return this.ordersService.cancelSale(+id, user);
  }

  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Xóa đơn hàng thành công')
  @Delete(':id')
  remove(@Param('id') id: string, @User() user: IUser) {
    return this.ordersService.remove(+id, user);
  }
}
