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
import { InteractionsService } from './interactions.service';
import { User } from '@common/decorators/user.decorator';
import { ResponseMessage } from '@common/decorators/response.decorator';
import { JwtAuthGuard } from '@identity/auth/jwt-auth.guard';
import { CreateReviewDto } from './dto/create-review.dto';
import type { IUser } from '@identity/users/users.interface';
import { UpdateReviewDto } from './dto/update-review.dto';
import { Review } from './entities/review.entity';
import { ApiPaginated } from '@common/decorators/api-response.decorator';
import { Public } from '@common/decorators/public.decorator';

@Controller('interactions')
export class InteractionsController {
  constructor(private readonly interactionsService: InteractionsService) {}

  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Tạo tương tác thành công')
  @Post()
  create(@Body() CreateReviewDto: CreateReviewDto, @User() user: IUser) {
    return this.interactionsService.create(CreateReviewDto, user);
  }

  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Lấy danh sách tương tác thành công')
  @ApiPaginated(Review)
  @Get()
  findAll(
    @Query('currentPage') currentPage: string,
    @Query('limit') limit: string,
    @User() user: IUser,
  ) {
    return this.interactionsService.findAll(currentPage, limit, user);
  }

  // Công khai có chủ ý: trang sản phẩm phải đọc được đánh giá khi chưa đăng
  // nhập. Route không nhận `@User()` nên không có gì để lộ theo người dùng.
  @Public()
  @ResponseMessage('Lấy đánh giá sản phẩm thành công')
  @ApiPaginated(Review)
  @Get('product/:productId')
  findByProduct(
    @Param('productId') productId: string,
    @Query('currentPage') currentPage: string,
    @Query('limit') limit: string,
  ) {
    return this.interactionsService.findByProduct(
      +productId,
      currentPage,
      limit,
    );
  }

  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Lấy thông tin tương tác thành công')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.interactionsService.findOne(+id);
  }

  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Cập nhật tương tác thành công')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() UpdateReviewDto: UpdateReviewDto,
    @User() user: IUser,
  ) {
    return this.interactionsService.update(+id, UpdateReviewDto, user);
  }

  @UseGuards(JwtAuthGuard)
  @ResponseMessage('Xóa tương tác thành công')
  @Delete(':id')
  remove(@Param('id') id: string, @User() user: IUser) {
    return this.interactionsService.remove(+id, user);
  }
}
