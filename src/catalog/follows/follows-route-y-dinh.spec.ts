import {
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { QueryFailedError } from 'typeorm';
import { RESPONSE_MESSAGE } from '@common/decorators/response.decorator';
import { DatabaseExceptionFilter } from '@core/db-exception.filter';
import { JwtAuthGuard } from '@identity/auth/jwt-auth.guard';
import { FollowsController } from './follows.controller';
import { FollowsService } from './follows.service';

/**
 * HỢP ĐỒNG HTTP của `PUT`/`DELETE /follows/:sellerId` (Q5/Q6 trên Trello).
 *
 * Chạy qua bộ định tuyến thật vì thứ cần chứng minh nằm ở đó: `:sellerId` phải
 * tới service dưới dạng số, chữ phải dừng ở 400, và hai route mới không được
 * nuốt `POST /follows/toggle` mà APK đã cài và web hiện tại vẫn gọi. Hành vi
 * ghi thật nằm ở `follows.service.spec.ts`, chạy trên MySQL.
 */
describe('Route theo dõi nói rõ ý định', () => {
  let app: INestApplication;

  const NGUOI_BAM = 7;
  const service = {
    follow: jest.fn(),
    unfollow: jest.fn(),
    toggle: jest.fn(),
    isFollowing: jest.fn(),
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [FollowsController],
      providers: [{ provide: FollowsService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          ctx.switchToHttp().getRequest<{ user: unknown }>().user = {
            id: NGUOI_BAM,
          };
          return true;
        },
      })
      .compile();
    app = mod.createNestApplication({ logger: false });
    // Cùng cấu hình pipe toàn cục với main.ts.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new DatabaseExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    jest.resetAllMocks();
    service.follow.mockResolvedValue({ followed: true });
    service.unfollow.mockResolvedValue({ followed: false });
  });

  const http = () =>
    request(app.getHttpServer() as Parameters<typeof request>[0]);

  it('PUT /follows/:sellerId theo dõi đúng người, id là số', async () => {
    const res = await http().put('/follows/42').expect(200);

    expect(res.body).toEqual({ followed: true });
    expect(service.follow).toHaveBeenCalledWith(NGUOI_BAM, 42);
    expect(service.unfollow).not.toHaveBeenCalled();
  });

  it('DELETE /follows/:sellerId bỏ theo dõi đúng người, id là số', async () => {
    const res = await http().delete('/follows/42').expect(200);

    expect(res.body).toEqual({ followed: false });
    expect(service.unfollow).toHaveBeenCalledWith(NGUOI_BAM, 42);
    expect(service.follow).not.toHaveBeenCalled();
  });

  it.each(['abc', '12abc', '1.5', 'NaN', 'toggle'])(
    'sellerId "%s" không phải số nguyên là 400, service không được gọi',
    async (id) => {
      await http().put(`/follows/${id}`).expect(400);
      await http().delete(`/follows/${id}`).expect(400);

      expect(service.follow).not.toHaveBeenCalled();
      expect(service.unfollow).not.toHaveBeenCalled();
    },
  );

  it('"1e3" tới service là số 1000, không phải chuỗi lạ', async () => {
    // ValidationPipe toàn cục ép `+value` TRƯỚC ParseIntPipe vì tham số khai kiểu
    // number, nên "1e3" đã là 1000 khi tới pipe. Mọi route ParseIntPipe của repo
    // đều vậy. Vô hại: đó là một số nguyên thật, không có gì lạ đi xuống SQL.
    await http().put('/follows/1e3').expect(200);

    expect(service.follow).toHaveBeenCalledWith(NGUOI_BAM, 1000);
  });

  it('POST /follows/toggle vẫn tới `toggle`, hai route mới không nuốt nó', async () => {
    service.toggle.mockResolvedValue({
      followed: true,
      message: 'Đã theo dõi',
    });

    await http().post('/follows/toggle').send({ following_id: 42 }).expect(201);

    expect(service.toggle).toHaveBeenCalledWith(NGUOI_BAM, 42);
    expect(service.follow).not.toHaveBeenCalled();
    expect(service.unfollow).not.toHaveBeenCalled();
  });

  it('deadlock hết lượt thử là 409 kèm lời mời thử lại, không phải 500', async () => {
    service.follow.mockRejectedValue(
      new QueryFailedError(
        'câu SQL',
        [],
        Object.assign(new Error('deadlock'), { errno: 1213 }),
      ),
    );

    const res = await http().put('/follows/42').expect(409);

    expect(JSON.stringify(res.body)).toContain('thử lại');
    expect(JSON.stringify(res.body)).not.toMatch(/Deadlock|follows/i);
  });

  it('GET /follows/check/:sellerId vẫn chạy', async () => {
    service.isFollowing.mockResolvedValue(true);

    const res = await http().get('/follows/check/42').expect(200);

    expect(res.body).toEqual({ followed: true });
  });

  it.each([
    ['follow', 'Đã theo dõi'],
    ['unfollow', 'Đã hủy theo dõi'],
  ] as const)('%s cần đăng nhập và có câu trả lời đúng', (ten, cau) => {
    // Bài trên thay guard bằng bản giả nên không thấy được việc lỡ tay gỡ nó,
    // phải đọc thẳng metadata của route.
    const route = (
      FollowsController.prototype as unknown as Record<string, object>
    )[ten];

    expect(route).toBeDefined();
    expect(Reflect.getMetadata(GUARDS_METADATA, route)).toContain(JwtAuthGuard);
    expect(Reflect.getMetadata(RESPONSE_MESSAGE, route)).toBe(cau);
  });
});
