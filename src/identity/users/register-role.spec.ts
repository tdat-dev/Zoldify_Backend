import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterUserDto } from './dto/create-user.dto';
import { UsersService } from './users.service';
import { UserRole } from './entities/user.entity';

/**
 * Bài kiểm cho một lỗ hổng đã bịt (audit B-01, 28/09).
 *
 * `RegisterUserDto` từng có trường `role` gắn `@IsEnum(UserRole)`, và
 * `UsersService.register` lưu nguyên giá trị đó. Nên
 * `POST /api/v1/auth/register {"role": "admin", ...}` tạo thẳng một tài khoản
 * admin: duyệt rút tiền, sửa user, sửa settings. Swagger còn liệt kê trường này.
 *
 * Hai lớp chặn, kiểm cả hai: DTO từ chối trường `role` (400 ngay ở
 * ValidationPipe), và service luôn gán BUYER dù có ai gọi nó với role khác.
 */
interface SavedUser {
  role?: string;
}

describe('Đăng ký công khai không được tự chọn vai trò', () => {
  const body = {
    full_name: 'Kẻ thử lách',
    email: 'kev@t.local',
    password: '123456',
  };

  // Đúng cấu hình ValidationPipe toàn cục trong main.ts.
  const check = (plain: object) =>
    validate(plainToInstance(RegisterUserDto, plain), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

  it('body hợp lệ không có role thì qua', async () => {
    expect(await check(body)).toHaveLength(0);
  });

  it.each([UserRole.ADMIN, UserRole.MODERATOR, UserRole.SELLER])(
    'gửi role=%s thì bị từ chối',
    async (role) => {
      const errors = await check({ ...body, role });
      expect(errors.map((e) => e.property)).toContain('role');
    },
  );

  it('service luôn lưu vai trò BUYER, kể cả khi bị gọi kèm role khác', async () => {
    let saved: SavedUser | undefined;
    const repo = {
      findOne: () => Promise.resolve(null),
      create: (x: SavedUser) => x,
      save: (x: SavedUser) => {
        saved = x;
        return Promise.resolve(x);
      },
    };
    const service = new UsersService(repo as never);

    await service.register({ ...body, role: UserRole.ADMIN } as never);

    expect(saved?.role).toBe(UserRole.BUYER);
  });
});
