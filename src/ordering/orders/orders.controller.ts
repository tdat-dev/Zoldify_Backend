import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
  ForbiddenException,
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { ShippingQuoteDto } from './dto/shipping-quote.dto';
import { ResponseMessage } from '@common/decorators/response.decorator';
import { JwtAuthGuard } from '@identity/auth/jwt-auth.guard';
import { User } from '@common/decorators/user.decorator';
import type { IUser } from '@identity/users/users.interface';
import { Order } from './entities/order.entity';
import { ApiPaginated } from '@common/decorators/api-response.decorator';
import { ApiShape } from '@common/decorators/api-response.decorator';

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
  @ResponseMessage('Báo giá phí ship thành công')
  @Post('shipping-quote')
  shippingQuote(@Body() dto: ShippingQuoteDto, @User() user: IUser) {
    return this.ordersService.getShippingQuote(user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Lấy danh sách đơn hàng thành công')
  @ApiPaginated(Order)
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
  @ApiShape({
    total_users: 'number',
    total_products: 'number',
    total_orders: 'number',
    total_revenue: 'number',
  })
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
  updateStatus(
    @Param('id') id: string,
    @Body() updateOrderDto: UpdateOrderDto,
    @User() user: IUser,
  ) {
    return this.ordersService.updateStatus(+id, updateOrderDto, user);
  }

  @UseGuards(JwtAuthGuard)
  @ResponseMessage("Gia lap trang thai GHN thanh cong")
  @Patch(":id/sim-ghn")
  simGhn(
    @Param("id") id: string,
    @Body() body: { phase: "shipping" | "delivered" },
    @User() user: IUser,
  ) {
    return this.ordersService.simulateGhnStatus(+id, body.phase, user);
  }

  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Chạy chốt vận đơn thành công')
  @Post('admin/settle-shipments')
  settleShipments(@User() user: IUser) {
    return this.ordersService.settleShipments(user);
  }

  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Xác nhận đã nhận hàng thành công')
  @Patch(':id/shipments/:sellerId/received')
  confirmReceived(
    @Param('id') id: string,
    @Param('sellerId') sellerId: string,
    @User() user: IUser,
  ) {
    return this.ordersService.confirmShipmentReceived(+id, +sellerId, user);
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
