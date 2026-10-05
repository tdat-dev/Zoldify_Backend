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

  // ĐÃ GỠ: POST /ghn/create-order
  //
  // Nó chỉ có `JwtAuthGuard`, nhận payload tuỳ ý, và KHÔNG gắn với đơn hàng
  // nào. Nghĩa là bất kỳ ai đăng nhập cũng tạo được vận đơn GHN bằng tài khoản
  // và tiền của sàn — địa chỉ nhận tuỳ ý, tiền thu hộ tuỳ ý, số lượng tuỳ ý.
  // Mỗi vận đơn là một khoản phí thật, và không có gì trong hệ thống ghi nhận
  // ai đã tạo nó hay vì sao.
  //
  // Luồng tạo vận đơn THẬT không đi qua đây: nó nằm ở
  // `orders.updateStatus` → `createGhnShipmentsPerSeller`, nơi vận đơn được
  // dựng từ dữ liệu của chính đơn hàng, một vận đơn cho mỗi người bán, và ghi
  // vào bảng `order_shipments` để còn đối soát.
  //
  // Đã kiểm 25/09: KHÔNG nhánh nào của cả ba client (frontend, mobile, admin)
  // gọi endpoint này. Gỡ hẳn thay vì bọc thêm guard — một cửa không ai dùng
  // thì cách bảo vệ rẻ nhất là không có cửa.
}
