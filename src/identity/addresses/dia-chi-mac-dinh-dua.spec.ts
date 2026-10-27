import { DataSource, Repository } from 'typeorm';
import { AddressesService } from './addresses.service';
import { Address } from './entities/address.entity';
import { User } from '@identity/users/entities/user.entity';
import type { IUser } from '@identity/users/users.interface';

/**
 * Hai lần đặt mặc định cùng lúc để lại HAI địa chỉ mặc định.
 *
 * `setDefault`/`create`/`update` làm hai câu rời: bỏ mặc định mọi địa chỉ của
 * người dùng, rồi đặt mặc định cho một cái. Hai yêu cầu chen nhau (bấm hai lần
 * trên hai thiết bị, app gửi lại khi mạng chập) thì cả hai câu "bỏ" chạy trước
 * cả hai câu "đặt", và kết quả là hai địa chỉ cùng `is_default = 1`. Màn thanh
 * toán lấy địa chỉ mặc định đầu tiên tìm thấy: đơn đi tới địa chỉ người dùng
 * không chọn.
 *
 * Điểm chen: chặn ngay SAU câu "bỏ mặc định" đầu tiên của mỗi lượt, đợi lượt
 * kia tới cùng chỗ (tối đa 1.5s, để bản vá có khoá dòng không treo bài kiểm).
 *
 * Chạy trên MySQL thật: cách vá là khoá dòng, repo giả không khoá được gì.
 */
const TEST_DB = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 3307),
  username: process.env.TEST_DB_USER ?? 'root',
  password: process.env.TEST_DB_PASSWORD ?? 'testpw',
  database: process.env.TEST_DB_NAME ?? 'zoldify_test',
};

jest.setTimeout(60_000);

function diemHen(soLuot: number, ms: number): () => Promise<void> {
  let den = 0;
  let mo: () => void = () => undefined;
  const duNguoi = new Promise<void>((r) => (mo = r));
  return async () => {
    den += 1;
    if (den >= soLuot) mo();
    let hen: NodeJS.Timeout | undefined;
    await Promise.race([
      duNguoi,
      new Promise((r) => (hen = setTimeout(r, ms))),
    ]);
    clearTimeout(hen);
  };
}

describe('Địa chỉ mặc định: luôn đúng một cái', () => {
  let ds: DataSource;
  let repo: Repository<Address>;
  let svc: AddressesService;
  let userId: number;
  let ids: number[];

  const toi = (): IUser => ({ id: userId, role: 'buyer' }) as IUser;

  beforeAll(async () => {
    ds = new DataSource({
      type: 'mysql',
      ...TEST_DB,
      entities: [Address, User],
      synchronize: true,
      logging: false,
      // Đủ kết nối cho hai lượt chạy song song thật.
      extra: { connectionLimit: 10 },
    });
    try {
      await ds.initialize();
    } catch (err) {
      throw new Error(
        `Không kết nối được MySQL cho test tại ${TEST_DB.host}:${TEST_DB.port}. ` +
          `Chạy: npm run test:db\nLỗi gốc: ${(err as Error).message}`,
      );
    }
    repo = ds.getRepository(Address);
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.query('DELETE FROM addresses WHERE user_id = ?', [userId]);
      await ds.query('DELETE FROM users WHERE id = ?', [userId]);
      await ds.destroy();
    }
  });

  beforeEach(async () => {
    if (userId) {
      await ds.query('DELETE FROM addresses WHERE user_id = ?', [userId]);
      await ds.query('DELETE FROM users WHERE id = ?', [userId]);
    }
    const email = `dc-${Date.now()}-${Math.floor(Math.random() * 1e6)}@t.local`;
    await ds.query(
      `INSERT INTO users (full_name, email, password, role) VALUES ('u', ?, 'x', 'buyer')`,
      [email],
    );
    const [u] = await ds.query<Array<{ id: number }>>(
      'SELECT id FROM users WHERE email = ?',
      [email],
    );
    userId = Number(u.id);

    ids = [];
    for (let i = 0; i < 3; i++) {
      const a = await repo.save(
        repo.create({
          user: { id: userId },
          recipient_name: `N${i}`,
          phone_number: '0900000000',
          province: 'HN',
          district: 'CG',
          street: `So ${i}`,
          is_default: i === 0,
        }),
      );
      ids.push(a.id);
    }

    svc = new AddressesService(repo);
    // Chen điểm hẹn vào câu UPDATE đầu tiên của mỗi lượt qua repository.
    const hen = diemHen(2, 1_500);
    const goc = repo.update.bind(repo) as Repository<Address>['update'];
    let lan = 0;
    jest.spyOn(repo, 'update').mockImplementation(async (...a) => {
      const kq = await goc(...a);
      if (lan++ < 2) await hen();
      return kq;
    });
  });

  afterEach(() => jest.restoreAllMocks());

  const soMacDinh = async (): Promise<number> => {
    const [r] = await ds.query<Array<{ n: string }>>(
      'SELECT COUNT(*) AS n FROM addresses WHERE user_id = ? AND is_default = 1',
      [userId],
    );
    return Number(r.n);
  };

  it('hai lần setDefault cùng lúc → đúng một mặc định', async () => {
    await Promise.all([
      svc.setDefault(ids[1], toi()),
      svc.setDefault(ids[2], toi()),
    ]);
    expect(await soMacDinh()).toBe(1);
  });

  it('hai lần tạo địa chỉ mặc định cùng lúc → đúng một mặc định', async () => {
    const dto = {
      recipient_name: 'Moi',
      phone_number: '0911111111',
      province: 'HN',
      district: 'CG',
      street: 'So 9',
      is_default: true,
    };
    await Promise.all([svc.create(dto, toi()), svc.create(dto, toi())]);
    expect(await soMacDinh()).toBe(1);
  });

  it('setDefault vẫn chỉ cho địa chỉ của chính mình', async () => {
    const nguoiKhac = { id: userId + 1_000_000, role: 'buyer' } as IUser;
    await expect(svc.setDefault(ids[1], nguoiKhac)).rejects.toThrow();
    expect(await soMacDinh()).toBe(1);
  });

  // Review 27/10 (D): `update` đọc địa chỉ NGOÀI khoá rồi `save` nguyên entity
  // TRONG khoá. Sửa nhãn địa chỉ đang mặc định (A) trong lúc một yêu cầu khác
  // đặt B làm mặc định: lần lưu của `update` ghi lại `is_default = true` đã
  // cũ của A, và người dùng có hai địa chỉ mặc định.
  //
  // Điểm chen: ngay trước khi `update` mở transaction, cho `setDefault(B)`
  // chạy trọn. Chen ở `transaction` chứ không ở `findOne` để bài kiểm vẫn đo
  // được dù bản vá dời lần đọc vào trong transaction.
  it('sửa nhãn địa chỉ mặc định trong lúc đặt mặc định cái khác → vẫn một', async () => {
    const em = repo.manager;
    const goc = em.transaction.bind(em) as (
      ...x: unknown[]
    ) => Promise<unknown>;
    let daChen = false;
    jest
      .spyOn(em, 'transaction')
      .mockImplementation(async (...a: unknown[]) => {
        if (!daChen) {
          daChen = true;
          await svc.setDefault(ids[1], toi());
        }
        return goc(...a);
      });

    await svc.update(ids[0], { label: 'Cơ quan' }, toi());

    expect(await soMacDinh()).toBe(1);
    const [a] = await ds.query<Array<{ label: string; is_default: number }>>(
      'SELECT label, is_default FROM addresses WHERE id = ?',
      [ids[0]],
    );
    expect(a.label).toBe('Cơ quan');
    expect(Number(a.is_default)).toBe(0);
  });
});
