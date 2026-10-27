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
  ParseIntPipe,
  Req,
  Res,
} from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';
import { SoTuyChonPipe } from '@common/pipes/so-tuy-chon.pipe';
import { ProductsService, SAN_PHAM_CONG_KHAI } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { Public } from '@common/decorators/public.decorator';
import { JwtAuthGuard } from '@identity/auth/jwt-auth.guard';
import {
  OptionalJwtAuthGuard,
  type RequestNguoiXem,
} from '@identity/auth/optional-jwt-auth.guard';
import type { Response } from 'express';
import { ResponseMessage } from '@common/decorators/response.decorator';
import { User } from '@common/decorators/user.decorator';
import type { IUser } from '@identity/users/users.interface';
import { UpdateStockDto } from './dto/update-stock.dto';
import { Product } from './entities/product.entity';
import { ApiPaginated } from '@common/decorators/api-response.decorator';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @UseGuards(JwtAuthGuard) // Chỉ những ai đăng nhập (có token) mới được thêm
  @ResponseMessage('Thêm mới sản phẩm thành công')
  @Post()
  create(@Body() createProductDto: CreateProductDto, @User() user: IUser) {
    return this.productsService.create(createProductDto, user);
  }

  @ResponseMessage('Lấy danh sách tất cả sản phẩm thành công!')
  @Public()
  @ApiPaginated(Product)
  // Khai kiểu số tường minh: tham số `number | undefined` làm plugin Swagger
  // ra `schema: {}`, ba client mất kiểu của bốn bộ lọc này.
  @ApiQuery({ name: 'category_id', required: false, type: Number })
  @ApiQuery({ name: 'seller_id', required: false, type: Number })
  @ApiQuery({ name: 'price_min', required: false, type: Number })
  @ApiQuery({ name: 'price_max', required: false, type: Number })
  @Get()
  findAll(
    @Query('current') currentPage: string,
    @Query('pageSize') limit: string,
    @Query('q') q: string,
    // Bốn bộ lọc số đi qua pipe: chữ thì 400 thay vì NaN lọt vào SQL và ra
    // 500 (rà soát 26/10 mục 9). Ô trống vẫn là "không lọc" như cũ.
    @Query('category_id', new SoTuyChonPipe('category_id', true))
    category_id: number | undefined,
    @Query('seller_id', new SoTuyChonPipe('seller_id', true))
    seller_id: number | undefined,
    @Query('price_min', new SoTuyChonPipe('price_min'))
    price_min: number | undefined,
    @Query('price_max', new SoTuyChonPipe('price_max'))
    price_max: number | undefined,
    @Query('condition') condition: string,
    @Query('sort') sort: string,
    @Query() qs: any,
  ) {
    qs.q = q;
    qs.category_id = category_id;
    qs.seller_id = seller_id;
    qs.price_min = price_min;
    qs.price_max = price_max;
    qs.condition = condition;
    qs.sort = sort;
    return this.productsService.findAll(currentPage, limit, qs);
  }

  /**
   * Hàng của CHÍNH người đang đăng nhập — đủ mọi trạng thái.
   *
   * Đặt TRƯỚC `@Get(':id')`: Nest so khớp route theo thứ tự khai báo, nên nếu
   * đứng sau thì `/products/mine` sẽ bị `:id` nuốt và `+'mine'` ra `NaN`.
   *
   * `sellerId` lấy từ TOKEN, không từ query — người bán chỉ xem được hàng của
   * chính mình. Đó cũng là lý do đường này tồn tại: `GET /products` là công
   * khai nên không phân biệt được ai đang hỏi, và từ 25/09 nó lọc cứng
   * `status = active` để tin nháp / bị từ chối duyệt không bày ra cho người lạ.
   */
  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Lấy danh sách sản phẩm của tôi thành công!')
  @ApiPaginated(Product)
  @Get('mine')
  findMine(
    @User() user: IUser,
    @Query('current') currentPage: string,
    @Query('pageSize') limit: string,
  ) {
    return this.productsService.findMine(
      user.id,
      Number(currentPage) || 1,
      Number(limit) || 20,
    );
  }

  // ParseIntPipe ở mọi `:id`: `+'abc'` là NaN, `WHERE id = NaN` ra 500.
  //
  // Công khai nhưng xác thực TUỲ CHỌN: khách chỉ thấy sản phẩm đang bán, chủ
  // sản phẩm và admin (gửi kèm token) thấy cả bản nháp cho trang sửa. Xem
  // OptionalJwtAuthGuard và ProductsService.findOne.
  @ResponseMessage('Lấy thông tin sản phẩm thành công!')
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get(':id')
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: RequestNguoiXem,
    @Res({ passthrough: true }) res: Response,
  ) {
    const product = await this.productsService.findOne(id, { user: req.user });
    // Bản nháp chỉ chủ và admin thấy: không cho trình duyệt, proxy hay CDN nào
    // giữ lại. Thiếu header này thì một cache dùng chung giữa nhiều người
    // (proxy công ty, CDN cấu hình lỏng) có thể trả bản nháp cho người khác.
    if (!SAN_PHAM_CONG_KHAI.includes(product.status)) {
      res.setHeader('Cache-Control', 'private, no-store');
    }
    return product;
  }

  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Cập nhật sản phẩm thành công!')
  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateProductDto: UpdateProductDto,
    @User() user: IUser,
  ) {
    return this.productsService.update(id, updateProductDto, user);
  }

  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Xóa sản phẩm thành công!')
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @User() user: IUser) {
    return this.productsService.remove(id, user);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/stock')
  @ResponseMessage('Cập nhật số lượng thành công')
  updateStock(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateStockDto,
    @User() user: IUser,
  ) {
    return this.productsService.updateStock(
      id,
      dto.stock,
      user.id,
      user.role === 'admin',
      dto.expected_stock,
    );
  }
}
