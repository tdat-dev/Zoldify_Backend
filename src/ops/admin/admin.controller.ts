import {
  Controller,
  Get,
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
import { AdminActionLog } from './entities/admin-action-log.entity';
import { AdminAuditService } from './admin-audit.service';
import { LedgerDoiSoatService } from './ledger-doi-soat.service';
import { UpdateUserByAdminDto } from './dto/update-user-by-admin.dto';
import { ChangeRoleDto } from './dto/change-role.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly adminAuditService: AdminAuditService,
    private readonly ledgerDoiSoatService: LedgerDoiSoatService,
  ) {}

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
  changeUserRole(@Param('id') id: string, @Body() dto: ChangeRoleDto) {
    return this.adminService.changeUserRole(+id, dto.role);
  }

  @Patch('users/:id')
  @ResponseMessage('Cập nhật người dùng thành công')
  updateUser(@Param('id') id: string, @Body() dto: UpdateUserByAdminDto) {
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

  /**
   * Nhật ký hành động quản trị (task #34).
   *
   * Chỉ có đọc, và cố ý không có route xoá: một nhật ký xoá được thì không còn
   * là bằng chứng — mà đúng người muốn xoá nó là người có quyền admin.
   *
   * `GET` nên chính route này KHÔNG tự ghi vào nhật ký. Ghi cả lượt xem nhật ký
   * sẽ làm bảng tự sinh ra dữ liệu về chính nó và đẩy hành động thật xuống dưới.
   */
  @ApiPaginated(AdminActionLog)
  @Get('audit-logs')
  @ResponseMessage('Lấy nhật ký hành động admin thành công')
  getAuditLogs(
    @Query('page') page: string,
    @Query('limit') limit: string,
    @Query('admin_id') adminId: string,
    @Query('target_type') targetType: string,
    @Query('target_id') targetId: string,
  ) {
    return this.adminAuditService.tra({
      page: +page || 1,
      limit: +limit || 20,
      admin_id: +adminId || undefined,
      target_type: targetType,
      target_id: targetId,
    });
  }

  /**
   * Trang đối soát sổ cái (task #35).
   *
   * Kiểm tra hai bất biến tiền của sổ cái:
   *  1. SUM(amount) của TOÀN BỘ ledger_entries = 0
   *  2. Với MỖI tài khoản: ledger_accounts.balance = SUM(ledger_entries.amount)
   *
   * Chỉ có ĐỌC. `GET` nên KHÔNG tự ghi vào nhật ký admin — đúng như getAuditLogs.
   * Xem comment ở getAuditLogs để hiểu lý do.
   */
  @Get('ledger/doi-soat')
  @ResponseMessage('Đối soát sổ cái thành công')
  async doiSoatLedger() {
    return this.ledgerDoiSoatService.doiSoat();
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
