import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { AddressesService } from './addresses.service';
import { CreateAddressDto, UpdateAddressDto } from './dto/create-address.dto';
import { JwtAuthGuard } from '@identity/auth/jwt-auth.guard';
import { ResponseMessage } from '@common/decorators/response.decorator';
import { SkipCheckPermissions } from '@common/decorators/public.decorator';
import { User } from '@common/decorators/user.decorator';
import type { IUser } from '@identity/users/users.interface';

@SkipCheckPermissions()
@UseGuards(JwtAuthGuard)
@Controller('addresses')
export class AddressesController {
  constructor(private readonly addressesService: AddressesService) {}

  @Get()
  @ResponseMessage('Lấy danh sách địa chỉ thành công')
  findAll(@User() user: IUser) {
    return this.addressesService.findAll(user);
  }

  @Get(':id')
  @ResponseMessage('Lấy thông tin địa chỉ thành công')
  findOne(@Param('id') id: string, @User() user: IUser) {
    return this.addressesService.findOne(+id, user);
  }

  @Post()
  @ResponseMessage('Thêm địa chỉ thành công')
  create(@Body() dto: CreateAddressDto, @User() user: IUser) {
    return this.addressesService.create(dto, user);
  }

  @Patch(':id')
  @ResponseMessage('Cập nhật địa chỉ thành công')
  update(@Param('id') id: string, @Body() dto: UpdateAddressDto, @User() user: IUser) {
    return this.addressesService.update(+id, dto, user);
  }

  @Patch(':id/default')
  @ResponseMessage('Đặt địa chỉ mặc định thành công')
  setDefault(@Param('id') id: string, @User() user: IUser) {
    return this.addressesService.setDefault(+id, user);
  }

  @Delete(':id')
  @ResponseMessage('Xóa địa chỉ thành công')
  remove(@Param('id') id: string, @User() user: IUser) {
    return this.addressesService.remove(+id, user);
  }
}
