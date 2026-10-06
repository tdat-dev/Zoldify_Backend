import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterUserDto } from './dto/create-user.dto';
import { UserRole } from './entities/user.entity';
import { UsersService } from './users.service';
import type { Repository } from 'typeorm';
import type { User } from './entities/user.entity';

/**
 * ĐĂNG KÝ KHÔNG ĐƯỢC CHO TỰ CHỌN VAI TRÒ.
 *
 * `RegisterUserDto` có trường `role` gắn `@IsEnum(UserRole)`, và
 * `UsersService.register` lấy thẳng `role` từ đó đưa vào `create()`:
 *
 *   POST /api/v1/auth/register {"role":"admin", ...}   → tài khoản admin
 *
 * Route đó `@Public()`, không guard. `ValidationPipe` dùng `whitelist: true`,
 * nhưng whitelist chỉ loại trường KHÔNG có decorator — `role` có decorator nên
 * nó được giữ nguyên.
 *
 * Phát hiện 06/10 lúc đọc khối xung đột giữa nhánh vai B và `origin/staging`:
 * bản của Đạt bỏ `role` khỏi destructure còn bản ta giữ. Lần theo thì ra lỗ
 * thật. Đạt đã vá bên `staging` (audit B-01); bài kiểm này đưa cùng bất biến
 * sang nhánh vai B để lúc hoà hai bên không ai lỡ tay mở lại.
 *
 * HAI LỚP CHẶN, kiểm cả hai — vì một lớp thì lớp kia hỏng là hở:
 *
 *   1. DTO từ chối `role` → 400 ngay ở ValidationPipe, request không vào service.
 *   2. Service luôn gán BUYER → chặn cả khi ai đó gọi `register()` thẳng từ
 *      script, job, hay một controller khác thêm vào sau này.
 *
 * Đường đăng ký qua OTP (`AuthService.verifyRegisterOtp`) gọi `register()` với
 * đúng ba trường nên không dính; nhưng lớp 2 vẫn phủ luôn cả nó.
 */
describe('Đăng ký không được tự chọn vai trò', () => {
  const body = {
    full_name: 'Nguyen Van A',
    email: `role-test-${Date.now()}@zoldify.test`,
    password: '123456',
  };

  const kiemDto = async (input: Record<string, unknown>) =>
    validate(plainToInstance(RegisterUserDto, input), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

  it('body hợp lệ, không kèm role → qua', async () => {
    expect(await kiemDto(body)).toHaveLength(0);
  });

  it.each(['admin', 'seller', 'moderator'])(
    'gửi role=%s → bị từ chối',
    async (role) => {
      const loi = await kiemDto({ ...body, role });
      expect(loi.map((e) => e.property)).toContain('role');
    },
  );

  it('service luôn lưu BUYER, kể cả khi bị gọi kèm role khác', async () => {
    // Repo giả: chỉ cần hai hàm mà `register()` chạm tới. Bất biến ở đây nằm
    // trọn trong mã TypeScript, không phải ở database, nên MySQL thật không
    // chứng minh thêm được gì — xem quy tắc "kiểm ở nơi bất biến thật sự sống".
    let daLuu: Partial<User> | undefined;
    const repo = {
      findOne: () => Promise.resolve(null),
      create: (u: Partial<User>) => u,
      save: (u: Partial<User>) => {
        daLuu = u;
        return Promise.resolve(u);
      },
    } as unknown as Repository<User>;

    const service = new UsersService(repo);
    await service.register({ ...body, role: UserRole.ADMIN } as never);

    expect(daLuu?.role).toBe(UserRole.BUYER);
  });
});
