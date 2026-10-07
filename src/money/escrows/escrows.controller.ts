import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { EscrowsService } from './escrows.service';
import { JwtAuthGuard } from '@identity/auth/jwt-auth.guard';
import { AdminGuard } from '@common/guards/admin.guard';
import { ResponseMessage } from '@common/decorators/response.decorator';
import { User } from '@common/decorators/user.decorator';
import type { IUser } from '@identity/users/users.interface';
import { UserRole } from '@identity/users/entities/user.entity';
import { Escrow } from './entities/escrow.entity';
import {
  ApiPaginated,
  ApiShape,
} from '@common/decorators/api-response.decorator';

/**
 * Bốn đường ĐỌC ký quỹ.
 *
 * Tới 25/09 cả bốn chỉ có `JwtAuthGuard` và dừng ở đó — không đường nào hỏi
 * người đang gọi là ai. Bất kỳ tài khoản nào đăng nhập, kể cả vừa đăng ký, đều
 * đọc được ký quỹ của cả sàn: ai mua gì của ai, bao nhiêu tiền, mỗi shop đang
 * có bao nhiêu tiền chờ về. Sàn C2C thì các shop cạnh tranh trực tiếp với nhau.
 *
 * Việc kiểm quyền nằm trong `EscrowsService`, không nằm ở đây. Controller là
 * một cửa; service là cái két. Kiểm ở cửa thì cửa thứ hai mở ra sau này — một
 * controller khác, một job, một lời gọi nội bộ — sẽ đi thẳng vào két.
 * Controller chỉ có nhiệm vụ chuyển `user` xuống.
 */
@Controller('escrows')
export class EscrowsController {
  constructor(private readonly escrowsService: EscrowsService) {}

  // Toàn sàn: chỉ admin. Trước 28/09 ai đăng nhập cũng tải được mọi escrow
  // kèm thông tin người mua/bán (audit B-03).
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiPaginated(Escrow)
  @Get()
  @ResponseMessage('Lấy danh sách escrow thành công')
  findAll(
    @Query('page') page: string,
    @Query('limit') limit: string,
    @Query('status') status: string,
    @User() user: IUser,
  ) {
    return this.escrowsService.findAll(+page || 1, +limit || 20, status, user);
  }

  @UseGuards(JwtAuthGuard)
  @Get('order/:orderId')
  @ResponseMessage('Lấy escrow theo đơn hàng thành công')
  findByOrder(@Param('orderId') orderId: string, @User() user: IUser) {
    return this.escrowsService.findByOrder(+orderId, user);
  }

  @UseGuards(JwtAuthGuard)
  @ApiPaginated(Escrow)
  @Get('seller/:sellerId')
  @ResponseMessage('Lấy escrow của người bán thành công')
  async findBySeller(
    @Param('sellerId') sellerId: string,
    @Query('page') page: string,
    @Query('limit') limit: string,
    @Query('status') status: string,
    @User() user: IUser,
  ) {
    // Hai lớp. `assertSelfOrAdmin` chặn ngay ở cửa cho lỗi 403 sớm và rõ;
    // `EscrowsService.findBySeller` chặn lần nữa ở két. Cửa thứ hai mở ra sau
    // này — một job, một script, một controller khác — sẽ không đi vòng qua được.
    this.assertSelfOrAdmin(+sellerId, user);
    return this.escrowsService.findBySeller(
      +sellerId,
      +page || 1,
      +limit || 20,
      status,
      user,
    );
  }

  @UseGuards(JwtAuthGuard)
  @ApiShape({ held_balance: 'number' })
  @Get('held/:sellerId')
  @ResponseMessage('Lấy số dư đang giữ thành công')
  async getHeldBalance(
    @Param('sellerId') sellerId: string,
    @User() user: IUser,
  ) {
    this.assertSelfOrAdmin(+sellerId, user);
    return this.escrowsService.getHeldBalance(+sellerId, user);
  }

  /** Người bán chỉ xem tiền của chính mình; admin xem của bất kỳ ai. */
  private assertSelfOrAdmin(sellerId: number, user: IUser) {
    if (user.role !== UserRole.ADMIN && user.id !== sellerId) {
      throw new ForbiddenException('Bạn chỉ xem được escrow của chính mình');
    }
  }
}
