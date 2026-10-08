import { DataSource } from 'typeorm';
import { Setting } from './entities/setting.entity';
import { SettingsService } from './settings.service';

/**
 * CÀI ĐẶT HỆ THỐNG — module này trước hôm nay không có bài kiểm nào.
 *
 * Hai thứ ở đây đáng gác, và cả hai đều hỏng theo kiểu không ai thấy ngay:
 *
 * 1. `getPublic()` là endpoint KHÔNG CẦN ĐĂNG NHẬP. Nó phải trả đúng bốn khoá
 *    công khai và KHÔNG được để lọt khoá nào khác. Bảng `settings` là chỗ
 *    người ta hay nhét thêm cấu hình về sau — khoá API, email người gửi,
 *    ngưỡng phí — và cái danh sách trắng kia là thứ duy nhất chặn chúng rò ra
 *    một route công khai.
 *
 * 2. `maintenance_mode` phải LUÔN có trong câu trả lời, kể cả khi bảng rỗng.
 *    Chú thích của chính hàm đó nói vì sao: middleware frontend đọc cờ này lúc
 *    người dùng chưa đăng nhập; thiếu khoá thì nó phải tự đoán, mà đoán sai
 *    theo hướng "đang bảo trì" là đóng nhầm cả site.
 *
 * CHẠY TRÊN MySQL THẬT vì `update()` là upsert — đọc rồi ghi — và thứ đáng
 * kiểm là nó không tạo dòng trùng khi gọi hai lần. Entity này không có quan hệ
 * nào nên nạp một mình được, không kéo theo nửa lược đồ.
 *
 * Chạy database cho test:  npm run test:db
 */
const TEST_DB = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 3307),
  username: process.env.TEST_DB_USER ?? 'root',
  password: process.env.TEST_DB_PASSWORD ?? 'testpw',
  database: process.env.TEST_DB_NAME ?? 'zoldify_test',
};

jest.setTimeout(60_000);

describe('SettingsService — cài đặt công khai không được rò', () => {
  let dataSource: DataSource;
  let settings: SettingsService;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'mysql',
      ...TEST_DB,
      entities: [Setting],
      synchronize: true,
      logging: false,
    });
    try {
      await dataSource.initialize();
    } catch (err) {
      throw new Error(
        `Không kết nối được MySQL cho test tại ${TEST_DB.host}:${TEST_DB.port}. ` +
          `Chạy: npm run test:db. Lỗi gốc: ${(err as Error).message}`,
      );
    }
    settings = new SettingsService(dataSource.getRepository(Setting));
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  beforeEach(async () => {
    // Bảng này nhỏ và chỉ suite này dùng, nên dọn sạch được — khác với sổ cái
    // ở `wallets.service.spec.ts`, nơi nhiều suite chạy song song cùng đọc.
    await dataSource.getRepository(Setting).clear();
  });

  it('bảng rỗng vẫn trả maintenance_mode = false', async () => {
    // Thiếu khoá này thì middleware frontend phải tự đoán, và đoán sai theo
    // hướng "đang bảo trì" là đóng nhầm cả site với mọi khách.
    const cong_khai = await settings.getPublic();
    expect(cong_khai.maintenance_mode).toBe('false');
  });

  it('KHÔNG để lọt khoá riêng tư ra route công khai', async () => {
    // Đây là bài kiểm đáng giá nhất của file. Bảng `settings` là chỗ người ta
    // hay nhét thêm cấu hình về sau, và danh sách trắng trong `getPublic()` là
    // thứ duy nhất đứng giữa một khoá API và một endpoint không cần đăng nhập.
    await settings.update({
      site_name: 'Zoldify',
      maintenance_mode: 'false',
      // Ba khoá dưới đây KHÔNG nằm trong danh sách trắng.
      payos_checksum_key: 'bi-mat-khong-duoc-lo',
      smtp_password: 'cung-khong-duoc-lo',
      commission_rate: '0.05',
    });

    const cong_khai = await settings.getPublic();

    expect(Object.keys(cong_khai).sort()).toEqual([
      'maintenance_mode',
      'site_name',
    ]);
    expect(JSON.stringify(cong_khai)).not.toContain('bi-mat-khong-duoc-lo');
    expect(JSON.stringify(cong_khai)).not.toContain('cung-khong-duoc-lo');
  });

  it('trả đủ bốn khoá công khai khi có đủ', async () => {
    await settings.update({
      site_name: 'Zoldify',
      site_description: 'Sàn C2C',
      contact_email: 'hello@zoldify.com',
      maintenance_mode: 'true',
    });

    const cong_khai = await settings.getPublic();
    expect(cong_khai).toEqual({
      site_name: 'Zoldify',
      site_description: 'Sàn C2C',
      contact_email: 'hello@zoldify.com',
      maintenance_mode: 'true',
    });
  });

  it('update là upsert: gọi hai lần không tạo dòng trùng', async () => {
    // `update()` đọc rồi mới ghi. Nếu nó `save()` thẳng một entity mới thì lần
    // gọi thứ hai sinh dòng thứ hai cùng `key`, và `getValue()` sau đó trả về
    // cái nào là tuỳ thứ tự MySQL — tức cấu hình đổi ngẫu nhiên giữa hai lần
    // đọc mà không ai sửa gì.
    await settings.update({ site_name: 'Ten cu' });
    await settings.update({ site_name: 'Ten moi' });

    const tatCa = await settings.findAll();
    expect(tatCa.filter((s) => s.key === 'site_name')).toHaveLength(1);
    expect(await settings.getValue('site_name')).toBe('Ten moi');
  });

  it('getValue trả null cho khoá không tồn tại', async () => {
    // Trả `null` chứ không ném: `MaintenanceGuard` gọi hàm này ở MỌI request,
    // nên ném lỗi ở đây là chặn cả site vì một khoá chưa ai tạo.
    expect(await settings.getValue('khoa_khong_co_that')).toBeNull();
  });
});
