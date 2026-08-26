import {
  Controller,
  Get,
  Post,
  UseGuards,
  Req,
  Body,
  Patch,
} from '@nestjs/common';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import {
  LoginUserDto,
  RegisterUserDto,
} from '@identity/users/dto/create-user.dto';
import { Public } from '@common/decorators/public.decorator';
import { LocalAuthGuard } from './local-auth.guard';
import { ResponseMessage } from '@common/decorators/response.decorator';
import { ApiBody } from '@nestjs/swagger';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { IUser } from '@identity/users/users.interface';
import { User } from '@common/decorators/user.decorator';
import {
  ChangePasswordDto,
  ResetPasswordDto,
  SendOtpDto,
  SendRegisterOtpDto,
  VerifyRegisterOtpDto,
} from './dto/auth.entity';
import { FirebaseService } from '@messaging/firebase/firebase.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User as UserEntity } from '@identity/users/entities/user.entity';
import { ApiEntity } from '@common/decorators/api-response.decorator';
import { MessageResponseDto } from '@common/dto/message-response.dto';
import { AuthUserDto, LoginResponseDto } from './dto/auth-response.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly firebaseService: FirebaseService,
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
  ) {}

  @Public()
  @UseGuards(LocalAuthGuard)
  @Throttle({
    short: { limit: 3, ttl: 1000 },
    medium: { limit: 10, ttl: 60000 },
  })
  @ApiEntity(LoginResponseDto)
  @Post('login')
  @ResponseMessage('Đăng nhập thành công')
  @ApiBody({ type: LoginUserDto })
  handleLogin(@Req() req) {
    return this.authService.login(req.user);
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  @ResponseMessage('Lấy thông tin cá nhân thành công')
  getProfile(@Req() req) {
    return this.authService.getProfile(req.user.id);
  }

  @Public()
  @Throttle({
    short: { limit: 1, ttl: 1000 },
    medium: { limit: 5, ttl: 60000 },
  })
  @ApiEntity(MessageResponseDto)
  @Post('register/send-otp')
  @ResponseMessage('Gửi mã OTP xác thực đăng ký thành công')
  async sendRegisterOtp(@Body() dto: SendRegisterOtpDto) {
    return this.authService.sendRegisterOtp(dto.email, dto.full_name);
  }

  @Public()
  @Throttle({
    short: { limit: 1, ttl: 1000 },
    medium: { limit: 5, ttl: 60000 },
  })
  @ApiEntity(AuthUserDto)
  @Post('register/verify-otp')
  @ResponseMessage('Xác thực OTP thành công')
  async verifyRegisterOtp(@Body() dto: VerifyRegisterOtpDto) {
    return this.authService.verifyRegisterOtp(dto.email, dto.otp, dto.password);
  }

  @Public()
  @Throttle({
    short: { limit: 1, ttl: 1000 },
    medium: { limit: 5, ttl: 60000 },
  })
  @ApiEntity(AuthUserDto)
  @Post('register')
  @ResponseMessage('Đăng ký thành công')
  handleRegister(@Body() registerUserDto: RegisterUserDto) {
    return this.authService.register(registerUserDto);
  }

  @Public()
  @ApiEntity(LoginResponseDto)
  @Post('firebase')
  async firebaseLogin(@Body('idToken') idToken: string) {
    // để test đăng nhập bằng firebase: google
    const fbUser = await this.firebaseService.verifyIdToken(idToken);

    let user = await this.userRepository.findOne({
      where: fbUser.email
        ? { email: fbUser.email }
        : { phone_number: fbUser.phone_number },
    });

    if (!user) {
      user = this.userRepository.create({
        email: fbUser.email || `${fbUser.uid}@firebase.zoldify.com`,
        full_name: fbUser.name || 'User',
        password: '',
        avatar: fbUser.avatar,
        phone_number: fbUser.phone_number,
        email_verified: !!fbUser.email,
      });
      user = await this.userRepository.save(user);
    } else if (fbUser.avatar && fbUser.avatar !== user.avatar) {
      await this.userRepository.update(user.id, { avatar: fbUser.avatar });
    }

    return this.authService.login(user);
  }

  @Public()
  @Throttle({
    short: { limit: 1, ttl: 1000 },
    medium: { limit: 5, ttl: 60000 },
  })
  @ApiEntity(MessageResponseDto)
  @Post('forgot-password/send-otp')
  @ResponseMessage('Gửi OTP thành công')
  async sendForgotPasswordOtp(@Body() dto: SendOtpDto) {
    return this.authService.sendForgotPasswordOtp(dto.email);
  }

  @Public()
  @Throttle({
    short: { limit: 1, ttl: 1000 },
    medium: { limit: 5, ttl: 60000 },
  })
  @ApiEntity(MessageResponseDto)
  @Post('forgot-password/reset')
  @ResponseMessage('Đặt lại mật khẩu thành công')
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.email, dto.otp, dto.newPassword);
  }

  @UseGuards(JwtAuthGuard)
  @ApiEntity(MessageResponseDto)
  @Post('change-password')
  @ResponseMessage('Đổi mật khẩu thành công')
  async changePassword(@User() user: IUser, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(
      user.id,
      dto.oldPassword,
      dto.newPassword,
    );
  }

  @UseGuards(JwtAuthGuard)
  @ApiEntity(MessageResponseDto)
  @Post('logout')
  @ResponseMessage('Đăng xuất thành công')
  async logout(@User() user: IUser) {
    return this.authService.logout(user);
  }

  @UseGuards(JwtAuthGuard)
  @ApiEntity(AuthUserDto)
  @Patch('profile')
  @ResponseMessage('Cập nhật thông tin thành công')
  async updateProfile(
    @User() user: IUser,
    @Body('full_name') full_name?: string,
    @Body('avatar') avatar?: string,
    @Body('phone_number') phone_number?: string,
    @Body('gender') gender?: string,
  ) {
    return this.authService.updateProfile(
      user.id,
      full_name,
      avatar,
      phone_number,
      gender,
    );
  }
}
