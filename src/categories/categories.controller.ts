import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, ForbiddenException, Query } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { Public } from 'src/common/decorators/public.decorator';
import { ResponseMessage } from 'src/common/decorators/response.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { User } from 'src/common/decorators/user.decorator';
import type { IUser } from 'src/users/users.interface';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @UseGuards(JwtAuthGuard)// Chỉ những ai đăng nhập (có token) mới được thêm
  @ResponseMessage('Thêm mới danh mục thành công')
  @Post()
  create(@Body() createCategoryDto: CreateCategoryDto, @User() user: IUser) {
    // Kiểm tra nếu vai trò không phải là admin thì báo lỗi ngay
    if (user.role !== 'admin') {
      throw new ForbiddenException('Chỉ tài khoản Admin mới có quyền thêm danh mục!');
    }
    return this.categoriesService.create(createCategoryDto);
  }

  @Public() // Cho phép xem danh sách danh mục công khai không cần token
  @ResponseMessage('Lấy danh sách tất cả danh mục thành công!')
  @Get()
  findAll(
    @Query("current") currentPage: string,
    @Query("pageSize") limit: string,
    @Query() qs: string
  ) {
    return this.categoriesService.findAll(currentPage, limit, qs);
  }

  @Public()
  @ResponseMessage('Lấy thông tin danh mục theo slug thành công!')
  @Get('slug/:slug')
  findBySlug(@Param('slug') slug: string) {
    return this.categoriesService.findBySlug(slug);
  }

  @Public() // Cho phép xem chi tiết một danh mục công khai
  @ResponseMessage('Lấy thông tin 1 danh mục thành công!')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.categoriesService.findOne(+id);
  }

  @UseGuards(JwtAuthGuard) // Chỉ những ai đăng nhập (có token) mới được cập nhật
  @ResponseMessage('Cập nhật danh mục thành công!')
  @Patch(':id')
  update(@Param('id') id: string, @Body() updateCategoryDto: UpdateCategoryDto, @User() user: IUser) {
    // Chỉ Admin mới được phép chỉnh sửa danh mục
    if (user.role !== 'admin') {
      throw new ForbiddenException('Chỉ tài khoản Admin mới có quyền cập nhật danh mục!');
    }
    return this.categoriesService.update(+id, updateCategoryDto);
  }

  @UseGuards(JwtAuthGuard) // Chỉ những ai đăng nhập (có token) mới được xóa
  @ResponseMessage('Xóa danh mục thành công!')
  @Delete(':id')
  remove(@Param('id') id: string, @User() user: IUser) {
    // Chỉ Admin mới được phép xóa danh mục
    if (user.role !== 'admin') {
      throw new ForbiddenException('Chỉ tài khoản Admin mới có quyền xóa danh mục!');
    }
    return this.categoriesService.remove(+id);
  }
}

