/**
 * Dựng một kho hàng DEMO đủ dày để thử giao diện ở quy mô thật.
 *
 * VÌ SAO CẦN: seed.ts chỉ tạo 15 món cho 9 danh mục — bốn danh mục có đúng MỘT
 * sản phẩm. Ở quy mô đó không thứ gì kiểm chứng được: trang chủ vẽ 26 ô từ 16
 * món (tức đã lặp), phân trang chưa bao giờ sang trang 2, bộ lọc giá luôn trả
 * về gần như cùng một tập, và không lỗi hiệu năng nào lộ ra.
 *
 *   npm run seed:demo                # xem trước, KHÔNG ghi
 *   npm run seed:demo -- --write     # ghi thật
 *   npm run seed:demo -- --clear     # xoá sạch hàng demo, trả DB về như cũ
 *   npm run seed:demo -- --write --per=40
 *
 * ẢNH KHÔNG VÀO GIT. Chúng tải về public/media/demo/ (đã cho vào .gitignore) và
 * script tự tải lại nếu thiếu. Lý do: đây là ảnh kho lấy từ nguồn ngoài cho dữ
 * liệu giả — commit 360 tấm ảnh chưa rà bản quyền vào repo của một sàn thương
 * mại là rước rủi ro pháp lý về để đổi lấy một trang chủ trông đầy hơn.
 *
 * XOÁ LẠI ĐƯỢC: mọi hàng demo đều có slug bắt đầu bằng DEMO_PREFIX. Đó là dấu
 * duy nhất phân biệt hàng giả với hàng thật, nên --clear chỉ đụng đúng chúng.
 * PHẢI XOÁ TRƯỚC KHI CHẠY THẬT.
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import dataSource from '../src/data-source';

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const CLEAR = args.includes('--clear');
/**
 * Chỉ tải ảnh còn thiếu, KHÔNG đụng vào DB. Có cờ này vì nguồn ảnh chặn tốc độ:
 * lần seed đầu tám ảnh trả 403, và nếu muốn tải lại mà phải chạy nguyên lệnh
 * seed thì sẽ chèn thêm 360 sản phẩm nữa.
 */
const IMAGES_ONLY = args.includes('--images-only');
const PER =
  Number(args.find((a) => a.startsWith('--per='))?.split('=')[1]) || 40;

/** Dấu nhận biết hàng demo. Đổi chuỗi này là --clear không tìm thấy hàng cũ nữa. */
const DEMO_PREFIX = 'demo-';

const MEDIA_DIR = path.resolve(
  __dirname,
  '..',
  '..',
  'Zoldify_Frontend',
  'public',
  'media',
  'demo',
);
/** Số ảnh mỗi danh mục. Sản phẩm xoay vòng trên bộ này. */
const IMAGES_PER_CATEGORY = 8;

/**
 * Mỗi danh mục: từ khoá lấy ảnh, và danh sách MÓN CÓ THẬT kèm khoảng giá đồ cũ
 * hợp lý của chính món đó.
 *
 * BẢN TRƯỚC GHÉP CHÉO hãng × dòng máy và cho ra "Xiaomi 13 Pro Max 256GB" —
 * một cái tên không tồn tại. Nó cũng rải giá theo tầm, nên hiện ra
 * "iPhone 13 Pro Max — 86.000đ". Dữ liệu giả mà vô lý thì tệ hơn dữ liệu ít:
 * nhìn phát biết là bịa, và mọi ảnh chụp màn hình đều mất giá trị.
 *
 * Nên: mỗi món là một cái tên đầy đủ, đi kèm khoảng giá của riêng nó. Biến thể
 * chỉ thêm dung lượng/màu/size — thứ không làm sai tên món.
 *
 * BỐN TẦM GIÁ CỦA TRANG CHỦ tự đầy nhờ trải rộng giữa các danh mục: phụ kiện và
 * quần áo nuôi tầm dưới 100k, điện thoại và laptop nuôi tầm trên 1 triệu. Không
 * cần ép mỗi danh mục phải có đủ bốn tầm — ép thế mới là bịa.
 */
type Item = [name: string, minPrice: number, maxPrice: number];

const CATALOG: Record<
  string,
  { keyword: string; items: Item[]; variants: string[] }
> = {
  'dien-thoai': {
    keyword: 'smartphone',
    items: [
      ['iPhone 11', 3_200_000, 5_400_000],
      ['iPhone 13 Pro Max', 11_500_000, 16_900_000],
      ['iPhone 15', 14_000_000, 19_500_000],
      ['Samsung Galaxy S23 Ultra', 12_000_000, 17_500_000],
      ['Samsung Galaxy A55 5G', 5_500_000, 7_900_000],
      ['Xiaomi 14T Pro', 8_900_000, 12_500_000],
      ['Xiaomi Redmi Note 13', 2_900_000, 4_500_000],
      ['OPPO Reno 11', 5_800_000, 8_200_000],
      ['vivo V29', 5_200_000, 7_600_000],
      ['Google Pixel 8a', 7_500_000, 10_500_000],
    ],
    variants: [
      '128GB',
      '256GB',
      '512GB',
      'bản quốc tế',
      'màu đen',
      'còn bảo hành',
    ],
  },
  laptop: {
    keyword: 'laptop',
    items: [
      ['MacBook Air M2 13"', 15_500_000, 21_000_000],
      ['MacBook Pro 14" M3', 28_000_000, 38_000_000],
      ['Dell XPS 15 9530', 19_000_000, 27_000_000],
      ['Lenovo ThinkPad X1 Carbon Gen 11', 17_500_000, 24_000_000],
      ['ASUS Zenbook 14 OLED', 13_500_000, 18_500_000],
      ['HP Envy x360', 12_000_000, 16_500_000],
      ['Acer Swift Go 14', 9_500_000, 13_500_000],
      ['LG gram 16', 16_000_000, 22_000_000],
    ],
    variants: [
      '16GB/512GB',
      '8GB/256GB',
      '32GB/1TB',
      'kèm sạc zin',
      'pin còn 90%',
    ],
  },
  'tai-nghe': {
    keyword: 'headphones',
    items: [
      ['Sony WH-1000XM4', 3_200_000, 4_800_000],
      ['AirPods Pro 2 USB-C', 3_500_000, 5_200_000],
      ['AirPods 3', 2_200_000, 3_400_000],
      ['Sennheiser Momentum 4', 4_500_000, 6_500_000],
      ['JBL Tune 770NC', 1_300_000, 2_100_000],
      ['Bose QuietComfort 45', 4_000_000, 5_800_000],
      ['Audio-Technica ATH-M50x', 2_400_000, 3_500_000],
      ['Marshall Major IV', 1_900_000, 2_900_000],
    ],
    variants: ['đủ hộp', 'màu đen', 'màu trắng', 'kèm dây zin', 'còn bảo hành'],
  },
  'dong-ho': {
    keyword: 'wristwatch',
    items: [
      ['Casio G-Shock GA-2100', 1_600_000, 2_600_000],
      ['Casio MTP-1374', 750_000, 1_200_000],
      ['Seiko 5 Sports SRPD', 3_600_000, 5_400_000],
      ['Apple Watch Series 8 45mm', 5_500_000, 8_200_000],
      ['Apple Watch SE 2', 3_800_000, 5_600_000],
      ['Garmin Forerunner 255', 5_200_000, 7_500_000],
      ['Orient Bambino V4', 3_100_000, 4_600_000],
      ['Citizen Eco-Drive', 4_200_000, 6_400_000],
    ],
    variants: [
      'dây thép',
      'dây da',
      'size 41mm',
      'đủ hộp sổ',
      'mặt không xước',
    ],
  },
  'may-tinh-bang': {
    keyword: 'tablet',
    items: [
      ['iPad Gen 9 64GB', 4_800_000, 6_800_000],
      ['iPad Air M1 10.9"', 9_500_000, 13_500_000],
      ['iPad Pro 11" M2', 15_000_000, 21_000_000],
      ['Samsung Galaxy Tab S9 FE', 8_200_000, 11_500_000],
      ['Xiaomi Pad 6', 5_500_000, 7_800_000],
      ['Lenovo Tab P12 Pro', 6_800_000, 9_500_000],
      ['Huawei MatePad 11.5"', 5_900_000, 8_400_000],
    ],
    variants: ['bản WiFi', 'bản 4G', '64GB', '128GB', 'kèm bao da'],
  },
  'phu-kien': {
    keyword: 'gadget',
    items: [
      ['Cáp sạc Ugreen USB-C 1m', 45_000, 95_000],
      ['Sạc Anker GaN 65W', 350_000, 620_000],
      ['Pin dự phòng Anker 20.000mAh', 550_000, 950_000],
      ['Hub Ugreen USB-C 7 in 1', 380_000, 720_000],
      ['Chuột Logitech MX Master 3S', 1_600_000, 2_400_000],
      ['Bàn phím Keychron K2 Pro', 1_800_000, 2_800_000],
      ['Giá đỡ laptop nhôm', 120_000, 280_000],
      ['Túi chống sốc 14"', 85_000, 190_000],
      ['Bao da iPad', 90_000, 240_000],
      ['Dán màn hình cường lực', 35_000, 80_000],
    ],
    variants: [
      'màu đen',
      'màu trắng',
      'còn nguyên hộp',
      'dùng vài lần',
      'hàng chính hãng',
    ],
  },
  'quan-ao': {
    keyword: 'clothing',
    items: [
      ['Áo thun cotton Coolmate', 65_000, 140_000],
      ['Áo sơ mi linen Routine', 150_000, 320_000],
      ['Áo khoác dù nam Uniqlo', 280_000, 550_000],
      ['Áo hoodie nỉ bông', 180_000, 380_000],
      ['Quần jeans Levi’s 511', 320_000, 680_000],
      ['Quần short kaki', 95_000, 210_000],
      ['Chân váy midi Zara', 190_000, 420_000],
      ['Áo len cổ tròn H&M', 140_000, 300_000],
    ],
    variants: ['size S', 'size M', 'size L', 'size XL', 'mặc 2 lần', 'còn tag'],
  },
  'the-thao': {
    // Một TỪ, không dấu cách: 'sports equipment' bị nguồn ảnh trả 403 và cả
    // tám ảnh của danh mục này hỏng, trong khi các danh mục một từ đều tải được.
    keyword: 'sneakers',
    items: [
      ['Giày chạy Nike Pegasus 40', 1_450_000, 2_400_000],
      ['Giày Adidas Ultraboost', 1_800_000, 3_100_000],
      ['Bóng đá Adidas size 5', 180_000, 380_000],
      ['Thảm yoga 8mm', 150_000, 320_000],
      ['Vợt cầu lông Yonex Astrox', 850_000, 1_650_000],
      ['Tạ tay bọc cao su 5kg', 190_000, 360_000],
      ['Dây nhảy thể dục', 45_000, 95_000],
      ['Xe đạp thể thao Giant', 3_500_000, 6_800_000],
    ],
    variants: ['size 41', 'size 42', 'size 43', 'dùng vài buổi', 'còn mới 95%'],
  },
  'nau-an': {
    keyword: 'kitchen',
    items: [
      ['Nồi chiên không dầu Philips 6.2L', 1_500_000, 2_600_000],
      ['Bếp từ đơn Panasonic', 850_000, 1_600_000],
      ['Nồi cơm điện Sunhouse 1.8L', 420_000, 780_000],
      ['Chảo chống dính Elmich 28cm', 180_000, 380_000],
      ['Bộ hộp thuỷ tinh Lock&Lock', 150_000, 340_000],
      ['Máy xay sinh tố Bear', 320_000, 620_000],
      ['Ấm siêu tốc 1.7L', 160_000, 330_000],
      ['Dao bếp thép không gỉ', 75_000, 180_000],
    ],
    variants: [
      'còn hộp',
      'dùng vài lần',
      'đủ phụ kiện',
      'màu trắng',
      'màu đen',
    ],
  },
};

const CONDITIONS = ['new', 'like_new', 'good', 'fair'];

/**
 * Giá đi theo TỪNG MÓN, không rải theo tầm. Bốn thẻ tầm tiền trên trang chủ tự
 * đầy vì các danh mục trải rộng: dán màn hình 35k nuôi tầm dưới 100k, MacBook
 * 38 triệu nuôi tầm trên 1 triệu. Ép mỗi danh mục phải có đủ bốn tầm là cách
 * sinh ra "iPhone 13 Pro Max giá 86.000đ".
 */

function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Số giả ngẫu nhiên nhưng TẤT ĐỊNH: chạy lại cho ra đúng bộ dữ liệu cũ. */
function rand(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

async function downloadImages(slugs: string[]) {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  let fetched = 0;
  let already = 0;
  for (const slug of slugs) {
    const kw = CATALOG[slug]?.keyword;
    if (!kw) continue;
    for (let i = 1; i <= IMAGES_PER_CATEGORY; i++) {
      const file = path.join(MEDIA_DIR, `${slug}-${i}.jpg`);
      if (fs.existsSync(file)) {
        already++;
        continue;
      }
      // lock: cùng một số thì luôn ra cùng một tấm ảnh.
      const url = `https://loremflickr.com/400/400/${encodeURIComponent(kw)}?lock=${i}`;
      try {
        const res = await fetch(url, { redirect: 'follow' });
        if (!res.ok) {
          console.log(`  ảnh hỏng ${slug}-${i}: HTTP ${res.status}`);
          continue;
        }
        fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
        fetched++;
      } catch (e: any) {
        console.log(`  ảnh hỏng ${slug}-${i}: ${e.message}`);
      }
    }
  }
  console.log(`Ảnh: ${fetched} tải mới, ${already} đã có sẵn → ${MEDIA_DIR}`);
}

async function main() {
  if (IMAGES_ONLY) {
    await downloadImages(Object.keys(CATALOG));
    return;
  }

  await dataSource.initialize();
  const q = (sql: string, p?: any[]) => dataSource.query(sql, p);

  if (CLEAR) {
    const [{ n }] = await q(
      `SELECT COUNT(*) AS n FROM products WHERE slug LIKE ?`,
      [`${DEMO_PREFIX}%`],
    );
    console.log(`Tìm thấy ${n} sản phẩm demo.`);
    if (!WRITE) {
      console.log('Xem trước. Thêm --write để xoá thật.');
    } else {
      await q(`DELETE FROM products WHERE slug LIKE ?`, [`${DEMO_PREFIX}%`]);
      console.log(`Đã xoá ${n} sản phẩm demo.`);
    }
    await dataSource.destroy();
    return;
  }

  const cats: Array<{ id: number; slug: string; name: string }> = await q(
    `SELECT id, slug, name FROM categories WHERE is_active = 1`,
  );
  const [seller] = await q(
    `SELECT id FROM users WHERE role = 'seller' ORDER BY id LIMIT 1`,
  );
  if (!seller)
    throw new Error('Chưa có người bán nào. Chạy `npm run seed` trước.');

  const known = cats.filter((c) => CATALOG[c.slug]);
  const unknown = cats.filter((c) => !CATALOG[c.slug]);
  if (unknown.length) {
    console.log(
      `Bỏ qua ${unknown.length} danh mục chưa có mẫu tên: ` +
        unknown.map((c) => c.slug).join(', '),
    );
  }

  if (WRITE) await downloadImages(known.map((c) => c.slug));

  const rows: any[][] = [];
  for (const cat of known) {
    const { items, variants } = CATALOG[cat.slug];
    for (let i = 0; i < PER; i++) {
      const seed = cat.id * 1000 + i;
      // Món chạy vòng ngoài, biến thể vòng trong: cùng một món xuất hiện lại
      // với dung lượng/size khác, đúng như một sàn đồ cũ thật.
      const [base, minPrice, maxPrice] = items[i % items.length];
      const variant = variants[Math.floor(i / items.length) % variants.length];
      const name = `${base} ${variant}`;
      // i vào slug để tên trùng nhau vẫn ra slug khác — cột slug là UNIQUE.
      const slug = `${DEMO_PREFIX}${slugify(`${cat.slug}-${name}-${i}`)}`;
      // Giá nằm trong khoảng của CHÍNH MÓN ĐÓ, làm tròn nghìn.
      const price =
        Math.round((minPrice + rand(seed) * (maxPrice - minPrice)) / 1000) *
        1000;
      const condition =
        CONDITIONS[Math.floor(rand(seed + 7) * CONDITIONS.length)];
      // Hãng = từ đầu tiên của tên món, đủ dùng cho bộ lọc thương hiệu.
      const brand = base.split(' ')[0];
      const image = `/media/demo/${cat.slug}-${(i % IMAGES_PER_CATEGORY) + 1}.jpg`;
      rows.push([
        name,
        slug,
        `Hàng demo để thử giao diện. ${name}, tình trạng ${condition}.`,
        price,
        'VND',
        1,
        image,
        brand,
        condition,
        rand(seed + 3) > 0.7 ? 1 : 0,
        Math.floor(rand(seed + 11) * 40),
        Math.floor(rand(seed + 13) * 900),
        'active',
        cat.id,
        seller.id,
      ]);
    }
  }

  console.log(
    `\n${known.length} danh mục × ${PER} = ${rows.length} sản phẩm demo`,
  );
  console.log('Ví dụ ba món đầu:');
  rows
    .slice(0, 3)
    .forEach((r) =>
      console.log(
        `  ${String(r[0]).padEnd(34)} ${Number(r[3]).toLocaleString('vi-VN')}đ  ${r[8]}  ${r[6]}`,
      ),
    );

  if (!WRITE) {
    console.log('\nĐây mới là XEM TRƯỚC. Thêm -- --write để ghi thật.');
    await dataSource.destroy();
    return;
  }

  // Chèn theo lô: 360 câu INSERT riêng lẻ là 360 vòng đi-về tới MySQL.
  const CHUNK = 60;
  let done = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const placeholders = chunk
      .map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .join(',');
    await q(
      `INSERT INTO products
       (name, slug, description, price, currency, stock, image, brand, \`condition\`,
        is_freeship, sold_count, view_count, status, category_id, seller_id)
       VALUES ${placeholders}`,
      chunk.flat(),
    );
    done += chunk.length;
  }
  console.log(`\nĐã chèn ${done} sản phẩm demo.`);
  console.log(`Xoá lại bằng: npm run seed:demo -- --clear --write`);

  await dataSource.destroy();
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
