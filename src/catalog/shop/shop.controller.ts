import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards } from '@nestjs/common';
import { ShopService } from './shop.service';
import { CreateShopDto } from './dto/create-shop.dto';
import { UpdateShopDto } from './dto/update-shop.dto';
import { Public } from '@common/decorators/public.decorator';
import { JwtAuthGuard } from '@identity/auth/jwt-auth.guard';
import { ResponseMessage } from '@common/decorators/response.decorator';
import { User } from '@common/decorators/user.decorator';
import type { IUser } from '@identity/users/users.interface';
import { Product } from '@catalog/products/entities/product.entity';
import { ApiPaginated } from '@common/decorators/api-response.decorator';

@Controller('shop')
export class ShopController {
  constructor(private readonly shopService: ShopService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  @ResponseMessage('Tạo shop thành công')
  create(@Body() createShopDto: CreateShopDto, @User() user: IUser) {
    return this.shopService.create(createShopDto, user);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  @ResponseMessage('Lấy thông tin shop của tôi thành công')
  getMyShop(@User() user: IUser) {
    return this.shopService.getMyShop(user);
  }

  @UseGuards(JwtAuthGuard)
  @Patch()
  @ResponseMessage('Cập nhật shop thành công')
  update(@Body() updateShopDto: UpdateShopDto, @User() user: IUser) {
    return this.shopService.update(updateShopDto, user);
  }

  @Public()
  @ResponseMessage('Lấy thông tin shop thành công')
  @Get(':sellerId')
  getShop(@Param('sellerId') sellerId: string) {
    return this.shopService.getShopInfo(+sellerId);
  }

  @Public()
  @ResponseMessage('Lấy sản phẩm của shop thành công')
  @ApiPaginated(Product)
  @Get(':sellerId/products')
  getProducts(
    @Param('sellerId') sellerId: string,
    @Query('page') page: string,
    @Query('limit') limit: string,
  ) {
    return this.shopService.getShopProducts(+sellerId, +page || 1, +limit || 20);
  }

  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Lấy đơn hàng của shop thành công')  @Get(':sellerId/orders')
  getSellerOrders(
    @Param('sellerId') sellerId: string,
    @Query('page') page: string,
    @Query('limit') limit: string,
    @Query('status') status: string,
    @User() user: IUser,
  ) {
    
    if (+sellerId !== user.id && user.role !== 'admin') {
      throw new Error('Bạn không có quyền xem đơn hàng này');
    }
    return this.shopService.getSellerOrders(+sellerId, +page || 1, +limit || 20, status);
  }
}