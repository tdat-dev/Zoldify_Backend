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
import { EscrowsService } from '@money/escrows/escrows.service';

@Controller('payos')
export class PayosController {
  constructor(
    private readonly payosService: PayosService,
    private readonly escrowsService: EscrowsService,
  ) {}

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
      const result = await this.payosService.createOrderPaymentLink(
        dto.order_id,
        user.id,
      );

      // Tạo escrow sau khi tạo payment link (chưa paid, chờ webhook)
      try {
        await this.escrowsService.createOrderEscrows(dto.order_id);
      } catch (e) {
        // ignore nếu escrow đã tồn tại
      }
      return result;
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
  async getOrderStatus(@Param('orderId') orderId: string) {
    return this.payosService.getOrderStatus(+orderId);
  }

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
  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async webhook(@Req() req: Request) {
    // Service đã xử lý: verify signature, idempotency, update payment, cộng ví, gửi notification
    return this.payosService.handleWebhook(req.body);
  }
}
