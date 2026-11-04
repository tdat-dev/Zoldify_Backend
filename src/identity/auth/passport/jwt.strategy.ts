import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '@identity/users/entities/user.entity';
import { UserSession, phienConSong } from '../entities/user-session.entity';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(UserSession)
    private readonly phienRepository: Repository<UserSession>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get('JWT_ACCESS_SECRET') || '',
    });
  }

  async validate(payload: any) {
    const user = await this.userRepository.findOne({
      where: { id: payload.sub },
    });
    if (!user) throw new UnauthorizedException('Người dùng không tồn tại');
    // Khoá tài khoản phải có hiệu lực ngay trên mọi request (audit B-04).
    if (user.is_locked) throw new UnauthorizedException('Tài khoản đã bị khóa');
    if (payload.token_version !== user.token_version) {
      throw new UnauthorizedException(
        'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại',
      );
    }
    // Token có sid phải còn dòng phiên sống: đăng xuất chỉ thu hồi dòng của máy
    // đó, không tăng token_version nên kiểm trên không thấy. Một câu theo khoá
    // chính mỗi request; không cache, vì đăng xuất phải có hiệu lực ngay trên
    // cả ba bản api. Token phát trước bản này không có sid: bỏ qua bước này
    // cho tới khi chúng hết hạn, nếu không deploy là đá mọi người đang dùng.
    if (payload.sid) {
      const phien = await this.phienRepository.findOne({
        where: { id: payload.sid },
        select: ['id', 'revoked_at', 'expires_at'],
      });
      if (!phienConSong(phien)) {
        throw new UnauthorizedException(
          'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại',
        );
      }
    }
    return {
      id: payload.sub,
      full_name: payload.full_name,
      email: payload.email,
      role: payload.role,
      sid: payload.sid,
    };
  }
}
