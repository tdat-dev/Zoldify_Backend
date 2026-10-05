/**
 * BỘ TỰ KIỂM CACHE — cổng chất lượng cho Epic 4 (cache đọc-nhiều).
 *
 * Không tin lời, chỉ tin số. File này biến 3 rủi ro pre-mortem thành PASS/FAIL:
 *   C1/C4  — KHÔNG stale: update sản phẩm → cache phải bị xoá → đọc lại ra dữ liệu MỚI.
 *   hit==DB (+C7) — đọc từ cache KHỚP HỆT đọc thẳng DB, kể cả field Date/Decimal.
 *   C3     — fail-open: cache chết (ném lỗi) → API vẫn trả DB, KHÔNG throw.
 *
 * Cách kiểm "thật sự cache" (không đoán): đếm số lần ProductsService gọi xuống DB
 * (productRepository.findOne). Lần 1 phải xuống DB; lần 2 CÙNG id phải = 0 (lấy từ
 * cache). Nếu chưa gắn cache → lần 2 vẫn xuống DB → test ĐỎ (đúng như phải thế).
 *
 * KHÔNG cần bật server, KHÔNG cần Redis: dựng cache in-memory (cache-manager) và
 * gọi thẳng ProductsService như production dùng. Test-2 có sửa 1 tên sản phẩm rồi
 * HOÀN NGUYÊN trong finally (không để lại thay đổi).
 *
 * Chạy:
 *   node -r ts-node/register -r tsconfig-paths/register scripts/selfcheck-cache.ts
 * Thoát mã 0 nếu tất cả PASS, 1 nếu có FAIL.
 */
import { createCache } from 'cache-manager';
import AppDataSource from '../src/data-source';
import { ProductsService } from '../src/catalog/products/products.service';
import { Product } from '../src/catalog/products/entities/product.entity';
import { Follow } from '../src/catalog/follows/entities/follow.entity';
import { Shop } from '../src/catalog/shop/entities/shop.entity';

let failures = 0;
const ok = (msg: string) => console.log(`  \x1b[32m✓ PASS\x1b[0m  ${msg}`);
const bad = (msg: string) => {
  failures++;
  console.log(`  \x1b[31m✗ FAIL\x1b[0m  ${msg}`);
};
const head = (msg: string) => console.log(`\n\x1b[1m${msg}\x1b[0m`);

// Khoá cache detail — PHẢI khớp key mà ProductsService dùng.
const detailKey = (id: number) => `product:${id}`;

async function main() {
  console.log('\x1b[1m═══ BỘ TỰ KIỂM ZOLDIFY — Epic 4 (cache) ═══\x1b[0m');
  const ds = await AppDataSource.initialize();
  console.log(`Kết nối DB: ${ds.options.database} @ ${(ds.options as any).host}`);

  const productRepo = ds.getRepository(Product);
  const followRepo = ds.getRepository(Follow);
  const shopRepo = ds.getRepository(Shop);

  // Đếm số lần gọi DB THẬT: bọc productRepository.findOne, đếm rồi ủy quyền.
  let dbFindOneCalls = 0;
  const origFindOne = productRepo.findOne.bind(productRepo);
  (productRepo as any).findOne = (...args: any[]) => {
    dbFindOneCalls++;
    return (origFindOne as any)(...args);
  };

  // Cache in-memory thật (giống nhánh dev của env-bridge khi không có REDIS_URL).
  const cache = createCache({ ttl: 60000 });
  const notificationsStub = {} as any;
  const service = new ProductsService(
    productRepo,
    followRepo,
    shopRepo,
    notificationsStub,
    cache as any,
  );

  try {
    // Lấy 1 sản phẩm có thật để thử (query trực tiếp, không tính vào bộ đếm).
    const [sample] = await productRepo.find({ order: { id: 'ASC' }, take: 1 });
    if (!sample) {
      bad('Không có sản phẩm nào trong DB để kiểm — bỏ toàn bộ test.');
      throw new Error('empty products table');
    }
    const id = sample.id as number;
    console.log(`  (dùng product id=${id} để kiểm)`);

    // ── Test 1: hit == DB, và LẦN 2 phải lấy từ cache (không xuống DB) ──────────
    head('C-1 — Đọc lần 2 phục vụ TỪ CACHE (không đập DB) và khớp hệt DB');
    await cache.del(detailKey(id)); // bắt đầu sạch

    dbFindOneCalls = 0;
    const r1 = await service.findOne(id);
    const callsAfter1 = dbFindOneCalls;

    dbFindOneCalls = 0;
    const r2 = await service.findOne(id);
    const callsAfter2 = dbFindOneCalls;

    callsAfter1 >= 1
      ? ok(`lần 1 xuống DB (${callsAfter1} truy vấn) — như mong đợi`)
      : bad(`lần 1 KHÔNG xuống DB (${callsAfter1}) — bất thường`);
    callsAfter2 === 0
      ? ok(`lần 2 phục vụ TỪ CACHE (0 truy vấn DB)`)
      : bad(`lần 2 vẫn xuống DB (${callsAfter2} truy vấn) — CHƯA cache`);

    // hit == DB: so với 1 lần đọc thẳng DB (cùng relations/select như service).
    const fresh = await (origFindOne as any)({
      where: { id },
      relations: { category: true, seller: true },
      select: {
        seller: { id: true, full_name: true, avatar: true, last_seen: true },
        category: { id: true, name: true, slug: true },
      },
    });
    JSON.stringify(r2) === JSON.stringify(fresh)
      ? ok('giá trị từ cache KHỚP HỆT đọc thẳng DB (JSON như client thấy)')
      : bad('giá trị từ cache LỆCH so với DB');

    // C7 — field Date/Decimal còn nguyên qua vòng cache.
    const hasDate = r2 && (r2 as any).created_at != null;
    const hasMoney = r2 && (r2 as any).price != null;
    hasDate && hasMoney
      ? ok(`C7: created_at & price còn nguyên qua cache (price=${(r2 as any).price})`)
      : bad(`C7: mất field Date/Decimal qua cache (created_at=${(r2 as any)?.created_at}, price=${(r2 as any)?.price})`);

    // ── Test 2: KHÔNG stale — update phải xoá cache ────────────────────────────
    head('C-2 — Update sản phẩm → cache bị xoá → đọc lại ra tên MỚI (không stale)');
    const original = await (origFindOne as any)({ where: { id } });
    const oldName = original.name as string;
    const newName = `__CACHE_SELFCHECK__${Date.now()}`;
    const admin = { id: 0, role: 'admin' } as any;
    try {
      await service.findOne(id); // nạp OLD vào cache
      await service.update(id, { name: newName } as any, admin); // phải invalidate
      const after = await service.findOne(id); // phải là NEW
      after && (after as any).name === newName
        ? ok('sau update đọc lại ra tên MỚI — cache đã được xoá đúng')
        : bad(`STALE: sau update vẫn thấy "${(after as any)?.name}" (kỳ vọng "${newName}")`);
    } finally {
      // Hoàn nguyên bằng repo trực tiếp + xoá cache, kể cả khi trên có lỗi.
      await productRepo.update(id, { name: oldName });
      await cache.del(detailKey(id));
    }

    // ── Test 3: fail-open — cache chết vẫn phục vụ từ DB ───────────────────────
    head('C-3 — Cache chết (ném lỗi) → API vẫn trả DB, KHÔNG throw (fail-open)');
    const brokenCache = {
      get: async () => {
        throw new Error('redis down (mô phỏng)');
      },
      set: async () => {
        throw new Error('redis down (mô phỏng)');
      },
      del: async () => {
        throw new Error('redis down (mô phỏng)');
      },
      wrap: async () => {
        throw new Error('redis down (mô phỏng)');
      },
    } as any;
    const svcBroken = new ProductsService(
      productRepo,
      followRepo,
      shopRepo,
      notificationsStub,
      brokenCache,
    );
    try {
      const p = await svcBroken.findOne(id);
      p && (p as any).id === id
        ? ok('findOne vẫn trả đúng DB khi cache chết')
        : bad('findOne trả sai khi cache chết');
    } catch (e: any) {
      bad(`findOne NÉM lỗi khi cache chết — KHÔNG fail-open: ${e?.message}`);
    }
    try {
      const list = await svcBroken.findAll('1', '20', {});
      list && Array.isArray((list as any).result)
        ? ok('findAll vẫn trả đúng DB khi cache chết')
        : bad('findAll trả sai khi cache chết');
    } catch (e: any) {
      bad(`findAll NÉM lỗi khi cache chết — KHÔNG fail-open: ${e?.message}`);
    }
  } finally {
    await ds.destroy();
  }

  head(
    failures === 0
      ? '\x1b[32m═══ KẾT QUẢ: TẤT CẢ PASS ✓ ═══\x1b[0m'
      : `\x1b[31m═══ KẾT QUẢ: ${failures} FAIL ✗ ═══\x1b[0m`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('\x1b[31mLỖI CHẠY SELF-CHECK CACHE:\x1b[0m', e);
  process.exit(2);
});
