import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

/**
 * PATCH /users/:id (admin) ghi thẳng mật khẩu chưa băm và đổi được vai trò.
 *
 * UpdateUserDto là PartialType(CreateUserDto), nên nhận password, role, email.
 * UsersService.update đưa nguyên DTO vào repository.update:
 *   - password lưu nguyên văn, không bcrypt. Tài khoản đó không đăng nhập được
 *     nữa (compareSync với chuỗi không phải hash), và mật khẩu nằm trần trong DB;
 *   - role đổi được mà không tăng token_version, đi vòng qua route đổi vai trò
 *     riêng PATCH /admin/users/:id/role.
 * Không client nào gọi route này (admin web dùng /admin/users/...). Siết DTO về
 * các cột hồ sơ, và service tự lọc lần nữa vì có thể được gọi từ script.
 */
const KIEM = { whitelist: true, forbidNonWhitelisted: true };

describe('PATCH /users/:id chỉ sửa được cột hồ sơ', () => {
  // Giá trị đều HỢP LỆ với luật cũ của CreateUserDto, để lỗi (nếu có) chỉ có
  // thể đến từ việc trường đó không được phép, không phải từ sai định dạng.
  it.each([
    ['password', 'matkhau123'],
    ['role', 'admin'],
    ['email', 'admin@x.com'],
  ])('DTO từ chối trường %s', async (truong, giaTri) => {
    const loi = await validate(
      plainToInstance(UpdateUserDto, { [truong]: giaTri }),
      KIEM,
    );
    expect(loi.map((e) => e.property)).toContain(truong);
  });

  it('DTO nhận full_name, phone_number, avatar, gender', async () => {
    const loi = await validate(
      plainToInstance(UpdateUserDto, {
        full_name: 'Tên mới',
        phone_number: '0901234567',
        avatar: 'a.png',
        gender: 'nam',
      }),
      KIEM,
    );
    expect(loi).toHaveLength(0);
  });

  it('service không ghi password hay role dù được gọi thẳng', async () => {
    const update = jest.fn(() => Promise.resolve());
    const repo = {
      findOne: jest.fn(() => Promise.resolve({ id: 7 })),
      update,
    };
    const svc = new UsersService(repo as never);

    await svc.update(7, {
      full_name: 'X',
      password: 'mat-khau-tran',
      role: 'admin',
    } as never);

    expect(update).toHaveBeenCalledWith(7, { full_name: 'X' });
  });
});
