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
@Index('idx_seller_id', ['seller'])
@Index('idx_status', ['status'])
@Index('idx_created_at', ['created_at'])
@Index('idx_price', ['price'])
@Index('idx_seller_status', ['seller', 'status'])
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

  @Column({ type: 'tinyint', width: 1, default: 0 })
  is_freeship: boolean;

  @Column({ type: 'int', default: 0 })
  sold_count: number;

  @Column({ type: 'int', default: 0 })
  view_count: number;

  // 7. Trạng thái sản phẩm (Draft, Pending, Active, Sold, Rejected)
  @Column({
    type: 'enum',
    enum: ProductStatus,
    default: ProductStatus.ACTIVE,
  })
  status: ProductStatus;

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
