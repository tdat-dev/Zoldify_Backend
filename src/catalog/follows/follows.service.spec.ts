import {
  BadRequestException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { Follow } from './entities/follow.entity';
import { FollowsService, SO_LAN_THU_KHI_DEADLOCK } from './follows.service';
import { User } from '@identity/users/entities/user.entity';

/**
 * THEO DÕI NGƯỜI BÁN — module này trước hôm nay không có bài kiểm nào.
 *
 * Bất biến thật nằm ở **database** (khoá `UNIQUE(follower_id, following_id)`),
 * nên bài kiểm phải chạy trên MySQL thật — mock đi thì xanh mà không chứng minh gì.
 *
 * Khoá đó **đã có sẵn** ở `src/migrations/1690000000000-InitialSchema.ts` và
 * `@Unique` trong `follow.entity.ts`. B5-2 **không có việc sửa mã** — chỉ có
 * việc viết bài kiểm.
 *
 * Ca đua dùng `Promise.allSettled`: hai `toggle` **song song**, đúng một
 * `rejected`, đúng một `fulfilled`, và sau đó bảng còn **một** dòng.
 * Giải thích vì sao gọi tuần tự thì không kiểm được gì (lần hai `toggle`
 * **xoá** dòng rồi trả về, nó không ném).
 */
const TEST_DB = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 3307),
  username: process.env.TEST_DB_USER ?? 'root',
  password: process.env.TEST_DB_PASSWORD ?? 'testpw',
  database: process.env.TEST_DB_NAME ?? 'zoldify_test',
};

jest.setTimeout(60_000);

/** Số lượt bấm cùng lúc ở các bài đua `follow`/`unfollow`. */
const SO_LUOT_SONG_SONG = 20;
/** Deadlock là chuyện xác suất: một vòng xanh chưa nói lên gì, nên đua nhiều vòng. */
const SO_VONG_DUA = 5;

describe('FollowsService', () => {
  let dataSource: DataSource;
  let service: FollowsService;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'mysql',
      ...TEST_DB,
      entities: [Follow, User],
      synchronize: true,
      logging: false,
      // Pool mặc định là 10: 20 lượt song song thì 10 lượt xếp hàng trong ứng
      // dụng và chưa từng chạm MySQL cùng lúc, bài đua nhẹ đi một nửa mà không
      // ai biết. Ba bản api x 15 kết nối đủ sức dồn 20 lượt thật vào một dòng.
      // Thêm 2 cho transaction gài khoá và câu đếm lượt đang chờ khoá.
      extra: { connectionLimit: SO_LUOT_SONG_SONG + 2 },
    });
    try {
      await dataSource.initialize();
    } catch (err) {
      throw new Error(
        `Không kết nối được MySQL cho test tại ${TEST_DB.host}:${TEST_DB.port}. ` +
          `Chạy: npm run test:db. Lỗi gốc: ${(err as Error).message}`,
      );
    }
    service = new FollowsService(dataSource.getRepository(Follow));
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.getRepository(Follow).clear();
  });

  const taoUser = async (id: number) => {
    const userRepo = dataSource.getRepository(User);
    await userRepo.save({
      id,
      full_name: `User ${id}`,
      email: `user${id}@test.local`,
      password: 'x',
      role: 'buyer',
    } as User);
  };

  it('không cho theo dõi chính mình', async () => {
    // Không phải chuyện thẩm mỹ: một dòng tự-theo-dõi làm `countFollowers`
    // đếm thêm một người không có thật, và con số đó hiện trên trang shop.
    await taoUser(7);
    await expect(service.toggle(7, 7)).rejects.toThrow(BadRequestException);
  });

  it('bấm lần đầu là theo dõi, lần hai là bỏ theo dõi', async () => {
    await taoUser(1);
    await taoUser(2);
    const lan1 = await service.toggle(1, 2);
    expect(lan1.followed).toBe(true);

    const lan2 = await service.toggle(1, 2);
    expect(lan2.followed).toBe(false);

    // Lần ba phải theo dõi lại được — nếu `remove` xoá nhầm nhiều dòng hoặc
    // `findOne` so sai chiều thì ca này mới lộ.
    const lan3 = await service.toggle(1, 2);
    expect(lan3.followed).toBe(true);
  });

  it('theo dõi có CHIỀU: A theo B không có nghĩa B theo A', async () => {
    // `findOne` so cả hai cột. Đảo nhầm chiều thì bấm theo dõi một người sẽ
    // vô tình bỏ theo dõi người đang theo mình — lỗi im lặng, không ai báo.
    await taoUser(1);
    await taoUser(2);
    await service.toggle(1, 2);

    expect(await service.isFollowing(1, 2)).toBe(true);
    expect(await service.isFollowing(2, 1)).toBe(false);
  });

  it('đếm đúng hai chiều', async () => {
    await taoUser(1);
    await taoUser(2);
    await taoUser(10);
    await taoUser(3);
    await service.toggle(1, 10);
    await service.toggle(2, 10);
    await service.toggle(10, 3);

    expect(await service.countFollowers(10)).toBe(2);
    expect(await service.countFollowings(10)).toBe(1);
  });

  it('hai request song song tạo trùng → database từ chối (khoá UNIQUE)', async () => {
    // Khoá UNIQUE(follower_id, following_id) đã có trong migration
    // InitialSchema (line 70). Database phải từ chối lần ghi thứ hai.
    await taoUser(1);
    await taoUser(2);

    // Xoá nếu có để đảm bảo trạng thái sạch
    await dataSource
      .getRepository(Follow)
      .delete({ follower_id: 1, following_id: 2 });

    // Hai request song song cùng tạo follow → một sẽ bị DB từ chối do UNIQUE
    const results = await Promise.allSettled([
      service.toggle(1, 2),
      service.toggle(1, 2),
    ]);
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected.length).toBe(1);
    expect(rejected[0].reason).toBeInstanceOf(Error);
  });

  /**
   * Q5/Q6 TRÊN TRELLO: `toggle` lật trạng thái theo thứ đang có trên server chứ
   * không theo điều người dùng muốn. Thiết bị A còn hiện "Đang theo dõi" trong
   * khi B đã bỏ: A bấm bỏ theo dõi thì thành theo dõi lại. Hai thiết bị cùng bấm
   * bỏ: lượt sau lật lại lượt trước, cuối cùng vẫn đang theo dõi.
   *
   * `follow`/`unfollow` nói rõ ý định nên kết quả không phụ thuộc trạng thái
   * trước đó. Bài song song gọi đúng service và đếm dòng thật trong bảng: chép
   * lại câu SQL ra đây thì sửa mã xong bài vẫn y nguyên, không nghiệm thu được.
   */
  describe('follow/unfollow nói rõ ý định', () => {
    const soDong = (followerId = 1, followingId = 2) =>
      dataSource.getRepository(Follow).count({
        where: { follower_id: followerId, following_id: followingId },
      });

    /** Mọi lượt phải thành công. Lỗi thì in mã MySQL để biết đụng khoá kiểu gì. */
    const phaiThanhCongHet = <T>(ketQua: PromiseSettledResult<T>[]) => {
      const loi = ketQua
        .filter((k): k is PromiseRejectedResult => k.status === 'rejected')
        .map((k) => {
          const e = k.reason as { code?: string; message?: string };
          return e.code ?? e.message;
        });
      expect(loi).toEqual([]);
    };

    /**
     * Gài đúng thế deadlock thay vì trông vào may rủi.
     *
     * Đua thuần qua service gần như không chạm được nó: đo 150 đợt 20 lượt lẫn
     * lộn, `repository.delete` chỉ 0-5 đợt deadlock, thay riêng DELETE bằng câu
     * SQL trần là 61 đợt. QueryBuilder làm DELETE tới MySQL trễ hơn các INSERT
     * nên hai bên ít khi trùng nhau, bài xanh mà không chứng minh gì, trong khi
     * request thật từ ba bản api không bị lệch kiểu đó.
     *
     * Nên ở đây: giữ một DELETE chưa commit, cho `luot` xếp hàng sau khoá của
     * nó, đếm đủ số lượt đang chờ trong InnoDB rồi mới commit. Tất cả cùng tỉnh
     * dậy trên bản ghi vừa bị đánh dấu xoá, đúng cảnh hai lượt chèn giữ khoá gap
     * chia sẻ rồi chờ nhau.
     */
    const sauMotLuotBoChuaCommit = async <T>(luot: (() => Promise<T>)[]) => {
      await service.follow(1, 2);

      const qr = dataSource.createQueryRunner();
      await qr.connect();
      await qr.startTransaction();
      try {
        await qr.query(
          'DELETE FROM follows WHERE follower_id = 1 AND following_id = 2',
        );
        let daXong = 0;
        const ketQua = Promise.allSettled(
          luot.map((chay) => chay().finally(() => daXong++)),
        );

        // Đếm ở `data_lock_waits`, không ở `innodb_trx.trx_state`: bảng đó không
        // liệt kê các DELETE đang chờ, đo được 10/20 trong lúc đủ 20 lượt đã kẹt.
        const hetHan = Date.now() + 15_000;
        for (;;) {
          const [{ soLuot }] = await dataSource.query<{ soLuot: string }[]>(
            `SELECT COUNT(DISTINCT REQUESTING_THREAD_ID) AS soLuot
               FROM performance_schema.data_lock_waits`,
          );
          // Tính cả lượt đã xong: lượt bị MySQL loại ngay lúc đang xếp hàng thì
          // không bao giờ quay lại hàng chờ, đếm riêng hàng chờ sẽ treo tới hạn.
          if (Number(soLuot) + daXong >= luot.length) break;
          if (Date.now() > hetHan) {
            throw new Error(`Chỉ ${soLuot}/${luot.length} lượt chờ khoá`);
          }
          await new Promise((xong) => setTimeout(xong, 5));
        }

        await qr.commitTransaction();
        return await ketQua;
      } finally {
        if (qr.isTransactionActive) await qr.rollbackTransaction();
        await qr.release();
      }
    };

    beforeEach(async () => {
      await taoUser(1);
      await taoUser(2);
    });

    it('bỏ theo dõi khi vốn không theo dõi thì vẫn không theo dõi', async () => {
      expect(await service.unfollow(1, 2)).toEqual({ followed: false });
      expect(await soDong()).toBe(0);
    });

    it('theo dõi khi đã theo dõi thì vẫn theo dõi, không tạo dòng mới', async () => {
      expect(await service.follow(1, 2)).toEqual({ followed: true });
      const dongDau = await dataSource
        .getRepository(Follow)
        .findOneByOrFail({ follower_id: 1, following_id: 2 });

      expect(await service.follow(1, 2)).toEqual({ followed: true });

      // So cả id: xoá rồi chèn lại cũng ra một dòng, nhưng làm mất `created_at`
      // và đẩy người này lên đầu danh sách người theo dõi của shop.
      const dongSau = await dataSource
        .getRepository(Follow)
        .findOneByOrFail({ follower_id: 1, following_id: 2 });
      expect(dongSau.id).toBe(dongDau.id);
      expect(await soDong()).toBe(1);
    });

    it('Q5: thiết bị A còn trạng thái cũ, bấm bỏ theo dõi không theo dõi lại', async () => {
      await service.follow(1, 2);
      await service.unfollow(1, 2); // thiết bị B

      expect(await service.unfollow(1, 2)).toEqual({ followed: false }); // A
      expect(await service.isFollowing(1, 2)).toBe(false);
    });

    it('theo dõi có CHIỀU: bỏ theo dõi B không đụng tới việc B theo mình', async () => {
      await service.follow(1, 2);
      await service.follow(2, 1);

      await service.unfollow(1, 2);

      expect(await service.isFollowing(1, 2)).toBe(false);
      expect(await service.isFollowing(2, 1)).toBe(true);
    });

    it('Q6: 20 lượt bỏ theo dõi song song, kết thúc không theo dõi, không lượt nào lỗi', async () => {
      for (let vong = 0; vong < SO_VONG_DUA; vong++) {
        await service.follow(1, 2);

        const ketQua = await Promise.allSettled(
          Array.from({ length: SO_LUOT_SONG_SONG }, () =>
            service.unfollow(1, 2),
          ),
        );

        phaiThanhCongHet(ketQua);
        expect(await soDong()).toBe(0);
      }
    });

    it('20 lượt theo dõi song song, đúng một dòng, không lượt nào lỗi', async () => {
      for (let vong = 0; vong < SO_VONG_DUA; vong++) {
        await service.unfollow(1, 2);

        const ketQua = await Promise.allSettled(
          Array.from({ length: SO_LUOT_SONG_SONG }, () => service.follow(1, 2)),
        );

        phaiThanhCongHet(ketQua);
        expect(await soDong()).toBe(1);
      }
    });

    it('20 lượt theo dõi tỉnh dậy trên bản ghi vừa xoá, đúng một dòng, không lượt nào lỗi', async () => {
      for (let vong = 0; vong < SO_VONG_DUA; vong++) {
        const ketQua = await sauMotLuotBoChuaCommit(
          Array.from(
            { length: SO_LUOT_SONG_SONG },
            () => () => service.follow(1, 2),
          ),
        );

        phaiThanhCongHet(ketQua);
        expect(await soDong()).toBe(1);
        expect(await service.isFollowing(1, 2)).toBe(true);
      }
    });

    it('20 lượt lẫn lộn tỉnh dậy trên bản ghi vừa xoá, bảng vẫn nhất quán', async () => {
      for (let vong = 0; vong < SO_VONG_DUA; vong++) {
        const ketQua = await sauMotLuotBoChuaCommit(
          Array.from(
            { length: SO_LUOT_SONG_SONG },
            (_, i) => () =>
              i % 2 === 0 ? service.follow(1, 2) : service.unfollow(1, 2),
          ),
        );

        phaiThanhCongHet(ketQua);
        const dong = await soDong();
        expect(dong).toBeLessThanOrEqual(1);
        expect(await service.isFollowing(1, 2)).toBe(dong === 1);

        // Đưa về một trạng thái đã biết: sau trận đua cả hai chiều vẫn đi được.
        await service.unfollow(1, 2);
        expect(await soDong()).toBe(0);
      }
    });

    it('20 lượt lẫn lộn theo dõi và bỏ theo dõi, bảng vẫn nhất quán', async () => {
      for (let vong = 0; vong < SO_VONG_DUA; vong++) {
        // Bản ghi vừa bị đánh dấu xoá là thứ gây deadlock: mỗi đợt phải có một.
        await service.follow(1, 2);
        await service.unfollow(1, 2);

        const ketQua = await Promise.allSettled(
          Array.from({ length: SO_LUOT_SONG_SONG }, (_, i) =>
            i % 2 === 0 ? service.follow(1, 2) : service.unfollow(1, 2),
          ),
        );

        phaiThanhCongHet(ketQua);
        // Mỗi lượt trả đúng ý định của chính nó, không phải trạng thái ai khác.
        ketQua.forEach((k, i) => {
          expect(k).toEqual({
            status: 'fulfilled',
            value: { followed: i % 2 === 0 },
          });
        });
        const dong = await soDong();
        expect(dong).toBeLessThanOrEqual(1);
        expect(await service.isFollowing(1, 2)).toBe(dong === 1);
      }

      // Sau trận đua, cả hai chiều vẫn đi được.
      await service.follow(1, 2);
      expect(await soDong()).toBe(1);
      await service.unfollow(1, 2);
      expect(await soDong()).toBe(0);
    });

    it('hai người theo dõi nhau cùng lúc, không lượt nào lỗi', async () => {
      // Chèn `follows` lấy khoá chia sẻ trên CẢ HAI dòng users (khoá ngoại). Cách
      // nào khoá dòng users theo thứ người bấm rồi người được theo thì hai chiều
      // ngược nhau là đủ thành vòng chờ, bài cùng một cặp không thấy được.
      for (let vong = 0; vong < SO_VONG_DUA; vong++) {
        const ketQua = await Promise.allSettled(
          Array.from({ length: SO_LUOT_SONG_SONG }, (_, i) =>
            i % 2 === 0 ? service.follow(1, 2) : service.follow(2, 1),
          ),
        );

        phaiThanhCongHet(ketQua);
        expect(await soDong(1, 2)).toBe(1);
        expect(await soDong(2, 1)).toBe(1);

        await service.unfollow(1, 2);
        await service.unfollow(2, 1);
      }
    });

    it('20 người khác nhau cùng theo dõi một shop, đủ 20 dòng', async () => {
      const nguoiTheoDoi = Array.from(
        { length: SO_LUOT_SONG_SONG },
        (_, i) => 100 + i,
      );
      for (const id of nguoiTheoDoi) await taoUser(id);

      const ketQua = await Promise.allSettled(
        nguoiTheoDoi.map((id) => service.follow(id, 2)),
      );

      phaiThanhCongHet(ketQua);
      expect(await service.countFollowers(2)).toBe(SO_LUOT_SONG_SONG);
    });

    it('không cho theo dõi chính mình, và không ghi gì', async () => {
      await expect(service.follow(1, 1)).rejects.toThrow(BadRequestException);
      expect(await soDong(1, 1)).toBe(0);
    });

    it.each([
      ['không có trong bảng users', 987_654],
      // Vượt cột INT: ParseIntPipe cho qua, MySQL ở chế độ strict ném 1264.
      ['vượt khoảng cột INT', 99_999_999_999],
    ])('theo dõi người %s là 404, không phải 500', async (_mo, id) => {
      const loi: unknown = await service.follow(1, id).catch((e: unknown) => e);

      // `INSERT IGNORE` nuốt luôn lỗi khoá ngoại: không có dòng nào mà vẫn trả
      // `followed: true`. Bài này chặn chính cái bẫy đó.
      expect(loi).toBeInstanceOf(NotFoundException);
      expect((loi as HttpException).getStatus()).toBe(404);
      expect(await service.countFollowings(1)).toBe(0);
    });

    it('theo dõi tài khoản đã xoá mềm là 404', async () => {
      // Xoá tài khoản chỉ gắn `deleted_at`, dòng users còn nguyên nên khoá ngoại
      // không chặn gì. Bấm từ một trang cũ thì sinh ra dòng theo dõi một người
      // đã biến mất, và `getFollowing` trả về phần tử rỗng trong danh sách.
      await taoUser(3);
      await dataSource.getRepository(User).softDelete({ id: 3 });
      try {
        await expect(service.follow(1, 3)).rejects.toThrow(NotFoundException);
        expect(await soDong(1, 3)).toBe(0);
      } finally {
        await dataSource.getRepository(User).restore({ id: 3 });
      }
    });

    it('bỏ theo dõi tài khoản đã xoá vẫn được: người ta đang muốn gỡ nó đi', async () => {
      await taoUser(3);
      await service.follow(1, 3);
      await dataSource.getRepository(User).softDelete({ id: 3 });
      try {
        expect(await service.unfollow(1, 3)).toEqual({ followed: false });
        expect(await soDong(1, 3)).toBe(0);
      } finally {
        await dataSource.getRepository(User).restore({ id: 3 });
      }
    });
  });

  /**
   * Giới hạn thử lại phải đo được bằng số lần gọi, và MySQL thật không ép ra
   * "deadlock mãi không dứt" được, nên phần này dùng repository giả.
   */
  describe('thử lại khi deadlock', () => {
    const loiMySql = (errno: number, code: string) =>
      new QueryFailedError(
        'câu SQL',
        [],
        Object.assign(new Error(code), { errno, code }),
      );
    const DEADLOCK = loiMySql(1213, 'ER_LOCK_DEADLOCK');

    const taoService = () => {
      const repo = { query: jest.fn(), delete: jest.fn() };
      return {
        repo,
        service: new FollowsService(repo as unknown as Repository<Follow>),
      };
    };

    it('follow thử lại rồi thành công', async () => {
      const { repo, service: s } = taoService();
      repo.query
        .mockRejectedValueOnce(DEADLOCK)
        .mockRejectedValueOnce(DEADLOCK)
        .mockResolvedValue({ affectedRows: 1 });

      expect(await s.follow(1, 2)).toEqual({ followed: true });
      expect(repo.query).toHaveBeenCalledTimes(3);
    });

    it('unfollow thử lại rồi thành công', async () => {
      const { repo, service: s } = taoService();
      repo.delete.mockRejectedValueOnce(DEADLOCK).mockResolvedValue({});

      expect(await s.unfollow(1, 2)).toEqual({ followed: false });
      expect(repo.delete).toHaveBeenCalledTimes(2);
    });

    it('hết lượt thử thì ném nguyên lỗi 1213 để DatabaseExceptionFilter trả 409', async () => {
      const { repo, service: s } = taoService();
      repo.query.mockRejectedValue(DEADLOCK);
      repo.delete.mockRejectedValue(DEADLOCK);

      await expect(s.follow(1, 2)).rejects.toBe(DEADLOCK);
      await expect(s.unfollow(1, 2)).rejects.toBe(DEADLOCK);

      expect(repo.query).toHaveBeenCalledTimes(SO_LAN_THU_KHI_DEADLOCK);
      expect(repo.delete).toHaveBeenCalledTimes(SO_LAN_THU_KHI_DEADLOCK);
    });

    it.each([
      ['chờ khoá quá hạn', loiMySql(1205, 'ER_LOCK_WAIT_TIMEOUT')],
      ['lỗi không phải của database', new Error('mất kết nối')],
    ])('%s không được thử lại', async (_mo, loi) => {
      const { repo, service: s } = taoService();
      repo.query.mockRejectedValue(loi);
      repo.delete.mockRejectedValue(loi);

      await expect(s.follow(1, 2)).rejects.toBe(loi);
      await expect(s.unfollow(1, 2)).rejects.toBe(loi);

      expect(repo.query).toHaveBeenCalledTimes(1);
      expect(repo.delete).toHaveBeenCalledTimes(1);
    });
  });
});
