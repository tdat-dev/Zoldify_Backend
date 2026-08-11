import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService, ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheModule } from '@nestjs/cache-manager';
import { MailerModule } from '@nestjs-modules/mailer';
import { JwtStrategy } from './passport/jwt.strategy';
import { LocalStrategy } from './passport/local.strategy';
import { UsersModule } from '@identity/users/users.module';
import { User } from '@identity/users/entities/user.entity';

@Module({
  imports: [
    UsersModule,
    TypeOrmModule.forFeature([User]),
    CacheModule.register({ ttl: 300, max: 100 }),
    // AuthService lấy MailerService từ ĐÂY, không phải từ bản khai trong
    // app.module — module nào tự khai thì dùng bản của chính nó. Bản kia có
    // `defaults.from`, bản này thì không, nên mọi mail OTP đi ra đều KHÔNG CÓ
    // người gửi và nodemailer từ chối ngay ở khâu dựng phong bì. Người dùng
    // chỉ thấy "Không thể gửi email" dù SMTP đã điền đúng.
    MailerModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        transport: {
          host: configService.get<string>('EMAIL_HOST') || 'smtp.gmail.com',
          port: configService.get<number>('EMAIL_PORT') || 587,
          secure: false,
          auth: {
            user: configService.get<string>('EMAIL_USER'),
            pass: configService.get<string>('EMAIL_APP_PASSWORD'),
          },
        },
        defaults: {
          from: `"Zoldify" <${configService.get<string>('EMAIL_USER')}>`,
        },
      }),
      inject: [ConfigService],
    }),
    PassportModule,
    JwtModule.registerAsync({
      useFactory: (configService: ConfigService) => ({
        secret: configService.get('JWT_ACCESS_SECRET') || '',
        signOptions: {
          expiresIn: (configService.get<string>('JWT_ACCESS_EXPIRE') ||
            '1d') as any,
        },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [AuthService, JwtStrategy, LocalStrategy],
  exports: [AuthService, JwtStrategy, LocalStrategy, PassportModule],
  controllers: [AuthController],
})
export class AuthModule {}
