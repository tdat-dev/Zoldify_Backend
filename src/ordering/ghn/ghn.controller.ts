import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { GhnService } from './ghn.service';
import { JwtAuthGuard } from '@identity/auth/jwt-auth.guard';
import { CreateGhnOrderDto } from './dto/create-order.dto';

@Controller('ghn')
export class GhnController {
  constructor(private readonly ghnService: GhnService) {}

  @UseGuards(JwtAuthGuard)
  @Post('calculate-fee')
  calculateFee(@Body() dto: { to_district_id: number; to_ward_code: string; weight: number }) {
    return this.ghnService.calculateFee(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('create-order')
  createOrder(@Body() dto: CreateGhnOrderDto) {
    return this.ghnService.createOrder(dto);
  }
}