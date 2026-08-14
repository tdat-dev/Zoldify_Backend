import { DataSource } from 'typeorm';
import { hashSync } from 'bcrypt';
import { config } from 'dotenv';
import { Setting } from './settings/entities/setting.entity';
config();

const U = 'https://images.unsplash.com/';
const O = '?w=400&h=300&fit=crop';

async function seed() {
  const ds = new DataSource({
    type: 'mysql',
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    username: process.env.DB_USERNAME || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_DATABASE || 'zoldify',
    entities: [__dirname + '/**/*.entity{.ts,.js}'],
    synchronize: false,
  });

  await ds.initialize();
  console.log('DB connected');

  const queryRunner = ds.createQueryRunner();
  await queryRunner.startTransaction();

  try {
    // ─── 1. Seed seller & admin ───
    const hashedPw = hashSync('123456', 10);
    await queryRunner.query(
      `INSERT IGNORE INTO users (full_name, email, password, role) VALUES (?, ?, ?, ?)`,
      ['Shop Zoldify', 'seller@zoldify.com', hashedPw, 'seller'],
    );
    await queryRunner.query(
      `INSERT IGNORE INTO users (full_name, email, password, role) VALUES (?, ?, ?, ?)`,
      ['Admin Zoldify', 'admin@zoldify.com', hashedPw, 'admin'],
    );
    const [seller] = await queryRunner.query(`SELECT id FROM users WHERE email = ?`, ['seller@zoldify.com']);

    // ─── Cleanup: delete products without images ───
    const cleanup = await queryRunner.query(`DELETE FROM products WHERE image IS NULL OR image = '' OR image = 'undefined'`);
    if (cleanup.affectedRows > 0) console.log(`   - Cleaned up ${cleanup.affectedRows} products without images`);

    // ─── 2. Seed categories ───
    const categories = [
      { name: 'Điện thoại', slug: 'dien-thoai', image: U + 'photo-1511707171634-5f897ff02aa9' + O },
      { name: 'Laptop', slug: 'laptop', image: U + 'photo-1496181133206-80ce9b88a853' + O },
      { name: 'Tai nghe', slug: 'tai-nghe', image: U + 'photo-1505740420928-5e560c06d30e' + O },
      { name: 'Đồng hồ', slug: 'dong-ho', image: U + 'photo-1524592094714-0f0654e20314' + O },
      { name: 'Máy tính bảng', slug: 'may-tinh-bang', image: U + 'photo-1544244015-0df4b3ffc6b0' + O },
      { name: 'Phụ kiện', slug: 'phu-kien', image: U + 'photo-1583394838336-acd977736f90' + O },
      { name: 'Quần áo', slug: 'quan-ao', image: U + 'photo-1542272604-787c3835535d' + O },
      { name: 'Thể thao', slug: 'the-thao', image: U + 'photo-1542291026-7eec264c27ff' + O },
      { name: 'Nấu ăn', slug: 'nau-an', image: U + 'photo-1556909114-f6e7ad7d3136' + O },
    ];

    const catIds: number[] = [];
    for (const c of categories) {
      await queryRunner.query(
        `INSERT IGNORE INTO categories (name, slug, image, is_active) VALUES (?, ?, ?, 1)`,
        [c.name, c.slug, c.image],
      );
      const [row] = await queryRunner.query(`SELECT id FROM categories WHERE slug = ?`, [c.slug]);
      catIds.push(row.id);
    }

    // ─── 3. Seed products ───
    const products = [
      {
        name: 'iPhone 16 Pro Max 256GB',
        slug: 'iphone-16-pro-max-256gb',
        price: 34990000,
        stock: 15,
        image: U + 'photo-1592750475338-74b7b21085ab' + O,
        description: 'iPhone 16 Pro Max chip A18 Pro, camera 48MP, màn hình OLED 6.9 inch, pin siêu trâu.',
        brand: 'Apple',
        category: 'dien-thoai',
      },
      {
        name: 'Samsung Galaxy S25 Ultra',
        slug: 'samsung-galaxy-s25-ultra',
        price: 29990000,
        stock: 20,
        image: U + 'photo-1610945415295-d9bbf067e59c' + O,
        description: 'Galaxy S25 Ultra chip Snapdragon 8 Elite, camera 200MP, bút S-Pen tích hợp.',
        brand: 'Samsung',
        category: 'dien-thoai',
      },
      {
        name: 'Xiaomi 14T Pro',
        slug: 'xiaomi-14t-pro',
        price: 12990000,
        stock: 25,
        image: U + 'photo-1565849904461-04a58ad377e0' + O,
        description: 'Xiaomi 14T Pro chip Dimensity 9300+, camera Leica 50MP, sạc 120W.',
        brand: 'Xiaomi',
        category: 'dien-thoai',
      },
      {
        name: 'MacBook Pro 14 M4 Pro',
        slug: 'macbook-pro-14-m4-pro',
        price: 45990000,
        stock: 10,
        image: U + 'photo-1517336714731-489689fd1ca8' + O,
        description: 'MacBook Pro 14 inch chip M4 Pro, RAM 24GB, SSD 512GB, màn hình Liquid Retina XDR.',
        brand: 'Apple',
        category: 'laptop',
      },
      {
        name: 'Dell XPS 16 9640',
        slug: 'dell-xps-16-9640',
        price: 38990000,
        stock: 8,
        image: U + 'photo-1496181133206-80ce9b88a853' + O,
        description: 'Dell XPS 16 chip Intel Core Ultra 9, RAM 32GB, SSD 1TB, màn hình OLED 4K.',
        brand: 'Dell',
        category: 'laptop',
      },
      {
        name: 'AirPods Pro 2 USB-C',
        slug: 'airpods-pro-2-usb-c',
        price: 5990000,
        stock: 30,
        image: U + 'photo-1606220588913-b3aacb4d2f46' + O,
        description: 'AirPods Pro 2 chip H2, chống ồn chủ động, âm thanh không gian, sạc USB-C.',
        brand: 'Apple',
        category: 'tai-nghe',
      },
      {
        name: 'Samsung Galaxy Watch 7',
        slug: 'samsung-galaxy-watch-7',
        price: 7990000,
        stock: 18,
        image: U + 'photo-1579586337278-3befd40fd17a' + O,
        description: 'Galaxy Watch 7 chip Exynos W1000, theo dõi sức khỏe toàn diện, chống nước 5ATM.',
        brand: 'Samsung',
        category: 'dong-ho',
      },
      {
        name: 'iPad Air M2 11 inch',
        slug: 'ipad-air-m2-11-inch',
        price: 16990000,
        stock: 12,
        image: U + 'photo-1544244015-0df4b3ffc6b0' + O,
        description: 'iPad Air M2 chip Apple Silicon, màn hình 11 inch Liquid Retina, bút Apple Pencil Pro.',
        brand: 'Apple',
        category: 'may-tinh-bang',
      },
      {
        name: 'Sạc nhanh Anker 65W GaN',
        slug: 'sac-nhanh-anker-65w-gan',
        price: 690000,
        stock: 50,
        image: U + 'photo-1583394838336-acd977736f90' + O,
        description: 'Củ sạc Anker 65W GaN công nghệ GaN III, 2 cổng USB-C, sạc nhanh cho laptop & điện thoại.',
        brand: 'Anker',
        category: 'phu-kien',
      },
      {
        name: 'Áo Polo Nam Cotton Cao Cấp',
        slug: 'ao-polo-nam-cotton',
        price: 250000,
        stock: 100,
        image: U + 'photo-1581655353564-df123a1eb820' + O,
        description: 'Áo Polo nam chất liệu cotton cao cấp, form regular fit, thoáng mát.',
        brand: 'Uniqlo',
        category: 'quan-ao',
      },
      {
        name: 'Quần Jeans Nữ Slim Fit',
        slug: 'quan-jeans-nu-slim-fit',
        price: 350000,
        stock: 80,
        image: U + 'photo-1542272604-787c3835535d' + O,
        description: 'Quần jeans nữ form slim fit, chất liệu co giãn thoải mái.',
        brand: 'Canifa',
        category: 'quan-ao',
      },
      {
        name: 'Giày Nike Air Max 270',
        slug: 'giay-nike-air-max-270',
        price: 3200000,
        stock: 25,
        image: U + 'photo-1542291026-7eec264c27ff' + O,
        description: 'Giày Nike Air Max 270, đệm khí Max Air, thoải mái khi chạy bộ.',
        brand: 'Nike',
        category: 'the-thao',
      },
      {
        name: 'Bóng đá Adidas Size 5',
        slug: 'bong-da-adidas-size-5',
        price: 450000,
        stock: 40,
        image: U + 'photo-1431324155629-1a6deb1dec8d' + O,
        description: 'Bóng đá Adidas size 5, da PU cao cấp, thi đấu chính thức.',
        brand: 'Adidas',
        category: 'the-thao',
      },
      {
        name: 'Nồi chiên không dầu Philips HD9270',
        slug: 'noi-chien-khong-dau-philips-hd9270',
        price: 2490000,
        stock: 35,
        image: U + 'photo-1585515320310-259814833e62' + O,
        description: 'Nồi chiên không dầu Philips HD9270, dung tích 7L, Rapid Air Technology.',
        brand: 'Philips',
        category: 'nau-an',
      },
      {
        name: 'Bếp từ Panasonic KZ-AX32',
        slug: 'bep-tu-panasonic-kz-ax32',
        price: 1890000,
        stock: 20,
        image: U + 'photo-1556909114-f6e7ad7d3136' + O,
        description: 'Bếp từ Panasonic, công suất 2000W, 5 mức nhiệt, mặt kính Ceramic.',
        brand: 'Panasonic',
        category: 'nau-an',
      },
    ];

    for (const p of products) {
      const catIdx = categories.findIndex(c => c.slug === p.category);
      await queryRunner.query(
        `INSERT IGNORE INTO products (name, slug, price, stock, image, description, brand, category_id, seller_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
        [p.name, p.slug, p.price, p.stock, p.image, p.description, p.brand, catIds[catIdx], seller.id,],
      );
    }

    await queryRunner.commitTransaction();
    console.log('✅ Seed completed successfully!');
    console.log(`   - 1 admin: admin@zoldify.com / 123456`);
    console.log(`   - 1 seller: seller@zoldify.com / 123456`);
    console.log(`   - ${categories.length} categories`);
    console.log(`   - ${products.length} products (with images)`);
  } catch (err) {
    await queryRunner.rollbackTransaction();
    console.error('❌ Seed failed:', err);
  } finally {
    await queryRunner.release();
    await ds.destroy();
  }
}

seed();
