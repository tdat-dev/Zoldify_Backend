import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { RecommendationsService } from './recommendations.service';
import { Public } from '@common/decorators/public.decorator';
import { JwtAuthGuard } from '@identity/auth/jwt-auth.guard';
import { ResponseMessage } from '@common/decorators/response.decorator';
import { User } from '@common/decorators/user.decorator';
import type { IUser } from '@identity/users/users.interface';

/**
 * Gợi ý sản phẩm (task #15).
 *
 * VÌ SAO Ở MODULE RIÊNG CHỨ KHÔNG NHÉT VÀO `ProductsController`.
 *
 * Hai lý do, lý do thứ hai mới là lý do thật:
 *
 *   1. `products.service.ts` đã 600+ dòng và đang gánh cache, tìm kiếm toàn
 *      văn, phân trang keyset. Thêm hai câu phân tích nữa vào đó là trộn hai
 *      mối quan tâm khác hẳn nhau.
 *   2. `products.service.ts` và `products.controller.ts` đang nằm trong danh
 *      sách file xung đột với 53 commit chưa hoà của Đạt. Module riêng nghĩa
 *      là task này không làm phần gộp đó khó thêm một dòng nào.
 *
 * Nest ghép đường dẫn theo `@Controller('products')` ở đây, nên
 * `GET /products/:id/related` vẫn nằm đúng chỗ người dùng mong đợi mà không
 * phải sửa file nào của module products.
 */
@Controller('products')
export class RecommendationsController {
  constructor(private readonly service: RecommendationsService) {}

  /**
   * "Người mua món này cũng mua" — trang chi tiết sản phẩm.
   *
   * CÔNG KHAI, không cần đăng nhập: khách chưa có tài khoản vẫn xem trang sản
   * phẩm, và đó chính là lúc gợi ý có giá trị nhất. Vì công khai nên nó chỉ
   * trả về sản phẩm `active` còn hàng — không rò gì về người mua.
   */
  @Public()
  @Get(':id/related')
  @ResponseMessage('Lấy sản phẩm liên quan thành công')
  related(@Param('id') id: string, @Query('limit') limit: string) {
    return this.service.relatedToProduct(+id, +limit || 12);
  }
}

/**
 * Gợi ý riêng cho người đang đăng nhập — trang chủ.
 *
 * Tách controller vì tiền tố khác (`/recommendations`), và vì route này BẮT
 * BUỘC có token: nó dựa trên lịch sử mua của chính người gọi. Lấy `user.id` từ
 * `@User()` chứ không nhận từ query — nhận từ query là mời người ta đọc gợi ý
 * của người khác, tức đọc gián tiếp lịch sử mua hàng của họ.
 */
@Controller('recommendations')
@UseGuards(JwtAuthGuard)
export class MyRecommendationsController {
  constructor(private readonly service: RecommendationsService) {}

  @Get('me')
  @ResponseMessage('Lấy gợi ý cho bạn thành công')
  forMe(@User() user: IUser, @Query('limit') limit: string) {
    return this.service.forUser(user.id, +limit || 12);
  }
}
