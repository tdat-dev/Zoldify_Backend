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
} from '@nestjs/common';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { Public } from '@common/decorators/public.decorator';
import { JwtAuthGuard } from '@identity/auth/jwt-auth.guard';
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
  @Get()
  findAll(
    @Query('current') currentPage: string,
    @Query('pageSize') limit: string,
    @Query('q') q: string,
    @Query('category_id') category_id: string,
    @Query('seller_id') seller_id: string,
    @Query('price_min') price_min: string,
    @Query('price_max') price_max: string,
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

  @ResponseMessage('Lấy thông tin sản phẩm thành công!')
  @Public()
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.productsService.findOne(+id);
  }

  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Cập nhật sản phẩm thành công!')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateProductDto: UpdateProductDto,
    @User() user: IUser,
  ) {
    return this.productsService.update(+id, updateProductDto, user);
  }

  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Xóa sản phẩm thành công!')
  @Delete(':id')
  remove(@Param('id') id: string, @User() user: IUser) {
    return this.productsService.remove(+id, user);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/stock')
  @ResponseMessage('Cập nhật số lượng thành công')
  updateStock(
    @Param('id') id: string,
    @Body() dto: UpdateStockDto,
    @User() user: IUser,
  ) {
    return this.productsService.updateStock(
      +id,
      dto.stock,
      user.id,
      user.role === 'admin',
    );
  }
}
