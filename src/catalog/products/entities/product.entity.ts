import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Category } from '@catalog/categories/entities/category.entity';
import { User } from '@identity/users/entities/user.entity';
import { ApiHideProperty } from '@nestjs/swagger';

// Định nghĩa trạng thái sản phẩm
export enum ProductStatus {
  DRAFT = 'draft', // Nháp (chưa đăng)
  PENDING = 'pending', // Chờ duyệt
  ACTIVE = 'active', // Đang mở bán
  SOLD = 'sold', // Đã bán
  REJECTED = 'rejected', // Bị từ chối duyệt
}

@Entity('products')
@Index('idx_category_id', ['category'])
// idx_seller_id (1 cột) ĐÃ BỎ ở migration DropRedundantPrefixIndexes2: thừa vì
// idx_seller_status (seller_id, status) phủ nó theo quy tắc leftmost-prefix và
// đỡ luôn khoá ngoại seller_id. Không khai lại — khai lại là bảo TypeORM dựng
// lại đúng cái index vừa cố ý xoá.
// idx_status (1 cột) ĐÃ BỎ ở migration 1788500000000: tiền tố trái của
// idx_status_created bên dưới, và `status` không có khoá ngoại cần đỡ.
//
// Bốn index (status, <cột sắp>) cho danh sách công khai: WHERE status='active'
// ORDER BY created_at | price | sold_count | view_count. Thiếu cột sắp đi kèm
// thì MySQL gom ~80% bảng (hàng active) rồi filesort để lấy 20 dòng. Số đo
// trước/sau: scripts/explain-1m.ts. Migration 1788500000000.
@Index('idx_status_created', ['status', 'created_at'])
@Index('idx_status_price', ['status', 'price'])
// Đếm có trần theo khoảng giá chạy trọn trong index, không về bảng đọc deleted_at.
@Index('idx_status_deleted_price', ['status', 'deleted_at', 'price'])
@Index('idx_status_sold', ['status', 'sold_count'])
@Index('idx_status_view', ['status', 'view_count'])
// Danh sách theo danh mục, kiểu sắp mặc định, VÀ product_count của
// GET /categories. idx_category_id VẪN giữ dù là tiền tố trái của cái này: xem
// chú thích cuối danh sách XOA trong migration 1788500000000 (synchronize lúc
// test xoá trước tạo sau, khoá ngoại chặn).
//
// `deleted_at` đứng trước `created_at` (migration 1788600000000): TypeORM thêm
// `deleted_at IS NULL` vào mọi câu, thiếu cột này thì đếm sản phẩm theo danh
// mục phải về bảng đọc từng dòng, 15.136 ms trên 941k hàng đang bán.
@Index('idx_category_status_deleted_created', [
  'category',
  'status',
  'deleted_at',
  'created_at',
])
// COUNT(*) WHERE deleted_at IS NULL của thống kê admin: đọc trong index này
// thay vì quét cả bảng (2.052 ms trên 1 triệu dòng). Migration 1788600000000.
@Index('idx_deleted_at', ['deleted_at'])
@Index('idx_created_at', ['created_at'])
@Index('idx_price', ['price'])
// Phủ cả WHERE (seller, status) LẪN ORDER BY created_at của gian hàng người
// bán — `shop.getShopProducts`. Thay `idx_seller_status` cũ: index này phủ nó
// theo quy tắc leftmost-prefix nên giữ cả hai là trả tiền ghi cho một thứ
// không ai đọc. Migration 1788000000000.
@Index('idx_seller_status_created', ['seller', 'status', 'created_at'])
// Đơn của người bán: lọc xoá mềm trong index. Migration 1788700000000.
@Index('idx_seller_deleted', ['seller', 'deleted_at'])
// FULLTEXT cho tìm kiếm sản phẩm — migration AddFulltextSearch tạo.
@Index('ft_name_desc', ['name', 'description'], { fulltext: true })
export class Product {
  // 1. ID tự tăng - Khóa chính (Primary Key)
  @PrimaryGeneratedColumn()
  id: number;

  // 2. Tên sản phẩm (ví dụ: iPhone 15 Pro Max)
  @Column({ type: 'varchar', length: 255 })
  name: string;

  // 2.1. Slug thân thiện với SEO (ví dụ: 'iphone-15-pro-max') - Không được trùng
  @Column({ type: 'varchar', length: 255, unique: true, nullable: true })
  slug: string;

  // 3. Mô tả chi tiết sản phẩm - Kiểu TEXT để lưu được nhiều ký tự
  @Column({ type: 'text', nullable: true })
  description: string;

  // 4. Giá bán - DECIMAL(15,2) để tránh sai số tiền tệ và hiển thị chính xác số dư lẻ
  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0.0 })
  price: number;

  /**
   * 4.1. Đơn vị tiền của `price` — mã ISO 4217 ('VND', 'USD', 'JPY'…).
   *
   * VÌ SAO CẦN: trước cột này, mọi con số trong hệ thống đều NGẦM hiểu là đồng
   * Việt Nam, và không chỗ nào trong mã nói ra điều đó. Giao diện tiếng Anh vì
   * vậy vẫn in "1.890.000 ₫" — không phải lỗi định dạng, mà là vì thật sự không
   * có dữ liệu nào cho nó biết số đó là tiền gì.
   *
   * ⚠️ CỘT NÀY CHỈ LÀM ĐÚNG PHẦN HIỂN THỊ. Nó KHÔNG khiến sàn giao dịch được
   * xuyên tiền tệ. Muốn thế còn cần: nguồn tỉ giá, thời điểm chốt giá, và một
   * sổ cái nhiều tiền tệ. Sổ cái hiện tại (ledger_accounts) kiểm bất biến
   * `sum(entries) = 0`, mà bất biến đó chỉ có nghĩa TRONG CÙNG một tiền tệ —
   * trộn hai loại tiền vào một sổ là cách làm hỏng sổ sách mà không ai thấy.
   * Nên tới khi có thiết kế đó, mỗi sàn vẫn nên chạy một tiền tệ.
   */
  @Column({ type: 'char', length: 3, default: 'VND' })
  currency: string;

  // 5. Số lượng sản phẩm trong kho
  @Column({ type: 'int', default: 1 })
  stock: number;

  // 6. Ảnh chính sản phẩm
  @Column({ type: 'varchar', length: 255, nullable: true })
  image: string;

  // 6.1. Thương hiệu sản phẩm
  @Column({ type: 'varchar', length: 100, nullable: true })
  brand: string;

  // 6.2. Thông số kỹ thuật sản phẩm
  @Column({ type: 'text', nullable: true })
  spec: string;

  // 6.3. Danh sách hình ảnh phụ sản phẩm - Lưu dạng mảng chuỗi (JSON trong MySQL)
  @Column({ type: 'json', nullable: true })
  images: string[];

  @Column({ type: 'varchar', length: 20, default: 'new' })
  condition: string;

  // Người bán tự kể tình trạng thật: xước ở đâu, pin còn bao nhiêu, thiếu gì.
  @Column({ type: 'varchar', length: 500, nullable: true })
  condition_note: string | null;

  // Chép từ địa chỉ lấy hàng của shop lúc đăng, lý do ghi ở migration
  // 1789100000000. Dữ liệu thử sp-1m-* để trống.
  @Column({ type: 'varchar', length: 100, nullable: true })
  province_name: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  province_slug: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  district_name: string | null;

  @Column({ type: 'boolean', default: false })
  is_freeship: boolean;

  @Column({ type: 'int', default: 0 })
  sold_count: number;

  // Điểm trung bình và số lượt đánh giá, giữ sẵn để danh sách sản phẩm không
  // phải tổng hợp bảng reviews cho từng thẻ (migration 1787700000000, lỗi H-01).
  // Chỉ InteractionsService.refreshProductStats được ghi hai cột này.
  // DECIMAL về tới JS là chuỗi ("4.50"); đổi sang số để app không phải đoán.
  @Column({
    type: 'decimal',
    precision: 3,
    scale: 2,
    default: 0,
    transformer: {
      to: (v?: number | null) => v,
      from: (v?: string | number | null) => (v == null ? 0 : Number(v)),
    },
  })
  rating_avg: number;

  @Column({ type: 'int', default: 0 })
  review_count: number;

  @Column({ type: 'int', default: 0 })
  view_count: number;

  // 7. Trạng thái sản phẩm (Draft, Pending, Active, Sold, Rejected)
  @Column({
    type: 'enum',
    enum: ProductStatus,
    default: ProductStatus.ACTIVE,
  })
  status: ProductStatus;

  /**
   * Lúc tin bị ẩn VÌ khoá tài khoản người bán (migration 1788300000000). Mở
   * khoá chỉ bày lại tin có dấu này, rồi xoá dấu. `select: false`: chỉ là sổ
   * ghi chép nội bộ, không đưa ra API, nên cũng ẩn khỏi openapi.json (ba
   * client không được thấy một trường mà API không bao giờ trả).
   */
  @ApiHideProperty()
  @Column({ type: 'datetime', nullable: true, select: false })
  hidden_by_lock_at?: Date | null;

  // 8. Quan hệ Nhiều-Một (Many-to-One): Một danh mục (Category) có nhiều sản phẩm (Products)
  @ManyToOne(() => Category, (category) => category.products, {
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'category_id' }) // Tên cột khóa ngoại trong MySQL là 'category_id'
  category: Category;

  // 9. Quan hệ Nhiều-Một (Many-to-One): Một User (Người bán) có thể đăng bán nhiều sản phẩm
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'seller_id' }) // Tên cột khóa ngoại trong MySQL là 'seller_id'
  seller: User;

  // 10. Ngày đăng bán sản phẩm - Tự động tạo thời gian hiện tại
  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  // 11. Ngày cập nhật thông tin sản phẩm
  @UpdateDateColumn({ type: 'timestamp' })
  updated_at: Date;

  // 12. Xóa mềm (Soft Delete) - Ẩn khi select
  @DeleteDateColumn({ select: false })
  deleted_at?: Date;
}
