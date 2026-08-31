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
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { ShipmentTrackingService } from './shipment-tracking.service';
import { Public } from '@common/decorators/public.decorator';
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
  constructor(
    private readonly ordersService: OrdersService,
    private readonly shipmentTracking: ShipmentTrackingService,
  ) {}

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
    // Tuỳ chọn: con trỏ keyset cho trang sâu / "tải thêm". Không gửi thì phân
    // trang theo currentPage như cũ (tương thích ngược hoàn toàn).
    @Query('cursor') cursor: string,
  ) {
    return this.ordersService.findAll(
      currentPage,
      limit,
      status,
      user,
      as,
      cursor,
    );
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

  // GHI CHÚ NỘI BỘ — CỐ Ý KHÔNG DÙNG /** */.
  //
  // Nest đọc khối JSDoc rồi đổ vào `summary` của openapi.json, mà Swagger được
  // phục vụ CÔNG KHAI ở /api/docs (main.ts, không guard). Mô tả tường tận cách
  // một webhook tiền tự xác thực, và điểm yếu của nó, là chỉ đường cho người
  // lạ. Bản đầu tôi viết JSDoc và nó lọt nguyên vào openapi.json thật.
  //
  // Vì sao KHÔNG có JwtAuthGuard: GHN gọi vào, không phải người dùng đăng nhập.
  // Cửa duy nhất là token, `ShipmentTrackingService` kiểm bằng `timingSafeEqual`.
  // Token đi theo query vì bảng điều khiển GHN chỉ cho khai một URL callback,
  // không đặt được header riêng.
  //
  // @Public() để JwtAuthGuard bỏ qua nếu sau này ai đó gắn guard ở cấp lớp.
  // Hôm nay guard đặt theo từng method nên nó chưa cần thiết, nhưng thiếu nó thì
  // một lần refactor vô hại sẽ khoá webhook lại — và không ai biết cho tới khi
  // tiền ký quỹ ngừng giải ngân.
  //
  // Luôn trả 200 (trừ token sai): webhook trả lỗi là GHN xếp hàng gửi lại, mà
  // gửi lại một mã mình không quản lý thì lặp vô ích mãi mãi.
  //
  // Đặt ở đây thay vì trong GhnModule vì `OrdersModule` đã import `GhnModule`;
  // làm ngược lại là phụ thuộc vòng.
  /** Webhook trạng thái vận đơn của đơn vị vận chuyển. Không dành cho client. */
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('ghn-webhook')
  ghnWebhook(
    @Query('token') token: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.shipmentTracking.xuLyWebhook(token, body ?? {});
  }
}
