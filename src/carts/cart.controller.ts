import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Query } from '@nestjs/common';
import { CartService } from './cart.service';
import { CreateCartDto } from './dto/create-cart.dto';
import { UpdateCartDto } from './dto/update-cart.dto';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { ResponseMessage } from 'src/common/decorators/response.decorator';
import { SkipCheckPermissions } from 'src/common/decorators/public.decorator';
import type { IUser } from 'src/users/users.interface';
import { User } from 'src/common/decorators/user.decorator';

@SkipCheckPermissions()
@Controller('cart')
export class CartController {
  constructor(private readonly cartService: CartService) { }

  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Thêm mới vào giỏ hàng thành công')
  @Post()
  create(@Body() createCartDto: CreateCartDto, @User() user: IUser) {
    return this.cartService.create(createCartDto, user);
  }

  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Lấy danh sách giỏ hàng thành công')
  @Get()
  findAll(@User() user: IUser) {
    return this.cartService.findAll(user);
  }

  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Lấy chi tiết 1 giỏ hàng thành công')
  @Get(':id')
  findOne(@Param('id') id: string, @User() user: IUser) {
    return this.cartService.findOne(+id, user);
  }

  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Cập nhật giỏ hàng thành công')
  @Patch(':id')
  update(@Param('id') id: string, @Body() updateCartDto: UpdateCartDto, @User() user: IUser) {
    return this.cartService.update(+id, updateCartDto, user);
  }

  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Xóa giỏ hàng thành công')
  @Delete(':id')
  remove(@Param('id') id: string, @User() user: IUser) {
    return this.cartService.remove(+id, user);
  }
}
