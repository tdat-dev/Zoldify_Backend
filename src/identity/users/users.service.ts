import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { normalizePagination } from '@common/dto/pagination.dto';
import { CreateUserDto, RegisterUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { compareSync, genSaltSync, hashSync } from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) { }

  hashPassword(password: string) {
    const salt = genSaltSync(10);
    const hash = hashSync(password, salt)
    return hash;
  }

  async create(createUserDto: CreateUserDto) {
    const hashPassword = this.hashPassword(createUserDto.password);
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
    await this.userRepository.update(id, updateUserDto);
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

  async register(registerUserDto: RegisterUserDto) {
    const { full_name, email, password, phone_number, role } = registerUserDto;
    const existingUser = await this.userRepository.findOne({ where: { email } });
    if (existingUser) {
      throw new BadRequestException("Tài khoản đã tồn tại!");
    }
    const hashPassword = this.hashPassword(password)
    const newUser = this.userRepository.create({
      full_name,
      email,
      password: hashPassword,
      phone_number,
      role,
    });
    return await this.userRepository.save(newUser);
  }

  async findOneByEmail(email: string) {
    const query = this.userRepository.createQueryBuilder('user');
    query.where('user.email = :email', { email });
    query.select(['user.id', 'user.full_name', 'user.email', 'user.password', 'user.phone_number', 'user.role']);
    return await query.getOne();
  }

  isValidPassword(password: string, hash: string) {
    return compareSync(password, hash);
  }

  async updateUserToken(refreshToken: string, id: string) {
    return await this.userRepository.update(+id, {
      refresh_token: refreshToken
    });
  }
}
