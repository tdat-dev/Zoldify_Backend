import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService, ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MailerModule } from '@nestjs-modules/mailer';
import { JwtStrategy } from './passport/jwt.strategy';
import { LocalStrategy } from './passport/local.strategy';
import { UsersModule } from '@identity/users/users.module';
import { User } from '@identity/users/entities/user.entity';
import { UserSession } from './entities/user-session.entity';
import { mailerConfig } from '../../common/mailer.config';

@Module({
  imports: [
    UsersModule,
    TypeOrmModule.forFeature([User, UserSession]),
    // KHÔNG khai CacheModule ở đây. AuthService phải lấy cache Redis toàn cục
    // của AppModule, vì OTP và dấu ân hạn refresh phải thấy được từ mọi bản api.
    // Khai riêng là che mất bản toàn cục: đo 05/11 với ba bản api, ân hạn chỉ
    // đúng 3/9 lần, OTP phát ở bản này sang bản khác báo hết hạn. Bài giữ luật
    // này: cache-nhieu-ban-api.spec.ts.
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
