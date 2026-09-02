import { DataSource, Logger as TypeOrmLogger } from 'typeorm';
import { SitemapService } from './sitemap.service';
import {
  Product,
  ProductStatus,
} from '@catalog/products/entities/product.entity';
import { Category } from '@catalog/categories/entities/category.entity';
import { Shop } from '@catalog/shop/entities/shop.entity';
import { User } from '@identity/users/entities/user.entity';

/**
 * `sitemap.xml` — bài kiểm viết TRƯỚC.
 *
 * VÌ SAO ROUTE NÀY LÀ CHỖ YẾU NHẤT CỦA CẢ HỆ.
 *
 * Đo thật bằng `npm run loadtest` trên DB có 2.000 sản phẩm:
 *
 *   sitemap.xml   60 rps · p95 1.646ms (100 người) · event loop lag p99 168ms
 *   healthcheck   lúc rảnh 0,45ms → lúc 4 request sitemap chạy: 11,7ms
 *
 * Tức nó **chậm gấp 26 lần MỌI request khác**, kể cả healthcheck rỗng không
 * chạm database. Đây là điều Java không có: ở Tomcat mỗi request một luồng nên
 * một route nặng chỉ tự làm khổ nó. Node chỉ có MỘT luồng JS, và `find()` không
 * `take` nạp cả bảng rồi dựng 2.000 đối tượng + 2.000 chuỗi qua 6 regex mỗi
 * cái — toàn bộ là CPU thuần, không nhả luồng. Mọi người khác xếp hàng.
 *
 * Và `sitemap.xml` là `@Public()`. Ai cũng gọi được.
 *
 * BA ĐIỀU BÀI KIỂM NÀY KHẲNG ĐỊNH, VÀ VÌ SAO ĐO THẾ.
 *
 *   1. Sinh một file con chỉ được đọc TỐI ĐA một lô, không phải cả bảng. Đo
 *      bằng SỐ DÒNG chứ không bằng thời gian — trên database nhỏ thì cách nào
 *      cũng nhanh, đúng cái bẫy `selfcheck-indexes.ts` đã ghi.
 *   2. Truy vấn lấy sản phẩm KHÔNG được dùng OFFSET. Đây không phải chuyện
 *      thẩm mỹ: đã đo bằng EXPLAIN trên chính bảng này — qua trang ~101,
 *      MySQL bỏ hẳn index và quay ra quét toàn bảng + filesort. Chia lô bằng
 *      OFFSET là sửa xong lại hỏng đúng chỗ cũ, chỉ chậm hơn một nhịp.
 *   3. Chia lô KHÔNG được làm mất hay lặp URL nào. Mất là Google không thấy
 *      hàng; lặp là tự báo trùng lặp nội dung.
 *
 * Cộng thêm: định dạng URL sản phẩm phải giữ NGUYÊN `<slug>-p<id>`. Bản trước
 * phát `/product/${slug}` trong khi ứng dụng tra theo id, nên cả 377 URL đều mở
 * ra trang rỗng mà vẫn đáp HTTP 200 — Google gọi đó là soft 404. Sửa hiệu năng
 * mà làm hỏng lại chỗ đó thì lỗ nhiều hơn lãi.
 *
 * Chạy database:  npm run test:db
 */
const TEST_DB = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 3307),
  username: process.env.TEST_DB_USER ?? 'root',
  password: process.env.TEST_DB_PASSWORD ?? 'testpw',
  database: process.env.TEST_DB_NAME ?? 'zoldify_test',
};

jest.setTimeout(90_000);

/** Ghi lại câu lệnh gửi xuống MySQL, để soi hình dạng chứ không chỉ đếm. */
class GhiTruyVan implements TypeOrmLogger {
  public cau: string[] = [];
  logQuery(q: string) {
    if (/^(START TRANSACTION|COMMIT|ROLLBACK|SET |SELECT VERSION)/i.test(q))
      return;
    this.cau.push(q);
  }
  logQueryError() {}
  logQuerySlow() {}
  logSchemaBuild() {}
  logMigration() {}
  log() {}
}

// Lô nhỏ để bài kiểm chạy nhanh. Bản chạy thật dùng KICH_THUOC_LO trong
// sitemap.service.ts; điều bài kiểm khẳng định là CÁCH chia, không phải con số.
const LO = 100;
const SO_HANG = 250; // 250 / 100 = 3 lô, lô cuối lẻ 50 — cố ý cho lẻ

describe('SitemapService — chia lô, không nạp cả bảng', () => {
  let ds: DataSource;
  let svc: SitemapService;
  const ghi = new GhiTruyVan();
  let idHang: number[] = [];

  beforeAll(async () => {
    ds = new DataSource({
      type: 'mysql',
      ...TEST_DB,
      entities: [Product, Category, Shop, User],
      synchronize: true,
      logging: ['query'],
      logger: ghi,
    });
    try {
      await ds.initialize();
    } catch (err) {
      throw new Error(
        `Không kết nối được MySQL cho test tại ${TEST_DB.host}:${TEST_DB.port}. ` +
          `Chạy: npm run test:db\nLỗi gốc: ${(err as Error).message}`,
      );
    }

    await ds.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of ['products', 'shops', 'categories', 'users']) {
      await ds.query(`DELETE FROM ${t}`);
    }
    // AUTO_INCREMENT về 1: bài kiểm chia lô theo KHOẢNG id, nên id phải bắt đầu
    // từ chỗ biết trước thì mới tính được lô nào chứa gì.
    await ds.query('ALTER TABLE products AUTO_INCREMENT = 1');
    await ds.query('SET FOREIGN_KEY_CHECKS = 1');

    await ds.query(
      `INSERT INTO users (full_name, email, password, role)
       VALUES ('nguoi ban','s@t.local','x','seller')`,
    );
    const [u] = await ds.query<Array<{ id: number }>>(
      'SELECT id FROM users ORDER BY id DESC LIMIT 1',
    );
    await ds.query(
      `INSERT INTO categories (name, slug, is_active) VALUES ('do an','do-an',1)`,
    );
    const [c] = await ds.query<Array<{ id: number }>>(
      'SELECT id FROM categories ORDER BY id DESC LIMIT 1',
    );
    await ds.query(
      `INSERT INTO shops (name, slug, status, user_id) VALUES ('shop soi','shop-soi','active',?)`,
      [u.id],
    );

    const hang: string[] = [];
    const tham: unknown[] = [];
    for (let i = 0; i < SO_HANG; i++) {
      hang.push("(?, ?, 1000, 5, ?, ?, 'active')");
      tham.push(`San pham ${i}`, `san-pham-${i}`, u.id, c.id);
    }
    await ds.query(
      `INSERT INTO products (name, slug, price, stock, seller_id, category_id, status)
       VALUES ${hang.join(',')}`,
      tham,
    );
    const rows = await ds.query<Array<{ id: number }>>(
      "SELECT id FROM products WHERE status='active' ORDER BY id",
    );
    idHang = rows.map((r) => Number(r.id));
    expect(idHang).toHaveLength(SO_HANG);

    svc = new SitemapService(
      ds.getRepository(Product),
      ds.getRepository(Category),
      ds.getRepository(Shop),
      LO,
    );
  });

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  it('bảng chỉ mục liệt kê đủ số file con, không thiếu lô nào', async () => {
    const muc = await svc.danhSachFileCon();
    const sanPham = muc.filter((m) => m.loc.includes('sitemap-products-'));
    const tinh = muc.filter((m) => m.loc.includes('sitemap-static'));

    expect(tinh).toHaveLength(1);
    expect(sanPham).toHaveLength(Math.ceil(SO_HANG / LO)); // 250 / 100 = 3
  });

  it('mỗi file con không quá một lô URL', async () => {
    const muc = await svc.danhSachFileCon();
    for (const m of muc.filter((x) => x.loc.includes('sitemap-products-'))) {
      const n = Number(/sitemap-products-(\d+)\.xml/.exec(m.loc)?.[1]);
      const urls = await svc.urlSanPham(n);
      expect(urls.length).toBeGreaterThan(0); // không phát file rỗng
      expect(urls.length).toBeLessThanOrEqual(LO);
    }
  });

  it('gộp các file con lại thì đủ 250 sản phẩm, không thiếu không lặp', async () => {
    const muc = await svc.danhSachFileCon();
    const tatCa: string[] = [];
    for (const m of muc.filter((x) => x.loc.includes('sitemap-products-'))) {
      const n = Number(/sitemap-products-(\d+)\.xml/.exec(m.loc)?.[1]);
      tatCa.push(...(await svc.urlSanPham(n)).map((u) => u.loc));
    }
    expect(tatCa).toHaveLength(SO_HANG);
    expect(new Set(tatCa).size).toBe(SO_HANG); // không lặp

    // Không thiếu: mọi id đang bán phải có mặt.
    for (const id of idHang) {
      expect(tatCa.some((u) => u.endsWith(`-p${id}`))).toBe(true);
    }
  });

  it('sinh MỘT file con chỉ đọc tối đa một lô dòng — không nạp cả bảng', async () => {
    ghi.cau = [];
    const urls = await svc.urlSanPham(0);

    // Đây là phép đo trung tâm. Bản cũ `find()` không `take` sẽ trả 250; bản
    // đúng trả tối đa 100. Đếm DÒNG chứ không đếm mili-giây.
    expect(urls.length).toBeLessThanOrEqual(LO);

    const truyVanHang = ghi.cau.filter((q) => /FROM\s+`?products`?/i.test(q));
    expect(truyVanHang.length).toBeGreaterThan(0);
    for (const q of truyVanHang) {
      // Phải có chặn trên: LIMIT, hoặc khoảng id. Không có gì chặn nghĩa là
      // vẫn nạp cả bảng, chỉ khác chỗ cắt.
      expect(/LIMIT|BETWEEN|>=|<=/i.test(q)).toBe(true);
    }
  });

  it('KHÔNG dùng OFFSET để chia lô', async () => {
    ghi.cau = [];
    await svc.urlSanPham(2); // lô cuối — chỗ OFFSET sẽ lớn nhất nếu dùng OFFSET
    const truyVanHang = ghi.cau.filter((q) => /FROM\s+`?products`?/i.test(q));
    expect(truyVanHang.length).toBeGreaterThan(0);
    for (const q of truyVanHang) {
      // Đã đo bằng EXPLAIN: qua trang ~101, MySQL bỏ index và quét cả bảng.
      // Chia lô bằng OFFSET là dời lỗi đi chứ không sửa.
      expect(q).not.toMatch(/OFFSET/i);
      expect(q).not.toMatch(/LIMIT\s+\d+\s*,\s*\d+/i); // LIMIT n, m cũng là offset
    }
  });

  it('giữ nguyên định dạng URL `<slug>-p<id>` — đừng làm lại lỗi soft 404', async () => {
    const urls = await svc.urlSanPham(0);
    const dau = urls[0].loc;
    expect(dau).toMatch(/\/product\/[a-z0-9-]+-p\d+$/);
    expect(dau).toContain('/product/san-pham-');
  });

  it('file tĩnh có trang chủ, tìm kiếm, danh mục và shop', async () => {
    const urls = await svc.urlTinh();
    const locs = urls.map((u) => u.loc);
    expect(locs.some((l) => l.endsWith('/'))).toBe(true);
    expect(locs.some((l) => l.endsWith('/search'))).toBe(true);
    expect(locs.some((l) => l.includes('/category/'))).toBe(true);
    expect(locs.some((l) => l.includes('/shop/'))).toBe(true);
    // Không được lẫn sản phẩm vào đây — đó là chỗ khiến file tĩnh phình lại.
    expect(locs.some((l) => l.includes('/product/'))).toBe(false);
  });

  it('sản phẩm đã bán thì không lên sitemap', async () => {
    await ds.query('UPDATE products SET status = ? WHERE id = ?', [
      ProductStatus.SOLD,
      idHang[0],
    ]);
    try {
      const urls = await svc.urlSanPham(0);
      expect(urls.some((u) => u.loc.endsWith(`-p${idHang[0]}`))).toBe(false);
    } finally {
      await ds.query('UPDATE products SET status = ? WHERE id = ?', [
        ProductStatus.ACTIVE,
        idHang[0],
      ]);
    }
  });
});
