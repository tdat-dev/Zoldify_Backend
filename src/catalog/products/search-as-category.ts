import { EntityManager } from 'typeorm';
import { Category } from '@catalog/categories/entities/category.entity';
import { toSlug } from '@common/slug';

/**
 * Câu tìm trùng đúng tên một danh mục thì hiểu là xem danh mục đó (test
 * staging 12/11, XEM-03).
 *
 * Đo: q="điện thoại" ra 10 món có chữ đó trong MÔ TẢ (Apple Watch, túi, sạc)
 * và không món nào của danh mục Điện thoại (103 tin), vì tin trong đó tên là
 * "iPhone 12", "Samsung S21". Người mua gõ tên danh mục là muốn xem danh mục.
 *
 * VÌ SAO KHÔNG `OR product.category_id = ?` VÀO CÂU MATCH. MySQL không dùng
 * chỉ mục FULLTEXT cho một vế OR, nên câu thành quét cả bảng 1M dòng; đường
 * tìm kiếm đã phải tinh chỉnh từng trăm mili giây (xem `queryProductList`).
 * Đổi sang lọc danh mục thì đi đúng đường liệt kê theo danh mục sẵn có.
 *
 * ĐÁNH ĐỔI: "laptop" giờ chỉ ra danh mục Laptop, không ra "túi laptop" ở Phụ
 * kiện. Ai muốn thứ đó gõ "túi laptop", câu đó không trùng danh mục nên vẫn
 * tìm chữ. Gỡ: chỉ mục tìm kiếm riêng có cả tên danh mục.
 *
 * So theo slug nên có dấu hay không, hoa hay thường đều khớp, không phụ thuộc
 * collation. Danh mục đã xoá mềm không khớp (`findOne` tự lọc).
 */
export async function searchAsCategory<
  T extends { q?: string; category_id?: unknown },
>(manager: EntityManager, qs: T): Promise<T> {
  if (!qs.q || qs.category_id) return qs;
  const slug = toSlug(String(qs.q));
  if (!slug) return qs;
  const category = await manager
    .getRepository(Category)
    .findOne({ where: { slug, is_active: true }, select: { id: true } });
  if (!category) return qs;
  return { ...qs, q: undefined, category_id: String(category.id) };
}
