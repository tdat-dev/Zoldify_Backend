import { BadRequestException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { LedgerAccount } from '@money/ledger/entities/ledger-account.entity';
import { LedgerEntry } from '@money/ledger/entities/ledger-entry.entity';
import { LedgerTransaction } from '@money/ledger/entities/ledger-transaction.entity';
import { LedgerService } from '@money/ledger/ledger.service';
import { LedgerOwnerType, LedgerPurpose } from '@money/ledger/ledger.types';
import { Wallet } from './entities/wallet.entity';
import { WalletsService } from './wallets.service';

/**
 * VÍ NGƯỜI DÙNG — module `wallets` trước hôm nay KHÔNG CÓ MỘT BÀI KIỂM NÀO.
 *
 * Nó là một trong 12 module trắng test, và là module trắng test DUY NHẤT nằm
 * trong `src/money/`. Mọi đường tiền đi vào hay ra khỏi ví người dùng đều qua
 * đây: nạp, trừ khi đặt hàng, hoàn khi huỷ, chuyển giữa hai người.
 *
 * CHẠY TRÊN MySQL THẬT, không mock sổ cái.
 *
 * Thứ cần kiểm ở đây là bút toán hai chân có thật sự nguyên tử không, và
 * `idempotency_key` có thật sự chặn ghi trùng không. Cả hai đều do DATABASE
 * giữ (transaction + khoá UNIQUE), nên mock đi thì bài kiểm xanh mà chẳng
 * chứng minh được gì — đúng lý do đã ghi ở đầu `ledger.service.spec.ts`.
 *
 * Chạy database cho test:  npm run test:db
 *
 * PHẠM VI: đây là `src/money/`, tức vai A (Đạt). Bài kiểm này chỉ ĐỌC hành vi
 * đang có và chốt nó lại, KHÔNG đổi một dòng logic tiền nào. Nếu nó phát hiện
 * sai sót thì báo chứ không tự sửa.
 */
const TEST_DB = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 3307),
  username: process.env.TEST_DB_USER ?? 'root',
  password: process.env.TEST_DB_PASSWORD ?? 'testpw',
  database: process.env.TEST_DB_NAME ?? 'zoldify_test',
};

jest.setTimeout(60_000);

describe('WalletsService — tiền chỉ đi bằng bút toán hai chân', () => {
  let dataSource: DataSource;
  let wallets: WalletsService;
  let ledger: LedgerService;

  /**
   * Mỗi ca một id người dùng mới, VÀ mỗi LẦN CHẠY một dải id khác.
   *
   * Bản đầu đặt cứng `let nguoiDung = 9_000_000`. Lần chạy đầu xanh hết, lần
   * thứ hai đỏ 9 ca — vì dải id lặp lại, nên số dư và `idempotency_key` của
   * lần trước vẫn còn trong `zoldify_test` và cộng dồn vào.
   *
   * Đúng cái bẫy mà docs/BAN-GIAO.md kể về `check:race`: chạy lần hai trên
   * database chưa dọn thì đỏ, mà đỏ vì dữ liệu cũ chứ không vì mã sai. Một
   * bài kiểm chỉ xanh ở lần chạy đầu thì không dùng nghiệm thu được.
   *
   * Không dọn bảng sổ cái ở đây: jest chạy nhiều suite SONG SONG trên cùng
   * một database, nên xoá dữ liệu là giật thảm dưới chân suite khác.
   */
  let nguoiDung = 9_000_000 + Math.floor(Math.random() * 1_000_000);
  const idMoi = () => ++nguoiDung;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'mysql',
      ...TEST_DB,
      // KHÔNG khai `Wallet` ở đây. Entity đó có quan hệ tới `User`, nên nạp nó
      // kéo theo cả chuỗi entity của catalog/ordering vào một bài kiểm chỉ đụng
      // sổ cái. Và nó không cần: service KHÔNG dùng `walletRepository` lần nào.
      entities: [LedgerAccount, LedgerTransaction, LedgerEntry],
      synchronize: true,
      logging: false,
    });

    try {
      await dataSource.initialize();
    } catch (err) {
      // Ném chứ không skip: một bài kiểm tiền tự bỏ qua khi thiếu database là
      // bài kiểm luôn xanh, và nguy hiểm hơn là đỏ.
      throw new Error(
        `Không kết nối được MySQL cho test tại ${TEST_DB.host}:${TEST_DB.port}. ` +
          `Chạy: npm run test:db. Lỗi gốc: ${(err as Error).message}`,
      );
    }

    ledger = new LedgerService(dataSource);
    wallets = new WalletsService(
      // `walletRepository` được tiêm nhưng KHÔNG hàm nào trong service dùng tới
      // — bảng `wallets` đã ngừng được ghi từ khi chuyển sang sổ cái. Truyền
      // một đối tượng rỗng ở đây chính là cách bài kiểm nói ra điều đó.
      {} as Repository<Wallet>,
      dataSource,
      ledger,
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  /** Số dư khả dụng, đọc thẳng từ sổ cái. */
  const khaDung = (userId: number) =>
    ledger.getBalance(LedgerOwnerType.USER, userId, LedgerPurpose.AVAILABLE);

  /** Tổng MỌI bút toán trong sổ. Sổ cái cân thì nó luôn bằng 0. */
  const tongSoCai = async (): Promise<number> => {
    const rows: Array<{ tong: string }> = await dataSource.query(
      'SELECT COALESCE(SUM(amount), 0) AS tong FROM ledger_entries',
    );
    return Number(rows[0].tong);
  };

  // ── 1. Chặn số tiền vô lý ────────────────────────────────────────────────
  describe('số tiền phải lớn hơn 0', () => {
    // Bốn hàm đều gọi `assertPositive` ở dòng đầu. Kiểm cả bốn chứ không chỉ
    // một: chúng là bốn cửa riêng vào cùng một cái két, và một cửa thêm sau
    // này quên gọi thì bài kiểm phải đỏ ở đúng cửa đó.
    const soXau: Array<[string, number]> = [
      ['số 0', 0],
      ['số âm', -1000],
      ['NaN', Number.NaN],
      ['vô cực', Number.POSITIVE_INFINITY],
    ];

    for (const [ten, so] of soXau) {
      it(`topup từ chối ${ten}`, async () => {
        await expect(wallets.topup(idMoi(), so)).rejects.toThrow(
          BadRequestException,
        );
      });
    }

    it('deduct từ chối số âm', async () => {
      await expect(wallets.deduct(idMoi(), -1)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('refund từ chối số 0', async () => {
      await expect(wallets.refund(idMoi(), 0)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('transfer từ chối số âm', async () => {
      await expect(wallets.transfer(idMoi(), idMoi(), -5)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ── 2. Nạp tiền ──────────────────────────────────────────────────────────
  it('topup cộng đúng vào ví VÀ trừ đúng khỏi két cổng thanh toán', async () => {
    const u = idMoi();
    const truoc = await tongSoCai();

    await wallets.topup(u, 150_000);

    expect(Number(await khaDung(u))).toBe(150_000);
    // Đây mới là phần quan trọng: tiền không được sinh ra từ hư không. Mỗi
    // đồng cộng vào ví phải có một đồng trừ khỏi `gateway_clearing`, nên tổng
    // mọi bút toán trong sổ KHÔNG ĐỔI.
    expect(await tongSoCai()).toBe(truoc);
  });

  it('getBalance trả CẢ hai con số, không riêng khả dụng', async () => {
    // Chú thích trong `wallets.service.ts` kể rằng `getPendingWithdrawal` từng
    // được viết riêng "để giao diện hiển thị đúng", rồi chưa ai gọi bao giờ.
    // Gộp vào `getBalance` là để không quên nữa — nên chốt hình dạng trả về.
    const u = idMoi();
    await wallets.topup(u, 50_000);

    const sd = await wallets.getBalance(u);
    expect(sd).toEqual({ balance: 50_000, pending_withdrawal: 0 });
  });

  it('làm tròn tới đồng, không giữ phần lẻ', async () => {
    // Sổ cái lưu BigInt. Số lẻ phải được chốt ở một quy tắc rõ ràng, nếu không
    // mỗi lần làm tròn khác nhau là sổ lệch dần mà không ai thấy.
    const a = idMoi();
    await wallets.topup(a, 100.4);
    expect(Number(await khaDung(a))).toBe(100);

    const b = idMoi();
    await wallets.topup(b, 100.6);
    expect(Number(await khaDung(b))).toBe(101);
  });

  // ── 3. Idempotency ───────────────────────────────────────────────────────
  it('CÙNG idempotencyKey gọi hai lần chỉ cộng tiền MỘT lần', async () => {
    // Đây là thứ đứng giữa một webhook PayOS gọi lại và một lần cộng tiền
    // trùng. Khoá UNIQUE trên `ledger_transactions.idempotency_key` mới là
    // thứ chặn, không phải mã — nên bài kiểm phải chạy trên MySQL thật.
    const u = idMoi();
    const khoa = `test_topup_${u}`;

    await wallets.topup(u, 70_000, undefined, undefined, khoa);
    await wallets.topup(u, 70_000, undefined, undefined, khoa);

    expect(Number(await khaDung(u))).toBe(70_000);
  });

  it('KHÔNG có idempotencyKey thì gọi hai lần cộng hai lần — có chủ ý', async () => {
    // Chốt lại hành vi mà chú thích của `topup` nói thẳng: không truyền khoá
    // thì nó sinh một UUID mới, "bấm hai lần là cộng hai lần. Chấp nhận được
    // với thao tác tay của admin, KHÔNG chấp nhận được với webhook."
    //
    // Ghi thành bài kiểm để nếu sau này ai đó đổi mặc định thành idempotent,
    // họ phải đọc dòng này và quyết định có chủ ý, chứ không đổi nhầm.
    const u = idMoi();
    await wallets.topup(u, 30_000);
    await wallets.topup(u, 30_000);

    expect(Number(await khaDung(u))).toBe(60_000);
  });

  // ── 4. Trừ và hoàn ───────────────────────────────────────────────────────
  it('deduct chuyển tiền sang két ký quỹ, không làm bốc hơi', async () => {
    const u = idMoi();
    await wallets.topup(u, 200_000);
    const truoc = await tongSoCai();

    await wallets.deduct(u, 80_000);

    expect(Number(await khaDung(u))).toBe(120_000);
    expect(await tongSoCai()).toBe(truoc);
  });

  it('refund trả tiền từ két ký quỹ về ví', async () => {
    const u = idMoi();
    await wallets.topup(u, 200_000);
    await wallets.deduct(u, 80_000);

    await wallets.refund(u, 80_000);

    expect(Number(await khaDung(u))).toBe(200_000);
  });

  // ── 5. Chuyển tiền ───────────────────────────────────────────────────────
  it('transfer không cho chuyển cho chính mình', async () => {
    const u = idMoi();
    await expect(wallets.transfer(u, u, 1000)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('transfer là MỘT bút toán: hoặc cả hai chân, hoặc không chân nào', async () => {
    // Chú thích của hàm kể bản cũ gọi `deduct` rồi `topup` như hai thao tác
    // riêng — sập ở giữa là người gửi mất tiền mà người nhận không có. Bài
    // kiểm chốt lại: sau một lần chuyển, tổng hai ví không đổi.
    const a = idMoi();
    const b = idMoi();
    await wallets.topup(a, 100_000);

    await wallets.transfer(a, b, 40_000);

    expect(Number(await khaDung(a))).toBe(60_000);
    expect(Number(await khaDung(b))).toBe(40_000);
    expect(Number(await khaDung(a)) + Number(await khaDung(b))).toBe(100_000);
  });

  // ── 6. Lịch sử giao dịch ─────────────────────────────────────────────────
  it('getTransactions đọc từ sổ cái và phân trang được', async () => {
    // Bảng `wallet_transactions` cũ không còn được ghi, nên nếu hàm này còn
    // đọc bảng đó thì lịch sử sẽ đứng yên vĩnh viễn — người dùng thấy ví có
    // tiền mà không có dòng nào giải thích vì sao.
    const u = idMoi();
    await wallets.topup(u, 10_000);
    await wallets.topup(u, 20_000);
    await wallets.topup(u, 30_000);

    // `getTransactions` trả `result` kiểu `any[]` (nó map từ SQL thô), nên khai
    // kiểu ở đây để bài kiểm không kéo thêm nợ lint vào bánh cóc.
    const trang1 = (await wallets.getTransactions(u, 1, 2)) as {
      meta: { total: number; pages: number };
      result: Array<{ amount: number; balance_after: number }>;
    };
    expect(trang1.meta.total).toBe(3);
    expect(trang1.meta.pages).toBe(2);
    expect(trang1.result).toHaveLength(2);

    // Mới nhất trước: người đi tra cần giao dịch vừa xảy ra.
    expect(trang1.result[0].amount).toBe(30_000);
    expect(trang1.result[0].balance_after).toBe(60_000);
  });
});
