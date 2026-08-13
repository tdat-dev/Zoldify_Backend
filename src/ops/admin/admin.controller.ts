import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@identity/auth/jwt-auth.guard';
import { ResponseMessage } from '@common/decorators/response.decorator';
import { AdminGuard } from '@common/guards/admin.guard';
import { User } from '@common/decorators/user.decorator';
import type { IUser } from '@identity/users/users.interface';
import { User as UserEntity } from '@identity/users/entities/user.entity';
import { Withdrawal } from '@money/withdrawals/entities/withdrawal.entity';
import { ApiPaginated } from '@common/decorators/api-response.decorator';

@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @ApiPaginated(UserEntity)
  @Get('users')
  @ResponseMessage('Lấy danh sách người dùng thành công')
  getUsers(
    @Query('page') page: string,
    @Query('limit') limit: string,
    @Query('q') q: string,
    @Query('role') role: string,
    @Query('is_locked') is_locked: string,
  ) {
    return this.adminService.getUsers(
      +page || 1,
      +limit || 20,
      q,
      role,
      is_locked,
    );
  }

  @Get('users/:id')
  @ResponseMessage('Lấy chi tiết người dùng thành công')
  getUserDetail(@Param('id') id: string) {
    return this.adminService.getUserDetail(+id);
  }

  @Patch('users/:id/toggle-lock')
  @ResponseMessage('Khóa/mở tài khoản thành công')
  toggleUserLock(@Param('id') id: string) {
    return this.adminService.toggleUserLock(+id);
  }

  @Patch('users/:id/role')
  @ResponseMessage('Cập nhật vai trò thành công')
  changeUserRole(@Param('id') id: string, @Body() dto: { role: string }) {
    return this.adminService.changeUserRole(+id, dto.role);
  }

  @Patch('users/:id')
  @ResponseMessage('Cập nhập người dùng thành công')
  updateUser(@Param('id') id: string, @Body() dto: any) {
    return this.adminService.updateUser(+id, dto);
  }

  @Delete('users/:id')
  @ResponseMessage('Xóa người dùng thành công')
  deleteUser(@Param('id') id: string) {
    return this.adminService.deleteUser(+id);
  }

  @Get('stats')
  @ResponseMessage('Lấy thông tin dashboard thành công')
  getDashboardStats() {
    return this.adminService.getDashboardStats();
  }

  @Get('settings')
  @ResponseMessage('Lấy cài đặt thành công')
  getSettings() {
    return this.adminService.getSettings();
  }

  @Patch('settings')
  @ResponseMessage('Cập nhật cài đặt thành công')
  updateSettings(@Body() updates: Record<string, string>) {
    return this.adminService.updateSettings(updates);
  }

  @ApiPaginated(Withdrawal)
  @Get('withdrawals')
  @ResponseMessage('Lấy danh sách yêu cầu rút tiền thành công')
  getWithdrawals(
    @Query('page') page: string,
    @Query('limit') limit: string,
    @Query('status') status: string,
  ) {
    return this.adminService.getWithdrawals(+page || 1, +limit || 20, status);
  }

  @Patch('withdrawals/:id/approve')
  @ResponseMessage('Duyệt yêu cầu rút tiền thành công')
  approveWithdrawal(@Param('id') id: string, @User() user: IUser) {
    return this.adminService.approveWithdrawal(+id, user.id);
  }

  @Patch('withdrawals/:id/reject')
  @ResponseMessage('Từ chối yêu cầu rút tiền thành công')
  rejectWithdrawal(
    @Param('id') id: string,
    @Body('note') note: string,
    @User() user: IUser,
  ) {
    return this.adminService.rejectWithdrawal(+id, user.id, note);
  }

  /**
   * Chặng thứ ba: tiền rời khỏi hệ thống sang `bank_external` sau khi admin đã
   * chuyển khoản thật ngoài đời.
   *
   * `AdminService.completeWithdrawal` và `WithdrawalsService.complete` đều đã
   * tồn tại và có test, nhưng KHÔNG có route nào gọi tới. Nghĩa là lệnh rút chỉ
   * đi được tới `approved` rồi đứng đó vĩnh viễn, và tiền vẫn nằm trong
   * `withdrawal_pending` — sổ cái nói người bán chưa được trả, dù thực tế đã
   * chuyển. Thiếu đúng bảy dòng này.
   */
  @Patch('withdrawals/:id/complete')
  @ResponseMessage('Hoàn tất yêu cầu rút tiền thành công')
  completeWithdrawal(@Param('id') id: string, @User() user: IUser) {
    return this.adminService.completeWithdrawal(+id, user.id);
  }
}
