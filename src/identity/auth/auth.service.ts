import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '@identity/users/users.service';
import { RegisterUserDto } from '@identity/users/dto/create-user.dto';
import { IUser } from '@identity/users/users.interface';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '@identity/users/entities/user.entity';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { MailerService } from '@nestjs-modules/mailer';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private readonly mailerService: MailerService,
  ) { }

  async validateUser(email: string, pass: string): Promise<any> {
    const user = await this.usersService.findOneByEmail(email);
    if (user) {
      const isValid = this.usersService.isValidPassword(pass, user.password);
      if (isValid) {
        const { password, ...result } = user;
        return result;
      }
    }
    return null;
  }

  async login(user: any) {
    const dbUser = await this.userRepository.findOne({ where: { id: user.id } });
    const tokenVersion = dbUser?.token_version || 0;

    const { id, full_name, email, role } = user;
    const payload = { sub: id, full_name, email, role, token_version: tokenVersion };
    const refreshToken = this.createRefreshToken(payload);
    await this.usersService.updateUserToken(refreshToken, id.toString());
    return {
      access_token: this.jwtService.sign(payload),
      refresh_token: refreshToken,
      user: { id, full_name, email, role },
    };
  }

  createRefreshToken(payload: any) {
    return this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_REFRESH_TOKEN_SECRET') || '',
      expiresIn: this.configService.get<string>('JWT_REFRESH_EXPIRE') as any,
    });
  }

  async sendRegisterOtp(email: string, full_name: string) {
    const existing = await this.userRepository.findOne({ where: { email } });
    if (existing) throw new BadRequestException('Email đã được đăng ký');

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    await this.cacheManager.set(`register_otp_${email}`, { otp, full_name }, 300000);

    try {
      await this.mailerService.sendMail({
        to: email,
        subject: 'Zoldify - Xác thực đăng ký tài khoản',
        html: `
          <div style="font-family: sans-serif; padding: 20px; max-width: 500px;">
            <h2 style="color: #EE4D2D;">Zoldify</h2>
            <h3>Xác thực đăng ký tài khoản</h3>
            <p>Mã OTP xác thực của bạn là:</p>
            <div style="font-size: 28px; font-weight: bold; color: #2C67C8; letter-spacing: 8px; text-align: center; padding: 12px; background: #f5f5f5; border-radius: 8px; margin: 16px 0;">
              ${otp}
            </div>
            <p style="color: #666;">Mã có hiệu lực trong <b>5 phút</b>.</p>
          </div>
        `,
      });
    } catch {
      throw new BadRequestException('Không thể gửi email, vui lòng thử lại sau');
    }

    return { message: 'Mã OTP đã được gửi đến email của bạn' };
  }

  async verifyRegisterOtp(email: string, otp: string, password: string) {
    const data = await this.cacheManager.get<{ otp: string; full_name: string }>(`register_otp_${email}`);
    if (!data) throw new BadRequestException('Mã OTP đã hết hạn hoặc không tồn tại');
    if (data.otp !== otp) throw new BadRequestException('Mã OTP không chính xác');

    const newUser = await this.usersService.register({
      full_name: data.full_name,
      email,
      password,
    });

    await this.cacheManager.del(`register_otp_${email}`);

    return {
      id: newUser.id,
      email: newUser.email,
      full_name: newUser.full_name,
      role: newUser.role,
    };
  }

  async register(registerUserDto: RegisterUserDto) {
    const newUser = await this.usersService.register(registerUserDto)
    return {
      id: newUser.id,
      email: newUser.email,
      full_name: newUser.full_name,
      role: newUser.role,
    }
  }

  async logout(user: IUser) {
    await this.userRepository.increment({ id: user.id }, 'token_version', 1);
    await this.usersService.updateUserToken('', user.id.toString());
    return { message: 'Đăng xuất thành công' };
  }
  // ===================== FORGOT PASSWORD =====================

  async sendForgotPasswordOtp(email: string) {
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) throw new NotFoundException('Không tìm thấy tài khoản với email này');

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    await this.cacheManager.set(`forgot_otp_${email}`, otp, 300000);

    try {
      await this.mailerService.sendMail({
        to: email,
        subject: 'Zoldify - Mã OTP khôi phục mật khẩu',
        html: `
          <div style="font-family: sans-serif; padding: 20px; max-width: 500px;">
            <h2 style="color: #EE4D2D;">Zoldify</h2>
            <h3>Yêu cầu đặt lại mật khẩu</h3>
            <p>Mã OTP của bạn là:</p>
            <div style="font-size: 28px; font-weight: bold; color: #2C67C8; letter-spacing: 8px; text-align: center; padding: 12px; background: #f5f5f5; border-radius: 8px; margin: 16px 0;">
              ${otp}
            </div>
            <p style="color: #666;">Mã có hiệu lực trong <b>5 phút</b>. Vui lòng không chia sẻ mã này.</p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
            <p style="color: #999; font-size: 12px;">Nếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này.</p>
          </div>
        `,
      });
    } catch {
      throw new BadRequestException('Không thể gửi email, vui lòng thử lại sau');
    }

    return { message: 'Mã OTP đã được gửi đến email của bạn' };
  }

  async resetPassword(email: string, otp: string, newPassword: string) {
    const savedOtp = await this.cacheManager.get<string>(`forgot_otp_${email}`);
    if (!savedOtp) throw new BadRequestException('Mã OTP đã hết hạn hoặc không tồn tại');
    if (savedOtp !== otp) throw new BadRequestException('Mã OTP không chính xác');

    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) throw new NotFoundException('Không tìm thấy tài khoản');

    const hashedPassword = this.usersService.hashPassword(newPassword);
    await this.userRepository.update(user.id, { password: hashedPassword });
    await this.cacheManager.del(`forgot_otp_${email}`);

    return { message: 'Đặt lại mật khẩu thành công' };
  }


  async changePassword(userId: number, oldPassword: string, newPassword: string) {
    const user = await this.usersService.findOneByEmail(
      (await this.userRepository.findOne({ where: { id: userId } }))?.email || ''
    );
    if (!user) throw new NotFoundException('Người dùng không tồn tại');
    if (!this.usersService.isValidPassword(oldPassword, user.password)) {
      throw new BadRequestException('Mật khẩu cũ không chính xác');
    }
    if (oldPassword === newPassword) {
      throw new BadRequestException('Mật khẩu mới không được trùng với mật khẩu cũ');
    }
    const hashedPassword = this.usersService.hashPassword(newPassword);
    await this.userRepository.update(userId, { password: hashedPassword });
    return { message: 'Thay đổi mật khẩu thành công' };
  }

  async updateProfile(userId: number, full_name: string) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Người dùng không tồn tại');

    await this.userRepository.update(userId, { full_name });

    return {
      id: user.id,
      full_name,
      email: user.email,
      role: user.role,
      avatar: user.avatar,
    };
  }
}


