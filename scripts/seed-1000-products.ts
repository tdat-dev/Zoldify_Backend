import { DataSource } from 'typeorm';
import { config } from 'dotenv';
config();

async function seed1000FoodProducts() {
  const ds = new DataSource({
    type: 'mysql',
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    username: process.env.DB_USERNAME || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_DATABASE || 'zoldify',
    synchronize: false,
  });

  await ds.initialize();
  console.log('🔌 Đã kết nối Database thành công');

  const queryRunner = ds.createQueryRunner();
  await queryRunner.startTransaction();

  try {
    const q = (sql: string, p?: any[]) => queryRunner.query(sql, p);

    const [seller] = await q(`SELECT id FROM users WHERE role = 'seller' LIMIT 1`);
    if (!seller) {
      throw new Error("❌ Không tìm thấy người bán nào (seller). Vui lòng chạy 'npm run seed' trước.");
    }

    // Lấy danh mục 'nau-an'
    let [category] = await q(`SELECT id FROM categories WHERE slug = 'nau-an'`);
    if (!category) {
      [category] = await q(`SELECT id FROM categories LIMIT 1`);
    }

    let productsInserted = 0;
    console.log('🚀 Bắt đầu tạo 1000 sản phẩm với tên "Đồ ăn"...');

    const CHUNK = 100;
    for (let i = 0; i < 1000; i += CHUNK) {
      const chunkCount = Math.min(CHUNK, 1000 - i);
      const rows: any[] = [];
      
      for (let j = 1; j <= chunkCount; j++) {
        const index = i + j;
        const name = `Đồ ăn ngon - Món số ${index}`;
        const slug = `do-an-ngon-mon-so-${index}-${Date.now()}`;
        const price = 20000 + Math.floor(Math.random() * 200000);
        const image = 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=500&h=500&fit=crop';
        const description = `Đây là đồ ăn siêu ngon số ${index}. Hương vị tuyệt hảo, phù hợp cho mọi gia đình. Đồ ăn chính hãng.`;
        
        rows.push([
           name,
           slug,
           price,
           'VND',
           100, // stock
           image,
           description,
           'ZoldifyFood', // brand
           category.id,
           seller.id,
           'active',
           'new' // condition
        ]);
      }
      
      const placeholders = rows.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
      
      await q(
        `INSERT INTO products (name, slug, price, currency, stock, image, description, brand, category_id, seller_id, status, \`condition\`) VALUES ${placeholders}`,
        rows.flat()
      );
      
      productsInserted += chunkCount;
      console.log(`✅ Đã chèn ${productsInserted}/1000 sản phẩm "Đồ ăn"...`);
    }

    await queryRunner.commitTransaction();
    console.log('🎉 Hoàn thành chèn 1000 sản phẩm Đồ ăn! Hãy vào web và search "Đồ ăn" nhé!');
  } catch (err) {
    await queryRunner.rollbackTransaction();
    console.error('❌ Lỗi khi seed dữ liệu:', err);
  } finally {
    await queryRunner.release();
    await ds.destroy();
  }
}

seed1000FoodProducts();
