import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  OneToMany,
} from 'typeorm';
import { Product } from '@catalog/products/entities/product.entity'; // Mở ra khi bạn viết Product Entity

@Entity('categories') // Tên bảng trong cơ sở dữ liệu MySQL là 'categories'
export class Category {
  // 1. ID tự tăng - Khóa chính (Primary Key)
  @PrimaryGeneratedColumn()
  id: number;

  // 2. Tên danh mục (ví dụ: Điện thoại, Quần áo...) - Bắt buộc nhập và không được trùng
  @Column({ type: 'varchar', length: 100, unique: true })
  name: string;

  // 2b. Tên tiếng Anh - tự dịch bằng Cloudflare Workers AI khi tạo/sửa danh mục.
  // Null nếu chưa dịch được (frontend tự fallback về `name`).
  @Column({ type: 'varchar', length: 150, nullable: true })
  name_en: string;

  // 3. Mô tả chi tiết danh mục - Có thể null (không bắt buộc)
  @Column({ type: 'text', nullable: true })
  description: string;

  // 4. Slug thân thiện với SEO (ví dụ: 'dien-thoai', 'quan-ao') - Không được trùng
  @Column({ type: 'varchar', length: 150, unique: true, nullable: true })
  slug: string;

  // 5. Ảnh đại diện danh mục (URL) - Có thể null
  @Column({ type: 'varchar', length: 255, nullable: true })
  image: string;

  // 6. Trạng thái hiển thị (1 = Đang hoạt động, 0 = Ẩn)
  @Column({ type: 'tinyint', width: 1, default: 1 })
  is_active: boolean;

  // 7. Ngày tạo danh mục - Tự động tạo thời gian hiện tại
  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  // 8. Ngày cập nhật danh mục - Tự động cập nhật mỗi khi thay đổi bản ghi
  @UpdateDateColumn({ type: 'timestamp' })
  updated_at: Date;

  // 9. Xóa mềm (Soft Delete) - Lưu thời gian xóa thay vì xóa hẳn khỏi DB (ẩn trường này khi select)
  @DeleteDateColumn({ select: false })
  deleted_at?: Date;

  // 10. Mối quan hệ Một-Nhiều (One-to-Many) với bảng Products (Sản phẩm)
  // Một danh mục (Category) có thể có nhiều sản phẩm (Products)
  @OneToMany(() => Product, (product) => product.category)
  products: Product[];
}
