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
import { mailerConfig } from '../../common/mailer.config';

@Module({
  imports: [
    UsersModule,
    TypeOrmModule.forFeature([User]),
    CacheModule.register({ ttl: 300, max: 100 }),
    // AuthService lấy MailerService từ ĐÂY, không phải từ bản khai trong
    // app.module — module nào tự khai thì dùng bản của chính nó. Hai bản từng
    // chép tay và đã lệch: bản này thiếu `defaults.from`, nên mail OTP đi ra
    // không có người gửi dù SMTP điền đúng. Nay cả hai gọi chung một hàm.
    MailerModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: mailerConfig,
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
