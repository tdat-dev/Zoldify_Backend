import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '@identity/users/users.service';
import { IUser } from '@identity/users/users.interface';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '@identity/users/entities/user.entity';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { MailerService } from '@nestjs-modules/mailer';
import { createHash, randomInt, randomUUID } from 'crypto';
import { emailChuanHoaHoacLoi } from '@common/email';

/**
 * Băm refresh token trước khi lưu vào users.refresh_token.
 *
 * Bản trước lưu nguyên token: ai đọc được bảng users (bản sao lưu, một câu
 * SELECT lọt ra ngoài; cột này từng lộ qua GET /products, xem user.entity.ts)
 * là cầm được phiên còn hạn một tuần của mọi người. SHA-256 không muối là đủ:
 * token là JWT ngẫu nhiên dài, không có từ điển nào để dò ngược như mật khẩu,
 * và phải so được bằng một câu UPDATE ... WHERE refresh_token = ? (bcrypt thì
 * không). 64 ký tự hex vừa cột VARCHAR(500) sẵn có, không cần migration.
 */
const bamRefresh = (token: string) =>
  createHash('sha256').update(token).digest('hex');

/**
 * Bao lâu sau khi một refresh token được đổi thì việc gửi lại CHÍNH nó vẫn coi
 * là trùng lặp vô hại (409) chứ không phải trộm (thu hồi mọi phiên).
 *
 * Vì sao cần: hai request làm mới cùng lúc bằng một token (hai tab, app thử
 * lại khi mạng chập chờn) là chuyện thường. Không có ân hạn thì request thua
 * tăng token_version và giết luôn token vừa phát cho request thắng: người dùng
 * bị đá ra vì chính mình. Lưu trong cache (Redis khi có), không cần migration.
 * Đánh đổi: kẻ trộm gửi lại token cũ trong 30 giây đó chỉ nhận 409 chứ không
 * kích hoạt thu hồi; nó cũng không nhận được token nào, nên không lấy được gì.
 */
const AN_HAN_REFRESH_MS = 30_000;

/** OTP sống 5 phút. */
const OTP_SONG_MS = 300_000;
/**
 * Số lần gõ sai tối đa cho MỘT mã OTP; lần sai thứ 5 là mã bị xoá.
 *
 * Bản trước không đếm: throttle chặn 5 lần/phút mỗi IP, nên kẻ đoán có nhiều
 * IP thử được bao nhiêu mã trong 5 phút là chuyện của số máy, không phải của
 * thiết kế, trong khi cả không gian chỉ có 900.000 mã. Đếm lưu CÙNG bản ghi
 * OTP, nên yêu cầu mã mới là bắt đầu lại từ 0.
 *
 * NỢ: đọc rồi ghi hai bước, không nguyên tử. Nhiều request sai bắn đúng cùng
 * lúc có thể đếm hụt vài lần; vẫn bị trần throttle chặn. Muốn chính xác tuyệt
 * đối thì đếm bằng INCR của Redis.
 */
const SO_LAN_SAI_TOI_DA = 5;

/** Bản ghi OTP trong cache: mã, số lần sai, mốc hết hạn (ms). */
type BanGhiOtp = { otp: string; sai: number; het_han: number };

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  /**
   * Gửi một email, và khi hỏng thì NÓI RA hỏng vì cái gì.
   *
   * Trước đây hai chỗ gửi OTP đều `catch {}` rồi ném ra đúng một câu
   * "Không thể gửi email, vui lòng thử lại sau". Sai mật khẩu ứng dụng, cổng
   * 587 bị chặn, thiếu người gửi, Gmail chặn vì chưa bật 2 bước — bốn nguyên
   * nhân khác hẳn nhau, một câu thông báo. Người tự dựng máy chủ không có
   * đường nào lần ra, vì lỗi thật bị nuốt trước khi tới log.
   *
   * Câu trả về cho người dùng vẫn giữ nguyên (đừng phơi cấu hình SMTP ra
   * ngoài), nhưng lỗi thật thì vào log của máy chủ.
   */
  private async send(to: string, subject: string, html: string) {
    try {
      await this.mailerService.sendMail({ to, subject, html });
    } catch (err: any) {
      this.logger.error(
        `Gửi mail tới ${to} thất bại: ${err?.message || err}` +
          (this.configService.get<string>('EMAIL_USER')
            ? ''
            : ' — EMAIL_USER đang trống, kiểm tra .env'),
      );
      throw new BadRequestException(
        'Không thể gửi email, vui lòng thử lại sau',
      );
    }
  }

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private readonly mailerService: MailerService,
  ) {}

  /**
   * OTP 6 số từ crypto.randomInt. Bản trước dùng Math.random: V8 sinh nó bằng
   * xorshift128+, không phải nguồn ngẫu nhiên cho bí mật (đủ mẫu đầu ra là
   * suy ra được các số kế tiếp).
   */
  private sinhOtp(): string {
    return randomInt(100000, 1000000).toString();
  }

  private banGhiOtpMoi(otp: string): BanGhiOtp {
    return { otp, sai: 0, het_han: Date.now() + OTP_SONG_MS };
  }

  /**
   * So OTP gõ vào với bản trong cache. Đúng thì trả bản ghi (người gọi tự xoá
   * sau khi dùng xong). Sai thì tăng đếm và ghi lại với THỜI GIAN CÒN LẠI (ghi
   * với TTL đầy đủ là mỗi lần đoán sai lại gia hạn mã thêm 5 phút); sai tới
   * SO_LAN_SAI_TOI_DA thì xoá hẳn mã.
   */
  private async kiemOtp<T extends BanGhiOtp>(
    khoa: string,
    otp: string,
  ): Promise<T> {
    const data = await this.cacheManager.get<T>(khoa);
    const conLai =
      data && typeof data === 'object' ? data.het_han - Date.now() : 0;
    // !(conLai > 0) chứ không conLai <= 0: bản ghi kiểu cũ (trước bản vá, không
    // có het_han) cho NaN, mà NaN <= 0 là false, tức lọt qua kiểm hết hạn.
    if (!data || !(conLai > 0)) {
      throw new BadRequestException('Mã OTP đã hết hạn hoặc không tồn tại');
    }
    if (data.otp !== otp) {
      const sai = (data.sai ?? 0) + 1;
      if (sai >= SO_LAN_SAI_TOI_DA) {
        await this.cacheManager.del(khoa);
        throw new BadRequestException(
          'Nhập sai mã OTP quá 5 lần, vui lòng yêu cầu mã mới',
        );
      }
      await this.cacheManager.set(khoa, { ...data, sai }, conLai);
      throw new BadRequestException('Mã OTP không chính xác');
    }
    return data;
  }

  async validateUser(email: string, pass: string): Promise<any> {
    // Chuẩn hoá và từ chối email ngoài ASCII TRƯỚC mọi lần tra DB hay gửi
    // mail (email giả dạng IDN, xem common/email.ts).
    email = emailChuanHoaHoacLoi(email);
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
    const dbUser = await this.userRepository.findOne({
      where: { id: user.id },
    });
    // Không phát token cho tài khoản bị khoá. Mọi đường đăng nhập (mật khẩu,
    // Google/Firebase, đặt mật khẩu) đều đi qua hàm này (audit B-04).
    if (dbUser?.is_locked) {
      throw new UnauthorizedException(
        'Tài khoản đã bị khóa, vui lòng liên hệ hỗ trợ',
      );
    }
    const tokenVersion = dbUser?.token_version || 0;

    const { id, full_name, email, role } = user;
    const payload = {
      sub: id,
      full_name,
      email,
      role,
      token_version: tokenVersion,
    };
    const refreshToken = this.createRefreshToken(payload);
    await this.usersService.updateUserToken(
      bamRefresh(refreshToken),
      id.toString(),
    );
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
      // jti ngẫu nhiên: thiếu nó thì hai token phát trong cùng một giây cho
      // cùng một người là HAI CHUỖI GIỐNG HỆT (cùng payload, cùng iat), và
      // "token cũ chết khi token mới ra đời" không còn nghĩa gì. Đo được trong
      // refresh-dung-mot-lan.spec.ts: login rồi làm mới hai lần liền ra một
      // token duy nhất.
      jwtid: randomUUID(),
    });
  }

  async sendRegisterOtp(email: string, full_name: string) {
    // Chuẩn hoá và từ chối email ngoài ASCII TRƯỚC mọi lần tra DB hay gửi
    // mail (email giả dạng IDN, xem common/email.ts).
    email = emailChuanHoaHoacLoi(email);
    const existing = await this.userRepository.findOne({ where: { email } });
    if (existing) throw new BadRequestException('Email đã được đăng ký');

    const otp = this.sinhOtp();
    await this.cacheManager.set(
      `register_otp_${email}`,
      { ...this.banGhiOtpMoi(otp), full_name },
      OTP_SONG_MS,
    );

    await this.send(
      email,
      'Zoldify - Xác thực đăng ký tài khoản',
      `
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
    );

    return { message: 'Mã OTP đã được gửi đến email của bạn' };
  }

  async verifyRegisterOtp(email: string, otp: string, password: string) {
    // Chuẩn hoá và từ chối email ngoài ASCII TRƯỚC mọi lần tra DB hay gửi
    // mail (email giả dạng IDN, xem common/email.ts).
    email = emailChuanHoaHoacLoi(email);
    const data = await this.kiemOtp<BanGhiOtp & { full_name: string }>(
      `register_otp_${email}`,
      otp,
    );

    // true: tài khoản này vừa chứng minh quyền sở hữu email bằng mã OTP. Đây
    // giờ là đường đăng ký công khai duy nhất (POST /auth/register không OTP
    // đã bị gỡ, xem auth.controller.ts).
    const newUser = await this.usersService.register(
      {
        full_name: data.full_name,
        email,
        password,
      },
      true,
    );

    await this.cacheManager.del(`register_otp_${email}`);

    return {
      id: newUser.id,
      email: newUser.email,
      full_name: newUser.full_name,
      role: newUser.role,
    };
  }

  async logout(user: IUser, pushToken?: string) {
    await this.userRepository.increment({ id: user.id }, 'token_version', 1);
    await this.usersService.updateUserToken('', user.id.toString());

    // Gỡ push token của thiết bị này TRONG CÙNG request (xem LogoutDto).
    //
    // SQL thô chứ không repository PushToken: entity đó thuộc messaging, mà
    // identity không được import messaging (eslint boundaries). Xoá theo CẢ
    // token lẫn user_id, giống `unregisterToken`: ai biết token FCM của máy
    // người khác cũng không gỡ được thông báo của họ.
    //
    // Lỗi ở đây KHÔNG làm hỏng đăng xuất: phiên đã bị thu hồi ở trên rồi, mất
    // bước này thì cùng lắm máy còn nhận push tới khi FCM báo token chết.
    if (pushToken) {
      try {
        await this.userRepository.manager.query(
          'DELETE FROM push_tokens WHERE token = ? AND user_id = ?',
          [pushToken, user.id],
        );
      } catch (err) {
        this.logger.warn(
          `Không gỡ được push token khi user ${user.id} đăng xuất: ` +
            `${(err as Error).message}`,
        );
      }
    }
    return { message: 'Đăng xuất thành công' };
  }
  // ===================== FORGOT PASSWORD =====================

  async sendForgotPasswordOtp(email: string) {
    // Chuẩn hoá và từ chối email ngoài ASCII TRƯỚC mọi lần tra DB hay gửi
    // mail (email giả dạng IDN, xem common/email.ts).
    email = emailChuanHoaHoacLoi(email);
    const user = await this.userRepository.findOne({ where: { email } });
    // Không có tài khoản: trả ĐÚNG câu như khi có, không gửi thư. Bản trước
    // trả 404 "Không tìm thấy tài khoản với email này", tức ai cũng dò được
    // một danh sách email xem cái nào là khách của sàn. Chỉ chủ hộp thư biết
    // có thư hay không. (Còn độ chênh thời gian do gửi mail; chấp nhận, vì
    // route đã bị throttle 5 lần/phút.)
    if (!user) return { message: 'Mã OTP đã được gửi đến email của bạn' };

    const otp = this.sinhOtp();
    // Khoá theo ID TÀI KHOẢN, gửi tới EMAIL TRONG DB, không dùng chuỗi gõ vào.
    // findOne trên collation bỏ dấu, bỏ hoa thường có thể trả về tài khoản mà
    // email KHÁC chuỗi người gọi gõ (victim@gmaïl.com khớp victim@gmail.com).
    // OTP chứng minh sở hữu hộp thư của TÀI KHOẢN, nên chỉ được tới địa chỉ
    // đó; gửi theo chuỗi gõ vào là gửi mã đặt lại cho hộp thư của kẻ khác.
    await this.cacheManager.set(
      `forgot_otp_${user.id}`,
      this.banGhiOtpMoi(otp),
      OTP_SONG_MS,
    );

    await this.send(
      user.email,
      'Zoldify - Mã OTP khôi phục mật khẩu',
      `
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
    );

    return { message: 'Mã OTP đã được gửi đến email của bạn' };
  }

  async resetPassword(email: string, otp: string, newPassword: string) {
    // Chuẩn hoá và từ chối email ngoài ASCII TRƯỚC mọi lần tra DB hay gửi
    // mail (email giả dạng IDN, xem common/email.ts).
    email = emailChuanHoaHoacLoi(email);
    // Tìm tài khoản TRƯỚC rồi mới tìm OTP theo id của nó: cùng một tài khoản
    // dù gõ email kiểu nào cũng chỉ có một OTP (xem sendForgotPasswordOtp).
    // Không có tài khoản thì trả đúng câu "OTP hết hạn" như khi sai OTP, để
    // route này không thành công cụ dò email nào đã đăng ký.
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user)
      throw new BadRequestException('Mã OTP đã hết hạn hoặc không tồn tại');
    await this.kiemOtp(`forgot_otp_${user.id}`, otp);

    const hashedPassword = this.usersService.hashPassword(newPassword);
    // email_verified = true: gõ đúng OTP gửi về hộp thư là đã chứng minh sở
    // hữu email. Đây là đường chủ thật lấy lại tài khoản bị đăng ký trước bằng
    // email của họ; /auth/firebase từ chối nối vào tài khoản chưa xác minh cho
    // tới khi bước này chạy.
    await this.userRepository.update(user.id, {
      password: hashedPassword,
      email_verified: true,
    });
    await this.cacheManager.del(`forgot_otp_${user.id}`);

    // Thu hồi MỌI phiên đã phát trước lúc đặt lại mật khẩu: tăng
    // token_version để JwtStrategy từ chối access token cũ, và xoá
    // refresh_token để không làm mới được nữa. Ai đang giữ token bị lộ sẽ bị
    // đá ra ngay. Không gọi login() như changePassword: người dùng ở đây chưa
    // đăng nhập, app bảo họ đăng nhập lại, và login() từ chối tài khoản bị
    // khoá, nên gọi nó sẽ trả 401 SAU KHI mật khẩu đã đổi xong.
    await this.userRepository.increment({ id: user.id }, 'token_version', 1);
    await this.userRepository.update(user.id, { refresh_token: null });

    return { message: 'Đặt lại mật khẩu thành công' };
  }

  async changePassword(
    userId: number,
    oldPassword: string | undefined,
    newPassword: string,
  ) {
    const user = await this.usersService.findOneByEmail(
      (await this.userRepository.findOne({ where: { id: userId } }))?.email ||
        '',
    );
    if (!user) throw new NotFoundException('Người dùng không tồn tại');

    // Tài khoản social (Google) được tạo với password='' — chưa từng có mật khẩu.
    // Trường hợp này là ĐẶT mật khẩu lần đầu: không cần (và không có) mật khẩu cũ.
    const hasPassword = !!user.password;
    if (hasPassword) {
      if (
        !this.usersService.isValidPassword(oldPassword ?? '', user.password)
      ) {
        throw new BadRequestException('Mật khẩu cũ không chính xác');
      }
      if (oldPassword === newPassword) {
        throw new BadRequestException(
          'Mật khẩu mới không được trùng với mật khẩu cũ',
        );
      }
    }

    const hashedPassword = this.usersService.hashPassword(newPassword);
    await this.userRepository.update(userId, { password: hashedPassword });

    // Thu hồi MỌI phiên khác: tăng token_version → mọi access token cũ (mang
    // version cũ) bị jwt.strategy từ chối; login() ngay sau đó ghi đè refresh
    // token trong DB nên refresh token cũ cũng chết. Nếu token bị đánh cắp thì
    // đổi mật khẩu sẽ đá kẻ gian ra khỏi mọi thiết bị.
    await this.userRepository.increment({ id: userId }, 'token_version', 1);
    // Cấp token MỚI (version mới) cho CHÍNH phiên đang thao tác → phiên này vẫn
    // dùng tiếp liền mạch, chỉ các phiên KHÁC bị đá ra.
    const tokens = await this.login(user);

    // Cảnh báo qua email: nếu token bị lạm dụng, chính chủ biết ngay có người
    // đụng mật khẩu. KHÔNG chặn/không làm fail nếu gửi mail hỏng (đổi đã xong).
    if (user.email) {
      this.notifyPasswordChanged(user.email, user.full_name, hasPassword).catch(
        (err) =>
          this.logger.error(
            `Gửi mail cảnh báo đổi mật khẩu tới ${user.email} thất bại: ${err?.message || err}`,
          ),
      );
    }

    return {
      message: hasPassword
        ? 'Thay đổi mật khẩu thành công'
        : 'Đặt mật khẩu thành công',
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
    };
  }

  /** Email báo mật khẩu vừa được đặt/đổi (an ninh: phát hiện lạm dụng token). */
  private async notifyPasswordChanged(
    to: string,
    name: string | undefined,
    wasChange: boolean,
  ) {
    const action = wasChange ? 'thay đổi' : 'đặt';
    const subject = `Zoldify — Mật khẩu của bạn vừa được ${action}`;
    const html = `
      <div style="font-family:Arial,sans-serif;font-size:15px;color:#1b2733;line-height:1.6">
        <p>Xin chào ${name || 'bạn'},</p>
        <p>Mật khẩu tài khoản Zoldify của bạn <b>vừa được ${action}</b>.</p>
        <p>Nếu <b>chính bạn</b> thực hiện, bỏ qua email này.</p>
        <p>Nếu <b>không phải bạn</b>, hãy đổi lại mật khẩu ngay và kiểm tra bảo mật tài khoản
        (đăng xuất khỏi các thiết bị lạ).</p>
        <p style="color:#64748b;font-size:13px">Email tự động từ Zoldify — vui lòng không trả lời.</p>
      </div>`;
    await this.send(to, subject, html);
  }

  /**
   * Hồ sơ đầy đủ để màn "Sửa hồ sơ" điền sẵn. JWT payload chỉ có
   * id/full_name/email/role, thiếu avatar/phone/gender — nên đọc thẳng từ DB.
   */
  async getProfile(userId: number) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Người dùng không tồn tại');
    // Cột password là `select: false` nên findOne ở trên KHÔNG có nó; đọc lại
    // qua findOneByEmail (có addSelect password), đúng đường changePassword
    // dùng để quyết định có đòi mật khẩu cũ không. Trước 30/09 dùng thẳng
    // user.password nên has_password luôn false với mọi người (lỗi H-05).
    const withPassword = await this.usersService.findOneByEmail(user.email);
    return {
      id: user.id,
      full_name: user.full_name,
      email: user.email,
      role: user.role,
      avatar: user.avatar,
      phone_number: user.phone_number,
      gender: user.gender,
      email_verified: user.email_verified,
      // Có mật khẩu chưa? Tài khoản Google/social ban đầu chưa có → client hiện
      // "Đặt mật khẩu" thay vì "Đổi mật khẩu".
      has_password: !!withPassword?.password,
    };
  }

  async updateProfile(
    userId: number,
    full_name?: string,
    avatar?: string,
    phone_number?: string,
    gender?: string,
  ) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Người dùng không tồn tại');

    // Cập nhật CÓ CHỌN LỌC: chỉ đụng field được gửi lên, để đổi avatar không
    // vô tình xoá tên và ngược lại.
    const patch: {
      full_name?: string;
      avatar?: string;
      phone_number?: string;
      gender?: string;
    } = {};
    if (typeof full_name === 'string' && full_name.trim())
      patch.full_name = full_name.trim();
    if (typeof avatar === 'string') patch.avatar = avatar;
    // phone/gender cho phép chuỗi rỗng = xoá field (khác full_name bắt buộc).
    if (typeof phone_number === 'string')
      patch.phone_number = phone_number.trim();
    if (typeof gender === 'string') patch.gender = gender;
    if (Object.keys(patch).length)
      await this.userRepository.update(userId, patch);

    return {
      id: user.id,
      full_name: patch.full_name ?? user.full_name,
      email: user.email,
      role: user.role,
      avatar: patch.avatar ?? user.avatar,
      phone_number: patch.phone_number ?? user.phone_number,
      gender: patch.gender ?? user.gender,
    };
  }

  // ===================== REFRESH TOKEN =====================

  async refreshToken(refreshToken: string) {
    // Verify the refresh token
    let payload: any;
    try {
      payload = this.jwtService.verify(refreshToken, {
        secret:
          this.configService.get<string>('JWT_REFRESH_TOKEN_SECRET') || '',
      });
    } catch {
      throw new BadRequestException(
        'Refresh token không hợp lệ hoặc đã hết hạn',
      );
    }

    const user = await this.userRepository.findOne({
      where: { id: payload.sub },
    });
    if (!user) {
      throw new BadRequestException('Người dùng không tồn tại');
    }

    // Check token_version to prevent reuse after logout
    if (user.token_version !== payload.token_version) {
      throw new BadRequestException(
        'Refresh token đã bị thu hồi (đã đăng xuất)',
      );
    }

    // Create new tokens
    const newPayload = {
      sub: user.id,
      full_name: user.full_name,
      email: user.email,
      role: user.role,
      token_version: user.token_version,
    };

    const newRefreshToken = this.createRefreshToken(newPayload);

    // DÙNG MỘT LẦN, XOAY VÒNG, VÀ PHÁT HIỆN DÙNG LẠI.
    //
    // Bản trước chỉ kiểm chữ ký và token_version, nên một refresh token bị lộ
    // dùng được song song với chủ thật tới hết hạn, không cách nào phát hiện.
    //
    // Đổi token bằng MỘT câu UPDATE có điều kiện "cột đang giữ đúng token này":
    // hai request cùng một token chạy song song thì chỉ một câu trúng dòng
    // (affected = 1); đọc-rồi-ghi hai bước thì cả hai cùng thấy khớp và cùng
    // được token mới. Vế so nguyên văn (refreshToken chưa băm) là cho các
    // phiên phát TRƯỚC bản vá, lúc cột còn lưu nguyên token: không có nó thì
    // mọi người đang đăng nhập bị coi là dùng lại và bị đá ra ngay sau deploy.
    // Gỡ vế đó khi đã qua một JWT_REFRESH_EXPIRE (7 ngày) kể từ ngày deploy.
    //
    // Không trúng dòng nghĩa là token này đã được đổi rồi (hoặc đã đăng xuất):
    // hoặc kẻ gian đang dùng token cũ, hoặc chủ thật đang dùng token cũ sau
    // khi kẻ gian đổi mất. Không phân biệt được hai ca, nên thu hồi tất cả:
    // tăng token_version (mọi access/refresh token cũ chết) và xoá cột.
    //
    // Đánh đổi phải biết: cột chỉ giữ MỘT refresh token mỗi người, nên đăng
    // nhập trên máy thứ hai làm token của máy thứ nhất thành "cũ"; máy thứ nhất
    // làm mới là đá cả hai máy. Client gọi /auth/refresh phải gom các lần làm
    // mới đồng thời thành một (single-flight). Hôm nay chưa client nào gọi
    // route này (kiểm 25/10). Muốn nhiều phiên song song thì cần bảng phiên
    // riêng, mỗi thiết bị một dòng.
    // KHOẢNG ÂN HẠN 30 GIÂY cho request trùng (xem hằng AN_HAN_REFRESH_MS).
    //
    // Đánh dấu TRƯỚC câu UPDATE, và chỉ khi token gửi lên đúng là token cột
    // đang giữ. Đánh dấu sau UPDATE thì request thua có thể đọc cache trước
    // khi request thắng kịp ghi, và vẫn bị coi là trộm. Đánh dấu vô điều kiện
    // thì kẻ gửi lại token cũ cũng tự cấp ân hạn cho mình và né được phát hiện
    // dùng lại; điều kiện "cột đang giữ đúng token này" chặn ca đó.
    const hashCu = bamRefresh(refreshToken);
    const dangGiu = await this.userRepository
      .createQueryBuilder('u')
      .select('u.refresh_token', 'rt')
      .where('u.id = :id', { id: user.id })
      .getRawOne<{ rt: string | null }>();
    if (dangGiu?.rt === hashCu || dangGiu?.rt === refreshToken) {
      await this.cacheManager
        .set(`refresh_an_han_${hashCu}`, 1, AN_HAN_REFRESH_MS)
        .catch(() => undefined);
    }

    const doi = await this.userRepository
      .createQueryBuilder()
      .update(User)
      .set({ refresh_token: bamRefresh(newRefreshToken) })
      .where('id = :id', { id: user.id })
      .andWhere('refresh_token IN (:...cu)', {
        cu: [bamRefresh(refreshToken), refreshToken],
      })
      .execute();
    if (!doi.affected) {
      const trungHopLe = await this.cacheManager
        .get(`refresh_an_han_${hashCu}`)
        .catch(() => undefined);
      if (trungHopLe) {
        // Một request khác vừa đổi CHÍNH token này: trùng lặp vô hại, không
        // phải trộm. 409 và không thu hồi; client dùng token request kia nhận.
        throw new ConflictException(
          'Refresh token vừa được làm mới bởi một yêu cầu khác',
        );
      }
      await this.userRepository.increment({ id: user.id }, 'token_version', 1);
      await this.userRepository.update(user.id, { refresh_token: null });
      this.logger.warn(
        `Refresh token đã dùng rồi bị gửi lại cho user ${user.id}: thu hồi mọi phiên`,
      );
      throw new BadRequestException(
        'Refresh token đã được dùng hoặc đã bị thu hồi, vui lòng đăng nhập lại',
      );
    }

    return {
      access_token: this.jwtService.sign({
        sub: user.id,
        full_name: user.full_name,
        email: user.email,
        role: user.role,
        token_version: user.token_version,
      }),
      refresh_token: newRefreshToken,
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        role: user.role,
      },
    };
  }
}
