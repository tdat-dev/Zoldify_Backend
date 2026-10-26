import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  UseGuards,
  Param,
  HttpCode,
  HttpStatus,
  BadRequestException,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { PayosService } from './payos.service';
import { JwtAuthGuard } from '@identity/auth/jwt-auth.guard';
import { Public } from '@common/decorators/public.decorator';
import { ResponseMessage } from '@common/decorators/response.decorator';
import { User } from '@common/decorators/user.decorator';
import type { IUser } from '@identity/users/users.interface';
import {
  CreatePayosLinkDto,
  CancelPayosLinkDto,
  PayosPaymentType,
} from './dto/create-link.dto';

@Controller('payos')
export class PayosController {
  constructor(private readonly payosService: PayosService) {}

  /**
   * Tạo link thanh toán PayOS cho đơn hàng hoặc nạp ví
   * POST /payos/create-link
   * body: { type: 'order' | 'topup', order_id?: number, amount?: number }
   */
  @UseGuards(JwtAuthGuard)
  @Post('create-link')
  @ResponseMessage('Tạo link thanh toán PayOS thành công')
  async createLink(@Body() dto: CreatePayosLinkDto, @User() user: IUser) {
    if (dto.type === PayosPaymentType.ORDER) {
      if (!dto.order_id) {
        throw new BadRequestException('order_id là bắt buộc khi type = order');
      }
      // KHÔNG tạo ký quỹ ở đây. Tạo link thanh toán chỉ là mở một cái cổng —
      // chưa ai trả đồng nào.
      //
      // Tới 24/09 chỗ này gọi `createOrderEscrows(dto.order_id)` ngay sau khi
      // có link, kèm `catch {}` nuốt mọi lỗi. Khoản ký quỹ ra đời ở trạng thái
      // `holding` trong khi `platform/escrow_hold` vẫn rỗng — tức sổ ghi "đang
      // giữ hộ 500.000" mà két không có đồng nào.
      //
      // Hậu quả không dừng ở sổ sách lệch. `EscrowsService.release()` chỉ tìm
      // khoản `holding` rồi chuyển tiền; nó không hỏi tiền ở đâu ra. Nên người
      // mua bấm "đã nhận hàng" trên một đơn CHƯA TRẢ TIỀN là ví người bán được
      // cộng thật, và `escrow_hold` xuống ÂM — sàn vừa trả cho người bán một
      // khoản chưa ai nộp vào. Người bán rút ra được qua POST /withdrawals.
      //
      // Đo được bằng TC-P0-02b: escrow_hold = -500.000.
      //
      // Chỗ đúng để tạo ký quỹ là `payos.service.ts` → `applyPaidPayment`, nơi
      // nó nằm CÙNG TRANSACTION với bút toán `gateway_clearing -> escrow_hold`.
      // Tiền vào két và khoản giữ hộ ra đời chung một số phận, không có khoảng
      // giữa nào để lọt.
      return this.payosService.createOrderPaymentLink(dto.order_id, user.id);
    } else if (dto.type === PayosPaymentType.TOPUP) {
      if (!dto.amount) {
        throw new BadRequestException('amount là bắt buộc khi type = topup');
      }
      return this.payosService.createWalletTopupLink(dto.amount, user.id);
    }
    throw new BadRequestException('Type không hợp lệ');
  }

  /**
   * Lấy trạng thái thanh toán theo orderId (nội bộ)
   * GET /payos/order/:orderId
   */
  @UseGuards(JwtAuthGuard)
  @Get('order/:orderId')
  @ResponseMessage('Lấy trạng thái đơn hàng thành công')
  async getOrderStatus(@Param('orderId') orderId: string, @User() user: IUser) {
    // Chỉ người mua của đơn hoặc admin (kiểm trong service).
    return this.payosService.getOrderStatus(+orderId, user);
  }

  // TRẦN RIÊNG, KHÔNG BỎ QUA (review 26/10). Mỗi lần gọi là một lần hỏi API
  // PayOS; bỏ throttle hẳn thì một vòng lặp ở client (hay một kẻ cố ý) đốt
  // hạn mức API của cả merchant. Trần này đếm THEO IP như bộ đếm toàn cục
  // (bộ theo người dùng cần tracker riêng, chưa làm): đủ cho vài người mua
  // chung NAT nhà mạng cùng hỏi lại 3-5 giây một lần, chặn được vòng lặp
  // hỏng. Bảo trì vẫn mở route này: xem MaintenanceGuard.
  @Throttle({
    short: { limit: 3, ttl: 1000 },
    medium: { limit: 15, ttl: 10_000 },
    long: { limit: 60, ttl: 60_000 },
  })
  @UseGuards(JwtAuthGuard)
  @Get('refresh/:orderId')
  @ResponseMessage('Refresh trạng thái PayOS thành công')
  async refresh(@Param('orderId') orderId: string, @User() user: IUser) {
    return this.payosService.refreshOrderStatus(+orderId, user.id);
  }

  /**
   * Lấy trạng thái payment link theo payos_order_code
   * GET /payos/status/:code
   */
  @UseGuards(JwtAuthGuard)
  @Get('status/:code')
  @ResponseMessage('Lấy trạng thái payment thành công')
  async getPaymentLinkStatus(@Param('code') code: string, @User() user: IUser) {
    return this.payosService.getPaymentLinkStatus(code, user.id);
  }

  /**
   * Hủy payment link (user tự hủy từ frontend)
   * POST /payos/cancel
   * body: { payos_order_code: string }
   */
  @UseGuards(JwtAuthGuard)
  @Post('cancel')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Hủy thanh toán thành công')
  async cancel(@Body() dto: CancelPayosLinkDto, @User() user: IUser) {
    return this.payosService.cancelPaymentLink(dto.payos_order_code, user.id);
  }

  /**
   * Webhook nhận thông báo từ PayOS
   * POST /payos/webhook (PUBLIC, không cần JWT)
   * PayOS gửi raw JSON, cần verify signature
   */
  // KHÔNG THROTTLE WEBHOOK. Mọi webhook tới từ vài IP của PayOS, nên giờ cao
  // điểm vài chục giao dịch cùng phút là đủ chạm trần ThrottlerGuard toàn cục
  // tính theo IP: PayOS nhận 429, tin "đã trả tiền" rơi mất, đơn kẹt pending
  // tới khi cron huỷ dù người mua đã chuyển khoản. Webhook tự xác thực bằng
  // chữ ký và chống trùng bằng idempotency_key của sổ cái, nên không cần trần.
  // Bảo trì cũng không chặn nó: xem danh sách lối mở ở MaintenanceGuard.
  //
  // PHẢI NÊU TÊN CẢ BA BỘ ĐẾM. `@SkipThrottle()` không tham số chỉ đặt bộ
  // `default`, mà app.module chỉ khai `short`/`medium`/`long`: bản đầu viết
  // vậy và webhook vẫn bị đếm đủ ba bộ (review 26/10).
  @SkipThrottle({ short: true, medium: true, long: true })
  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async webhook(@Req() req: Request) {
    // Service đã xử lý: verify signature, idempotency, update payment, cộng ví, gửi notification
    return this.payosService.handleWebhook(req.body);
  }
}
