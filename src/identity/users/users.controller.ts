import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ApiTags } from '@nestjs/swagger';
import { ResponseMessage } from '@common/decorators/response.decorator';
import { JwtAuthGuard } from '@identity/auth/jwt-auth.guard';
import { AdminGuard } from '@common/guards/admin.guard';
import { UseGuards } from '@nestjs/common';

@ApiTags('users')
@Controller('users')
@UseGuards(JwtAuthGuard, AdminGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) { }

  @Post()
  @ResponseMessage('Thêm tài khoản thành công!')
  async create(@Body() createUserDto: CreateUserDto) {
    const newUser = await this.usersService.create(createUserDto);
    return {
      id: newUser?.id,
      createdAt: newUser?.created_at,
    };
  }

  @Get()
  @ResponseMessage('Lấy danh sách tài khoản thành công!')
  findAll(
    @Query("current") currentPage: string,
    @Query("pageSize") limit: string,
    @Query("q") qs: string
  ) {
    return this.usersService.findAll(currentPage, limit, qs)
  }

  @Get(':id')
  @ResponseMessage('Lấy thông tin 1 tài khoản thành công!')
  async findOne(@Param('id') id: string) {
    return await this.usersService.findOne(+id);
  }

  @Patch(':id')
  @ResponseMessage('Cập nhật thông tin tài khoản thành công!')
  update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.usersService.update(+id, updateUserDto);
  }

  @Delete(':id')
  @ResponseMessage('Xóa tài khoản thành công!')
  remove(@Param('id') id: string) {
    return this.usersService.remove(+id);
  }

  
}
