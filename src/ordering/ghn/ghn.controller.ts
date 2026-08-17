import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { GhnService } from './ghn.service';
import { JwtAuthGuard } from '@identity/auth/jwt-auth.guard';
import { CreateGhnOrderDto } from './dto/create-order.dto';

@Controller('ghn')
export class GhnController {
  constructor(private readonly ghnService: GhnService) {}

  // Danh mục địa chỉ GHN — dùng cho ô chọn tỉnh/quận/phường lúc khách nhập
  // địa chỉ giao. Trả về đúng ID của GHN (ProvinceID / DistrictID / WardCode)
  // để lưu kèm địa chỉ, vì phí ship và tạo vận đơn đều cần các ID này.
  @UseGuards(JwtAuthGuard)
  @Get('provinces')
  getProvinces() {
    return this.ghnService.getProvinces();
  }

  @UseGuards(JwtAuthGuard)
  @Get('districts')
  getDistricts(@Query('province_id', ParseIntPipe) provinceId: number) {
    return this.ghnService.getDistricts(provinceId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('wards')
  getWards(@Query('district_id', ParseIntPipe) districtId: number) {
    return this.ghnService.getWards(districtId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('calculate-fee')
  calculateFee(
    @Body()
    dto: {
      to_district_id: number;
      to_ward_code: string;
      weight: number;
    },
  ) {
    return this.ghnService.calculateFee(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('create-order')
  createOrder(@Body() dto: CreateGhnOrderDto) {
    return this.ghnService.createOrder(dto);
  }
}
