import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { normalizePagination } from '@common/dto/pagination.dto';
import { CreateUserDto, RegisterUserDto } from './dto/create-user.dto';
import { COT_SUA_DUOC, UpdateUserDto } from './dto/update-user.dto';
import { Repository } from 'typeorm';
import { User, UserRole } from './entities/user.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { compareSync, genSalt, hash } from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) { }

  /**
   * Hash a plain password using bcrypt with a configurable salt round and a server‑side pepper.
   * The pepper is read from the environment variable `PASSWORD_PEPPER` and is concatenated
   * to the password before hashing. This adds an extra secret that is never stored in the DB.
   */
  async hashPassword(password: string): Promise<string> {
    const pepper = process.env.PASSWORD_PEPPER ?? '';
    const salt = await genSalt(10);
    const hash = await hash(password + pepper, salt);
    return hash;
  }

  async create(createUserDto: CreateUserDto) {
    const hashPassword = await this.hashPassword(createUserDto.password);
    const newUser = this.userRepository.create({
      ...createUserDto,
      password: hashPassword,
    });
    return await this.userRepository.save(newUser);
  }

  async findAll(currentPage: string, limit: string, qs: string) {
    const {
      page: numPage,
      size: numLimit,
      offset,
    } = normalizePagination(currentPage, limit);

    const [result, totalItems] = await this.userRepository.findAndCount({
      skip: offset,
      take: numLimit,
    });

    const totalPages = Math.ceil(totalItems / numLimit);

    return {
      meta: {
        current: numPage,
        pageSize: numLimit,
        pages: totalPages,
        total: totalItems,
      },
      result
    };
  }

  async findOne(id: number) {
    const foundUser = await this.userRepository.findOne({ where: { id } })
    if (!foundUser) {
      throw new NotFoundException("Tài khoản không tồn tại")
    }
    return foundUser;
  }

  async update(id: number, updateUserDto: UpdateUserDto) {
    const foundUser = await this.userRepository.findOne({ where: { id } });
    if (!foundUser) {
      throw new NotFoundException('Tài khoản không tồn tại');
    }
    // Lọc lại theo danh sách trắng dù DTO đã chặn: hàm này còn được gọi thẳng
    // (script, test), và một object lọt password/role vào đây là ghi mật khẩu
    // chưa băm hoặc đổi vai trò không thu hồi phiên (xem update-user.dto.ts).
    const patch: UpdateUserDto = {};
    for (const k of COT_SUA_DUOC) {
      if (updateUserDto[k] !== undefined) patch[k] = updateUserDto[k];
    }
    if (Object.keys(patch).length) {
      await this.userRepository.update(id, patch);
    }
    return this.findOne(id);
  }

  async remove(id: number) {
    const foundUser = await this.userRepository.findOne({ where: { id } })
    if (!foundUser) {
      throw new NotFoundException("Không tìm thấy tài khoản!");
    }
    await this.userRepository.softDelete({ id });
    return { message: 'Xóa tài khoản thành công' };
  }

  // `emailVerified` mặc định false: người gọi phải tự nói là đã chứng minh
  // email. POST /auth/register (không OTP) đã bị gỡ; hiện chỉ
  // AuthService.verifyRegisterOtp gọi hàm này, với true, sau khi người dùng đã
  // gõ đúng mã OTP gửi về chính email đó.
  async register(registerUserDto: RegisterUserDto, emailVerified = false) {
    const { full_name, email, password, phone_number } = registerUserDto;
    const existingUser = await this.userRepository.findOne({ where: { email } });
    if (existingUser) {
      throw new BadRequestException("Tài khoản đã tồn tại!");
    }
    const hashPassword = await this.hashPassword(password);
    const newUser = this.userRepository.create({
      full_name,
      email,
      password: hashPassword,
      phone_number,
      // Gán cứng, không đọc từ tham số: lớp chặn thứ hai cho B-01 nếu có ai
      // gọi hàm này với một object có sẵn `role`.
      role: UserRole.BUYER,
      email_verified: emailVerified,
    });
    return await this.userRepository.save(newUser);
  }

  async findOneByEmail(email: string) {
    const query = this.userRepository.createQueryBuilder('user');
    query.where('user.email = :email', { email });
    query.select(['user.id', 'user.full_name', 'user.email', 'user.password', 'user.phone_number', 'user.role']);
    return await query.getOne();
  }

  /**
   * Validate a plain password against a stored bcrypt hash.
   * The same server‑side pepper used during hashing is appended
   * to the plain password before comparison.
   */
  isValidPassword(password: string, hash: string) {
    const pepper = process.env.PASSWORD_PEPPER ?? '';
    return compareSync(password + pepper, hash);
  }

  async updateUserToken(refreshToken: string, id: string) {
    return await this.userRepository.update(+id, {
      refresh_token: refreshToken
    });
  }
}
