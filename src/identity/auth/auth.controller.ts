import {
  Controller,
  Get,
  Post,
  UseGuards,
  Req,
  Body,
  Patch,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginUserDto } from '@identity/users/dto/create-user.dto';
import { Public } from '@common/decorators/public.decorator';
import { LocalAuthGuard } from './local-auth.guard';
import { ResponseMessage } from '@common/decorators/response.decorator';
import { ApiBody } from '@nestjs/swagger';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { IUser } from '@identity/users/users.interface';
import { User } from '@common/decorators/user.decorator';
import {
  ChangePasswordDto,
  FirebaseLoginDto,
  RefreshTokenDto,
  ResetPasswordDto,
  SendOtpDto,
  SendRegisterOtpDto,
  VerifyRegisterOtpDto,
} from './dto/auth.entity';
import { FirebaseService } from '@messaging/firebase/firebase.service';
import { chuanHoaEmail, emailChuanHoaHoacLoi } from '@common/email';
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

  // KHÔNG còn POST /auth/register (B-05, M-04). Route đó tạo tài khoản ngay
  // mà không chứng minh gì về email, nên ai cũng đăng ký trước được email của
  // người khác rồi chờ chủ thật tới. Cả ba client đều đăng ký qua send-otp và
  // verify-otp ở trên; hàm gọi /auth/register còn sót trong mã web, admin và
  // app nhưng không màn hình nào gọi tới (kiểm 25/10).

  @Public()
  // Cùng mức với đăng nhập mật khẩu: mỗi lần gọi là một lần hỏi Google, và
  // route này tự TẠO tài khoản, nên không được để ai bắn liên tục.
  @Throttle({
    short: { limit: 3, ttl: 1000 },
    medium: { limit: 10, ttl: 60000 },
  })
  @ApiEntity(LoginResponseDto)
  @Post('firebase')
  async firebaseLogin(@Body() dto: FirebaseLoginDto) {
    // verifyIdToken đã từ chối token không phải Google, không có email, hoặc
    // email chưa xác minh. Tới đây email là thứ Google đã chứng minh.
    const fbUser = await this.firebaseService.verifyIdToken(dto.idToken);
    // Cùng bộ chuẩn hoá với mọi cửa vào khác (common/email.ts).
    const email = emailChuanHoaHoacLoi(fbUser.email);

    let user = await this.userRepository.findOne({
      where: { email },
    });

    // So BẰNG NHAU sau khi chuẩn hoá, không tin phép tra ở trên. users.email
    // dùng collation bỏ dấu, bỏ hoa thường, nên dòng tìm được có thể mang một
    // email KHÁC email Google vừa chứng minh (nan-nhan@gmaïl.com khớp
    // nan-nhan@gmail.com). Nối vào đó là trao tài khoản của địa chỉ này cho
    // chủ của địa chỉ kia.
    if (user && chuanHoaEmail(user.email) !== email) {
      throw new UnauthorizedException(
        'Email Google không khớp với email của tài khoản',
      );
    }

    // KHÔNG tự nối vào tài khoản có sẵn mà email chưa xác minh (B-05).
    //
    // Đó đúng là hình dạng của "chiếm trước": kẻ xấu đăng ký victim@gmail.com
    // qua đường không OTP, rồi chờ. Chủ thật bấm "Đăng nhập Google", bản cũ
    // nối vào đúng tài khoản ấy, và kẻ xấu vẫn đăng nhập được bằng mật khẩu nó
    // đã đặt. Chủ thật lấy lại tài khoản bằng Quên mật khẩu: OTP gửi về chính
    // hộp thư đó, đặt lại xong thì email được đánh dấu đã xác minh và mọi phiên
    // cũ bị thu hồi.
    if (user && !user.email_verified) {
      throw new UnauthorizedException(
        'Email này đã có tài khoản chưa xác minh. Vui lòng dùng "Quên mật khẩu" để lấy lại tài khoản trước khi đăng nhập bằng Google.',
      );
    }

    if (!user) {
      user = this.userRepository.create({
        email,
        full_name: fbUser.name || 'User',
        password: '',
        avatar: fbUser.avatar,
        phone_number: fbUser.phone_number,
        email_verified: true,
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
  // Giới hạn nhịp: dù đã yêu cầu JWT, chặn spam đổi mật khẩu / dội mail cảnh báo
  // nếu token bị lạm dụng. ĐÃ verify live: ≤1 lần/giây (short) + ≤3 lần/phút
  // (medium). Người thật đổi mật khẩu rất hiếm nên mức này không cản luồng thật.
  @Throttle({
    short: { limit: 1, ttl: 1000 },
    medium: { limit: 3, ttl: 60000 },
  })
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

  @Public()
  @Throttle({
    short: { limit: 5, ttl: 1000 },
    medium: { limit: 20, ttl: 60000 },
  })
  @ApiEntity(LoginResponseDto)
  @Post('refresh')
  @ResponseMessage('Làm mới token thành công')
  @ApiBody({ type: RefreshTokenDto })
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshToken(dto.refreshToken);
  }
}
