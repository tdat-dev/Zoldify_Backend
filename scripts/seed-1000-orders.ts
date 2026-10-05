import { DataSource } from 'typeorm';
import { config } from 'dotenv';
config();

async function seed1000Orders() {
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

    // Lấy user đóng vai trò người mua
    const [buyer] = await q(`SELECT id FROM users WHERE role = 'buyer' LIMIT 1`);
    if (!buyer) {
      throw new Error("❌ Không tìm thấy buyer nào. Vui lòng chạy lệnh 'npm run seed:demo' trước.");
    }

    // Lấy danh sách sản phẩm để tạo đơn hàng
    const products = await q(`SELECT id, name, price, image FROM products`);
    if (products.length === 0) {
      throw new Error("❌ Không có sản phẩm nào trong database.");
    }

    let ordersInserted = 0;
    
    // Hàm random ngày trong 1 năm qua
    function getRandomDate() {
      const end = new Date();
      const start = new Date();
      start.setFullYear(start.getFullYear() - 1);
      return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
    }

    const statuses = ['pending', 'processing', 'shipping', 'delivered', 'cancelled'];
    const paymentMethods = ['cod', 'payos'];

    console.log('🚀 Bắt đầu tạo 1000 đơn hàng thật...');

    for (let i = 1; i <= 1000; i++) {
      const orderCode = `ZLD-BULK-${i}-${Date.now().toString().slice(-4)}`;
      
      // Random 1-3 sản phẩm cho mỗi đơn hàng
      const numItems = Math.floor(Math.random() * 3) + 1;
      const orderItems: any[] = [];
      let totalAmount = 0;
      
      for (let j = 0; j < numItems; j++) {
         const p = products[Math.floor(Math.random() * products.length)];
         const qty = Math.floor(Math.random() * 2) + 1; // Số lượng 1-2
         orderItems.push({ ...p, qty });
         totalAmount += Number(p.price) * qty;
      }
      
      const createdAt = getRandomDate();
      
      // Random trạng thái và phương thức thanh toán
      // Tỉ lệ: 70% delivered, 10% pending, 10% processing, 5% shipping, 5% cancelled
      const randStatus = Math.random();
      let status = 'delivered';
      if (randStatus < 0.1) status = 'pending';
      else if (randStatus < 0.2) status = 'processing';
      else if (randStatus < 0.25) status = 'shipping';
      else if (randStatus < 0.3) status = 'cancelled';

      const paymentMethod = paymentMethods[Math.floor(Math.random() * paymentMethods.length)];
      
      // Logic đã thanh toán
      let isPaid = false;
      let paidAt: Date | null = null;
      if (paymentMethod === 'payos' && status !== 'cancelled') {
         isPaid = true;
         paidAt = createdAt;
      } else if (paymentMethod === 'cod' && status === 'delivered') {
         isPaid = true;
         paidAt = new Date(createdAt.getTime() + 3 * 24 * 60 * 60 * 1000); // 3 ngày sau
         if (paidAt > new Date()) paidAt = new Date();
      }

      await q(
        `INSERT INTO orders (order_code, user_id, total_amount, shipping_fee, final_amount,
          status, payment_method, is_paid, paid_at, receiver_name, receiver_phone, shipping_address, created_at, updated_at)
         VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderCode,
          buyer.id,
          totalAmount,
          totalAmount,
          status,
          paymentMethod,
          isPaid ? 1 : 0,
          paidAt,
          'Nguyen Van Mua',
          '0901234567',
          '123 Nguyen Van Cu, Quan 5, TP.HCM',
          createdAt,
          createdAt
        ],
      );
      
      const [row] = await q(`SELECT id FROM orders WHERE order_code = ?`, [orderCode]);
      
      for (const it of orderItems) {
        await q(
          `INSERT INTO order_items (order_id, product_id, product_name, product_image, price, quantity, subtotal)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            row.id,
            it.id,
            it.name,
            it.image,
            it.price,
            it.qty,
            Number(it.price) * it.qty,
          ],
        );
      }
      
      ordersInserted++;
      if (ordersInserted % 100 === 0) {
        console.log(`✅ Đã chèn ${ordersInserted}/1000 đơn hàng...`);
      }
    }

    await queryRunner.commitTransaction();
    console.log('🎉 Hoàn thành chèn 1000 đơn hàng thật!');
  } catch (err) {
    await queryRunner.rollbackTransaction();
    console.error('❌ Lỗi khi seed dữ liệu:', err);
  } finally {
    await queryRunner.release();
    await ds.destroy();
  }
}

seed1000Orders();
