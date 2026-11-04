import { createHash, randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Controller,
  Get,
  INestApplication,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { DataSource, Repository } from 'typeorm';
import { User } from '@identity/users/entities/user.entity';
import { IUser } from '@identity/users/users.interface';
import { UsersService } from '@identity/users/users.service';
import { FirebaseService } from '@messaging/firebase/firebase.service';
import { AdminService } from '@ops/admin/admin.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UserSession } from './entities/user-session.entity';
import {
  OptionalJwtAuthGuard,
  type RequestNguoiXem,
} from './optional-jwt-auth.guard';
import { JwtStrategy } from './passport/jwt.strategy';

/**
 * Đăng xuất ở một máy đá luôn máy khác (thẻ Trello P2).
 *
 * Người dùng B đăng xuất trên máy B, máy A đang dùng cũng mất phiên, không báo
 * trước. Gốc rễ: logout tăng users.token_version, mà token_version là "đá MỌI
 * phiên". Đúng phải là mỗi lần đăng nhập một dòng user_sessions, `sid` nằm trong
 * JWT, và đăng xuất chỉ thu hồi đúng dòng của máy đang gọi. Những đường cần đá
 * hết (đổi mật khẩu, khoá, dùng lại refresh token) vẫn đi token_version.
 *
 * Chạy trên MySQL thật: "một người thắng" và "chỉ một dòng" phải đúng ở câu SQL.
 */
const TEST_DB = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 3307),
  username: process.env.TEST_DB_USER ?? 'root',
  password: process.env.TEST_DB_PASSWORD ?? 'testpw',
  database: process.env.TEST_DB_NAME ?? 'zoldify_test',
};

jest.setTimeout(60_000);

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const MAT_KHAU = 'MatKhauCu123';
const BAY_NGAY_MS = 7 * 24 * 3600 * 1000;

type NoiDungToken = { sub: number; sid?: string; exp?: number };

describe('Phiên theo từng thiết bị', () => {
  let ds: DataSource;
  let users: Repository<User>;
  let phiens: Repository<UserSession>;
  let svc: AuthService;
  let strategy: JwtStrategy;
  const R = Math.floor(Math.random() * 100_000);
  const ID = 9_600_000 + R;
  const ID_KHAC = 9_700_000 + R;
  const nguoi = {
    id: ID,
    full_name: 'Người dùng',
    email: `phien-${ID}@test.local`,
    role: 'buyer',
  };
  const cauHinh: Record<string, string> = {
    JWT_ACCESS_SECRET: 'bi-mat-access-cho-test',
    JWT_REFRESH_TOKEN_SECRET: 'bi-mat-refresh-cho-test',
    JWT_REFRESH_EXPIRE: '7d',
  };
  const jwt = new JwtService({
    secret: cauHinh.JWT_ACCESS_SECRET,
    signOptions: { expiresIn: '1d' },
  });
  const giaiMa = (t: string) => jwt.decode<NoiDungToken>(t);

  // Cache trong RAM, đủ get/set/del. `xenSet` chen một việc vào đúng lúc đánh
  // dấu ân hạn, tức giữa lúc đọc dòng phiên và câu UPDATE.
  const kho = new Map<string, unknown>();
  let xenSet: (() => Promise<void>) | null = null;
  const cache = {
    get: (k: string) => Promise.resolve(kho.get(k)),
    set: async (k: string, v: unknown) => {
      if (xenSet) return xenSet();
      kho.set(k, v);
    },
    del: (k: string) => {
      kho.delete(k);
      return Promise.resolve();
    },
  };
  const hetHanAnHan = () => kho.clear();

  /** Đúng thứ passport làm: xác minh chữ ký rồi đưa payload cho validate(). */
  const xac = (accessToken: string) =>
    strategy.validate(jwt.verify<NoiDungToken>(accessToken));
  /** Đăng xuất bằng đúng req.user mà JwtStrategy dựng từ token này. */
  const dangXuat = async (accessToken: string, pushToken?: string) =>
    svc.logout((await xac(accessToken)) as unknown as IUser, pushToken);
  const tokenVersion = async () =>
    (await users.findOneByOrFail({ id: ID })).token_version;
  const cotRefresh = async () => {
    const rows = await ds.query<Array<{ refresh_token: string | null }>>(
      'SELECT refresh_token FROM users WHERE id = ?',
      [ID],
    );
    return rows[0]?.refresh_token ?? null;
  };
  const phienCua = (token: string) =>
    phiens.findOneBy({ id: giaiMa(token).sid ?? '' });
  const dongPhienGia = (patch: Partial<UserSession>) =>
    phiens.insert({
      id: randomUUID(),
      user_id: ID,
      refresh_hash: sha256(randomUUID()),
      expires_at: new Date(Date.now() + BAY_NGAY_MS),
      ...patch,
    });

  /** Token phát TRƯỚC bản vá: đúng payload cũ, không có sid. */
  const tokenCu = () => {
    const payload = {
      sub: ID,
      full_name: nguoi.full_name,
      email: nguoi.email,
      role: nguoi.role,
      token_version: 0,
    };
    return {
      access: jwt.sign(payload),
      refresh: jwt.sign(payload, {
        secret: cauHinh.JWT_REFRESH_TOKEN_SECRET,
        expiresIn: '7d',
        jwtid: randomUUID(),
      }),
    };
  };

  beforeAll(async () => {
    ds = new DataSource({
      type: 'mysql',
      ...TEST_DB,
      entities: [User, UserSession],
      synchronize: true,
      logging: false,
    });
    try {
      await ds.initialize();
    } catch (err) {
      throw new Error(
        `Không kết nối được MySQL cho test tại ${TEST_DB.host}:${TEST_DB.port}. ` +
          `Chạy: npm run test:db. Lỗi gốc: ${(err as Error).message}`,
      );
    }
    users = ds.getRepository(User);
    phiens = ds.getRepository(UserSession);
    svc = new AuthService(
      new UsersService(users),
      jwt,
      { get: (k: string) => cauHinh[k] } as never,
      users,
      cache as never,
      { sendMail: () => Promise.resolve() } as never,
      phiens,
    );
    strategy = new JwtStrategy(
      { get: (k: string) => cauHinh[k] } as never,
      users,
      phiens,
    );
  });

  beforeEach(async () => {
    kho.clear();
    xenSet = null;
    await users.delete({ id: ID });
    await users.delete({ id: ID_KHAC });
    await users.save({
      ...nguoi,
      password: new UsersService(users).hashPassword(MAT_KHAU),
      token_version: 0,
    } as User);
    await users.save({
      id: ID_KHAC,
      full_name: 'Người khác',
      email: `phien-${ID_KHAC}@test.local`,
      role: 'buyer',
      password: 'x',
      token_version: 0,
    } as User);
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    if (ds?.isInitialized) {
      await users.delete({ id: ID });
      await users.delete({ id: ID_KHAC });
      await ds.destroy();
    }
  });

  describe('đăng nhập', () => {
    it('tạo một dòng phiên, sid nằm trong cả access lẫn refresh token', async () => {
      const t = await svc.login(nguoi);

      const sid = giaiMa(t.access_token).sid;
      expect(sid).toBeTruthy();
      expect(giaiMa(t.refresh_token).sid).toBe(sid);

      const dong = await phiens.findOneBy({ id: sid });
      expect(dong?.user_id).toBe(ID);
      expect(dong?.refresh_hash).toBe(sha256(t.refresh_token));
      expect(dong?.revoked_at).toBeNull();
      expect(dong?.expires_at.getTime()).toBe(
        (giaiMa(t.refresh_token).exp ?? 0) * 1000,
      );
    });

    it('hai lần đăng nhập là hai phiên khác nhau', async () => {
      const a = await svc.login(nguoi);
      const b = await svc.login(nguoi);

      expect(giaiMa(a.access_token).sid).not.toBe(giaiMa(b.access_token).sid);
      expect(await phiens.countBy({ user_id: ID })).toBe(2);
    });

    // Web và app không gọi /auth/refresh, nên hạn thật của phiên là hạn access
    // token. Cấu hình access dài hơn refresh mà lấy hạn refresh là người dùng
    // bị đá sớm hơn hôm nay, trong khi token của họ còn hạn.
    it('hạn phiên không ngắn hơn hạn access token', async () => {
      const jwtDai = new JwtService({
        secret: cauHinh.JWT_ACCESS_SECRET,
        signOptions: { expiresIn: '30d' },
      });
      const svcDai = new AuthService(
        new UsersService(users),
        jwtDai,
        { get: (k: string) => cauHinh[k] } as never,
        users,
        cache as never,
        {} as never,
        phiens,
      );

      const t = await svcDai.login(nguoi);

      expect((await phienCua(t.access_token))?.expires_at.getTime()).toBe(
        (giaiMa(t.access_token).exp ?? 0) * 1000,
      );
    });

    it('dọn dòng hết hạn của chính người này, chừa phần còn lại', async () => {
      const qua = new Date(Date.now() - 60_000);
      await dongPhienGia({ expires_at: qua });
      await dongPhienGia({ expires_at: qua, revoked_at: qua });
      const conHan = randomUUID();
      await dongPhienGia({ id: conHan });
      const thuHoiConHan = randomUUID();
      await dongPhienGia({ id: thuHoiConHan, revoked_at: new Date() });
      const nguoiKhac = randomUUID();
      await dongPhienGia({ id: nguoiKhac, user_id: ID_KHAC, expires_at: qua });

      const t = await svc.login(nguoi);

      const conLai = (await phiens.findBy({ user_id: ID })).map((p) => p.id);
      expect(conLai.sort()).toEqual(
        [conHan, thuHoiConHan, giaiMa(t.access_token).sid].sort(),
      );
      expect(await phiens.existsBy({ id: nguoiKhac })).toBe(true);
    });

    it('dọn dòng hỏng thì vẫn đăng nhập được', async () => {
      jest.spyOn(phiens, 'delete').mockRejectedValue(new Error('MySQL chập'));

      const t = await svc.login(nguoi);

      await expect(xac(t.access_token)).resolves.toMatchObject({ id: ID });
    });
  });

  describe('đăng xuất', () => {
    it('hai máy, máy B đăng xuất: access token của A chạy, của B bị từ chối', async () => {
      const a = await svc.login(nguoi);
      const b = await svc.login(nguoi);

      await dangXuat(b.access_token);

      await expect(xac(a.access_token)).resolves.toMatchObject({ id: ID });
      await expect(xac(b.access_token)).rejects.toThrow(UnauthorizedException);
    });

    // Đây là cái bẫy lớn nhất của thiết kế: máy B đã đăng xuất mà app còn gửi
    // refresh token (hoặc kẻ gian cầm nó) rồi bị xếp vào ca "dùng lại token"
    // thì token_version tăng, và máy A bị đá đúng như lỗi đang sửa.
    it('refresh token của máy đã đăng xuất bị từ chối mà không đá máy A', async () => {
      const a = await svc.login(nguoi);
      const b = await svc.login(nguoi);
      await dangXuat(b.access_token);

      await expect(svc.refreshToken(b.refresh_token)).rejects.toThrow(
        BadRequestException,
      );

      expect(await tokenVersion()).toBe(0);
      await expect(xac(a.access_token)).resolves.toMatchObject({ id: ID });
      const moi = await svc.refreshToken(a.refresh_token);
      await expect(xac(moi.access_token)).resolves.toMatchObject({ id: ID });
    });

    it('đăng xuất hai lần vô hại, giữ nguyên mốc thu hồi đầu tiên', async () => {
      const a = await svc.login(nguoi);
      const b = await svc.login(nguoi);
      const user = await xac(b.access_token);

      await svc.logout(user as unknown as IUser);
      const dau = (await phienCua(b.access_token))?.revoked_at;
      await phiens.update(
        { id: giaiMa(b.access_token).sid },
        { revoked_at: new Date(Date.now() - 3_600_000) },
      );
      const moc = (await phienCua(b.access_token))?.revoked_at;
      await expect(svc.logout(user as unknown as IUser)).resolves.toBeTruthy();

      expect(dau).toBeTruthy();
      expect((await phienCua(b.access_token))?.revoked_at).toEqual(moc);
      expect(await tokenVersion()).toBe(0);
      await expect(xac(a.access_token)).resolves.toMatchObject({ id: ID });
    });

    it('token có sid: không tăng token_version, không đụng users.refresh_token', async () => {
      const t = await svc.login(nguoi);
      const cot = await cotRefresh();

      await dangXuat(t.access_token);

      expect(await tokenVersion()).toBe(0);
      expect(await cotRefresh()).toBe(cot);
    });

    it('sid của người khác không thu hồi được phiên của họ', async () => {
      const t = await svc.login(nguoi);

      await svc.logout({
        id: ID_KHAC,
        sid: giaiMa(t.access_token).sid,
      } as unknown as IUser);

      await expect(xac(t.access_token)).resolves.toMatchObject({ id: ID });
    });

    it('vẫn gỡ push token của máy đang đăng xuất', async () => {
      const t = await svc.login(nguoi);
      const query = jest
        .spyOn(users.manager, 'query')
        .mockResolvedValue({ affectedRows: 1 });

      await dangXuat(t.access_token, 'fcm-may-nay');

      expect(query).toHaveBeenCalledWith(
        'DELETE FROM push_tokens WHERE token = ? AND user_id = ?',
        ['fcm-may-nay', ID],
      );
    });
  });

  describe('những đường vẫn đá mọi phiên', () => {
    const haiMay = async () => ({
      a: await svc.login(nguoi),
      b: await svc.login(nguoi),
    });
    const caHaiBiTuChoi = async (
      a: { access_token: string; refresh_token: string },
      b: { access_token: string; refresh_token: string },
    ) => {
      await expect(xac(a.access_token)).rejects.toThrow(UnauthorizedException);
      await expect(xac(b.access_token)).rejects.toThrow(UnauthorizedException);
      await expect(svc.refreshToken(a.refresh_token)).rejects.toThrow(
        BadRequestException,
      );
      await expect(svc.refreshToken(b.refresh_token)).rejects.toThrow(
        BadRequestException,
      );
    };

    it('đổi mật khẩu: mọi phiên cũ chết, phiên vừa cấp chạy', async () => {
      const { a, b } = await haiMay();

      const moi = await svc.changePassword(ID, MAT_KHAU, 'MatKhauMoi456');

      await caHaiBiTuChoi(a, b);
      await expect(xac(moi.access_token)).resolves.toMatchObject({ id: ID });
    });

    it('đặt lại mật khẩu bằng OTP: mọi phiên chết', async () => {
      const { a, b } = await haiMay();
      await cache.set(`forgot_otp_${ID}`, {
        otp: '123456',
        sai: 0,
        het_han: Date.now() + 60_000,
      });

      await svc.resetPassword(nguoi.email, '123456', 'MatKhauMoi456');

      await caHaiBiTuChoi(a, b);
    });

    it('khoá tài khoản: mọi phiên chết', async () => {
      const { a, b } = await haiMay();
      const admin = new AdminService(
        users,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        { huyDonChoCuaNguoiBan: () => Promise.resolve([]) } as never,
        { anHangCuaNguoiBan: () => Promise.resolve(0) } as never,
      );

      await admin.toggleUserLock(ID, true);

      await caHaiBiTuChoi(a, b);
    });

    it('dùng lại refresh token cũ quá ân hạn: mọi phiên chết, kể cả máy khác', async () => {
      const { a, b } = await haiMay();
      const moi = await svc.refreshToken(a.refresh_token);
      hetHanAnHan();

      await expect(svc.refreshToken(a.refresh_token)).rejects.toThrow(
        BadRequestException,
      );

      expect(await tokenVersion()).toBe(1);
      expect(await cotRefresh()).toBeNull();
      await caHaiBiTuChoi(moi, b);
    });
  });

  describe('token phát trước bản vá (không có sid)', () => {
    it('vẫn qua JwtStrategy, req.user không có sid', async () => {
      const cu = tokenCu();

      const user = await xac(cu.access);

      expect(user).toMatchObject({ id: ID });
      expect(user).not.toHaveProperty('sid', expect.anything());
    });

    it('đăng xuất giữ hành vi cũ: tăng token_version, xoá cột, đá mọi phiên', async () => {
      const cu = tokenCu();
      await users.update(ID, { refresh_token: sha256(cu.refresh) });
      const moi = await svc.login(nguoi);

      await dangXuat(cu.access);

      expect(await tokenVersion()).toBe(1);
      expect(await cotRefresh()).toBeFalsy();
      await expect(xac(cu.access)).rejects.toThrow(UnauthorizedException);
      await expect(xac(moi.access_token)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('làm mới đi đường cũ trên users.refresh_token, không sinh phiên', async () => {
      const cu = tokenCu();
      await users.update(ID, { refresh_token: sha256(cu.refresh) });

      const moi = await svc.refreshToken(cu.refresh);

      expect(giaiMa(moi.access_token).sid).toBeUndefined();
      expect(giaiMa(moi.refresh_token).sid).toBeUndefined();
      expect(await cotRefresh()).toBe(sha256(moi.refresh_token));
      expect(await phiens.countBy({ user_id: ID })).toBe(0);
      await expect(xac(moi.access_token)).resolves.toMatchObject({ id: ID });
    });

    it('dùng lại token cũ quá ân hạn vẫn thu hồi hết như trước', async () => {
      const cu = tokenCu();
      await users.update(ID, { refresh_token: sha256(cu.refresh) });
      await svc.refreshToken(cu.refresh);
      hetHanAnHan();

      await expect(svc.refreshToken(cu.refresh)).rejects.toThrow(
        BadRequestException,
      );

      expect(await tokenVersion()).toBe(1);
    });
  });

  describe('phiên hết hạn hoặc không còn dòng', () => {
    it('hết hạn: access và refresh bị từ chối, không đá phiên khác', async () => {
      const a = await svc.login(nguoi);
      const b = await svc.login(nguoi);
      await phiens.update(
        { id: giaiMa(b.access_token).sid },
        { expires_at: new Date(Date.now() - 1_000) },
      );

      await expect(xac(b.access_token)).rejects.toThrow(UnauthorizedException);
      await expect(svc.refreshToken(b.refresh_token)).rejects.toThrow(
        BadRequestException,
      );

      expect(await tokenVersion()).toBe(0);
      await expect(xac(a.access_token)).resolves.toMatchObject({ id: ID });
    });

    it('dòng đã bị dọn: token mang sid đó bị từ chối', async () => {
      const t = await svc.login(nguoi);
      await phiens.delete({ id: giaiMa(t.access_token).sid });

      await expect(xac(t.access_token)).rejects.toThrow(UnauthorizedException);
      await expect(svc.refreshToken(t.refresh_token)).rejects.toThrow(
        BadRequestException,
      );
      expect(await tokenVersion()).toBe(0);
    });
  });

  describe('làm mới theo phiên', () => {
    it('xoay hash trên đúng dòng, giữ nguyên sid ở cả hai token mới', async () => {
      const t = await svc.login(nguoi);
      const sid = giaiMa(t.access_token).sid;

      const moi = await svc.refreshToken(t.refresh_token);

      expect(giaiMa(moi.access_token).sid).toBe(sid);
      expect(giaiMa(moi.refresh_token).sid).toBe(sid);
      expect((await phienCua(t.access_token))?.refresh_hash).toBe(
        sha256(moi.refresh_token),
      );
      expect(await phiens.countBy({ user_id: ID })).toBe(1);
    });

    // Refresh token mới có hạn mới, nên dòng phải gia hạn theo. Quên bước này
    // thì người dùng hoạt động liên tục vẫn bị đá đúng ngày thứ bảy.
    it('gia hạn dòng phiên theo token mới', async () => {
      const t = await svc.login(nguoi);
      await phiens.update(
        { id: giaiMa(t.access_token).sid },
        { expires_at: new Date(Date.now() + 3_600_000) },
      );

      const moi = await svc.refreshToken(t.refresh_token);

      expect((await phienCua(t.access_token))?.expires_at.getTime()).toBe(
        (giaiMa(moi.refresh_token).exp ?? 0) * 1000,
      );
    });

    // Với cột đơn users.refresh_token, ca này đá cả hai máy: đăng nhập ở máy
    // thứ hai ghi đè token máy thứ nhất, máy thứ nhất làm mới là "dùng lại".
    it('hai máy làm mới xen kẽ không đụng nhau', async () => {
      const a = await svc.login(nguoi);
      const b = await svc.login(nguoi);

      const a1 = await svc.refreshToken(a.refresh_token);
      const b1 = await svc.refreshToken(b.refresh_token);
      const a2 = await svc.refreshToken(a1.refresh_token);
      const b2 = await svc.refreshToken(b1.refresh_token);

      expect(await tokenVersion()).toBe(0);
      await expect(xac(a2.access_token)).resolves.toMatchObject({ id: ID });
      await expect(xac(b2.access_token)).resolves.toMatchObject({ id: ID });
    });

    it('đăng xuất bằng token đã làm mới thu hồi đúng phiên đó', async () => {
      const a = await svc.login(nguoi);
      const b = await svc.login(nguoi);
      const moi = await svc.refreshToken(b.refresh_token);

      await dangXuat(moi.access_token);

      await expect(xac(b.access_token)).rejects.toThrow(UnauthorizedException);
      await expect(xac(a.access_token)).resolves.toMatchObject({ id: ID });
    });

    it('token vừa đổi gửi lại trong ân hạn: 409, không thu hồi', async () => {
      const t = await svc.login(nguoi);
      const moi = await svc.refreshToken(t.refresh_token);

      await expect(svc.refreshToken(t.refresh_token)).rejects.toThrow(
        ConflictException,
      );

      expect(await tokenVersion()).toBe(0);
      await expect(svc.refreshToken(moi.refresh_token)).resolves.toBeTruthy();
    });

    it('hai request cùng lúc trên một phiên: một thắng, một 409, không thu hồi', async () => {
      const khac = await svc.login(nguoi);
      const t = await svc.login(nguoi);

      const kq = await Promise.allSettled([
        svc.refreshToken(t.refresh_token),
        svc.refreshToken(t.refresh_token),
      ]);

      const thang = kq.filter((k) => k.status === 'fulfilled');
      const thua = kq.filter((k) => k.status === 'rejected');
      expect(thang).toHaveLength(1);
      expect(thua[0]?.reason).toBeInstanceOf(ConflictException);
      expect(await tokenVersion()).toBe(0);
      const moi = (
        thang[0] as PromiseFulfilledResult<{ refresh_token: string }>
      ).value.refresh_token;
      await expect(svc.refreshToken(moi)).resolves.toBeTruthy();
      await expect(xac(khac.access_token)).resolves.toMatchObject({ id: ID });
    });

    // Đăng xuất chen vào giữa lúc đọc dòng và câu UPDATE, cache lại hỏng nên
    // không có dấu ân hạn: UPDATE không trúng dòng nào. Coi đó là "dùng lại"
    // thì một lần đăng xuất bình thường đá hết mọi máy.
    it('đăng xuất chen ngang lúc đang làm mới: không tăng token_version', async () => {
      const a = await svc.login(nguoi);
      const b = await svc.login(nguoi);
      xenSet = async () => {
        await dangXuat(b.access_token);
        throw new Error('Redis chập');
      };

      await expect(svc.refreshToken(b.refresh_token)).rejects.toThrow(
        BadRequestException,
      );

      expect(await tokenVersion()).toBe(0);
      await expect(xac(a.access_token)).resolves.toMatchObject({ id: ID });
    });
  });

  // Chứng minh `sid` đi được hết đường thật: passport -> JwtStrategy -> req.user
  // -> @User() -> AuthService.logout. Gọi thẳng service thì không thấy chỗ nào
  // làm rơi nó.
  describe('qua HTTP thật', () => {
    @Controller('thu')
    class ThuController {
      @UseGuards(OptionalJwtAuthGuard)
      @Get('xem')
      xem(@Req() req: RequestNguoiXem) {
        return { id: req.user?.id ?? null };
      }
    }

    let app: INestApplication;
    const http = () => request(app.getHttpServer() as never);
    const voi = (token: string) => `Bearer ${token}`;

    beforeAll(async () => {
      const mod = await Test.createTestingModule({
        imports: [PassportModule],
        controllers: [AuthController, ThuController],
        providers: [
          { provide: AuthService, useValue: svc },
          { provide: FirebaseService, useValue: {} },
          { provide: getRepositoryToken(User), useValue: users },
        ],
      }).compile();
      app = mod.createNestApplication();
      await app.init();
    });

    afterAll(async () => {
      await app?.close();
    });

    it('POST /auth/logout chỉ giết phiên của máy gọi', async () => {
      const a = await svc.login(nguoi);
      const b = await svc.login(nguoi);

      await http()
        .post('/auth/logout')
        .set('Authorization', voi(b.access_token))
        .expect(201);

      await http()
        .get('/auth/profile')
        .set('Authorization', voi(a.access_token))
        .expect(200);
      await http()
        .get('/auth/profile')
        .set('Authorization', voi(b.access_token))
        .expect(401);
      await http()
        .post('/auth/logout')
        .set('Authorization', voi(b.access_token))
        .expect(401);
      expect(await tokenVersion()).toBe(0);
    });

    it('route tuỳ chọn: phiên đã thu hồi thành khách, không 401', async () => {
      const a = await svc.login(nguoi);
      const b = await svc.login(nguoi);
      await dangXuat(b.access_token);

      const khach = await http()
        .get('/thu/xem')
        .set('Authorization', voi(b.access_token))
        .expect(200);
      const chu = await http()
        .get('/thu/xem')
        .set('Authorization', voi(a.access_token))
        .expect(200);

      expect((khach.body as { id: number | null }).id).toBeNull();
      expect((chu.body as { id: number | null }).id).toBe(ID);
    });
  });
});
