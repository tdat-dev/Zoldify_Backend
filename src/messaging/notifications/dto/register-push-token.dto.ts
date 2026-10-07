import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

/** Đăng ký token thiết bị (FCM) để nhận push. */
export class RegisterPushTokenDto {
  @IsString()
  @IsNotEmpty()
  token: string;

  @IsString()
  @IsOptional()
  platform?: string;
}
