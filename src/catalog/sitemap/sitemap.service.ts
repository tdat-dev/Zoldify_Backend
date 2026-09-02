import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import {
  Product,
  ProductStatus,
} from '@catalog/products/entities/product.entity';
import { Category } from '@catalog/categories/entities/category.entity';
import { Shop, ShopStatus } from '@catalog/shop/entities/shop.entity';
import { siteUrlChinh } from '@common/site-url';

/**
 * Số sản phẩm tối đa trong MỘT file sitemap con.
 *
 * Hai ràng buộc khác nhau, con số phải thoả cả hai:
 *
 *  - Chuẩn sitemap cho tối đa 50.000 URL và 50MB mỗi file. Bản cũ nhét tất cả
 *    vào một file, nên vượt 50.000 sản phẩm là Google từ chối CẢ sitemap chứ
 *    không phải chỉ bỏ phần thừa.
 *  - Quan trọng hơn với Node: đây là lượng CPU cho MỘT request. Node chỉ có một
 *    luồng JS; dựng 50.000 chuỗi qua 6 regex mỗi cái là giữ luồng rất lâu và
 *    mọi người khác xếp hàng. 5.000 là mức giữ được thời gian sinh ở hàng chục
 *    mili-giây.
 */
export const KICH_THUOC_LO = 5000;

/**
 * Đường dẫn sản phẩm cho sitemap — phải khớp CHÍNH XÁC với cách frontend dựng
 * link (Zoldify_Frontend/src/lib/product-url.ts). Hai chỗ lệch nhau là sitemap
 * lại nộp cho Google những URL mà bấm vào không ra gì, đúng lỗi vừa sửa.
 */
function productPath(p: { id: number; name?: string; slug?: string }): string {
  const words = (p.slug || p.name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return words ? `/product/${words}-p${p.id}` : `/product/${p.id}`;
}

export interface SitemapUrl {
  loc: string;
  lastmod?: string;
  priority: string;
}

export interface FileCon {
  loc: string;
  lastmod?: string;
}

const ngay = (d?: Date | null): string | undefined =>
  d ? d.toISOString().split('T')[0] : undefined;

/**
 * `sitemap.xml` — chia thành bảng chỉ mục + nhiều file con.
 *
 * VÌ SAO PHẢI ĐỔI, VÀ VÌ SAO ĐỔI KIỂU NÀY.
 *
 * Bản cũ gọi `productRepository.find()` KHÔNG `take`: nạp toàn bộ sản phẩm đang
 * bán, dựng từng ấy đối tượng rồi từng ấy chuỗi. Đo thật bằng `npm run loadtest`
 * trên database 2.000 sản phẩm:
 *
 *   sitemap.xml   60 rps · p95 1.646ms (100 người) · event loop lag p99 168ms
 *   healthcheck   lúc rảnh 0,45ms → lúc 4 request sitemap chạy: 11,7ms
 *
 * Tức nó làm MỌI request khác chậm 26 lần, kể cả healthcheck rỗng. Ở Java mỗi
 * request một luồng nên chuyện này không xảy ra; Node chỉ có một luồng JS, và
 * phần dựng chuỗi là CPU thuần — không nhả luồng cho ai. Route lại `@Public()`.
 *
 * VÌ SAO CHIA LÔ THEO KHOẢNG id CHỨ KHÔNG PHẢI `skip`/`OFFSET`.
 *
 * Cách hiển nhiên là `find({ skip: lo * size, take: size })`. Đã đo bằng EXPLAIN
 * trên chính bảng `products` và nó hỏng đúng chỗ mình vừa chữa:
 *
 *   OFFSET    0  → type=index  key=idx_created_at  rows=10
 *   OFFSET  500  → type=index  key=idx_created_at  rows=510
 *   OFFSET 1000  → type=ALL    key=NULL            rows=1955  + filesort
 *
 * Qua một ngưỡng, MySQL bỏ hẳn index và quét cả bảng. Chia lô bằng OFFSET là dời
 * chỗ đau chứ không chữa: file con cuối cùng lại đúng là file quét cả bảng.
 *
 * Khoảng id thì luôn đi qua khoá chính: `WHERE id BETWEEN a AND b`. Chi phí
 * không phụ thuộc lô thứ mấy.
 *
 * VÌ SAO BẢNG CHỈ MỤC ĐI HỎI DATABASE THAY VÌ TỰ TÍNH TỪ `MAX(id)`.
 *
 * Vì id thưa: sản phẩm bị xoá mềm hoặc đổi trạng thái để lại lỗ. Tính từ
 * `MAX(id)` sẽ đẻ ra những file con rỗng, và Google báo lỗi cho từng cái. Một
 * câu `GROUP BY` cho đúng danh sách lô CÓ HÀNG, chạy một lần và được cache.
 */
@Injectable()
export class SitemapService {
  private readonly siteUrl: string;

  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(Category)
    private readonly categoryRepository: Repository<Category>,
    @InjectRepository(Shop)
    private readonly shopRepository: Repository<Shop>,
    // Tham số này để bài kiểm truyền lô nhỏ vào — không thì muốn kiểm việc chia
    // lô phải tạo 5.000 sản phẩm giả.
    //
    // `@Optional()` là BẮT BUỘC, không phải cho đẹp. Giá trị mặc định của
    // TypeScript không nói gì với Nest: trình biên dịch vẫn ghi `Number` vào
    // `design:paramtypes`, nên Nest đi tìm một provider tên `Number`, không
    // thấy, và chết ngay lúc dựng:
    //
    //   Nest can't resolve dependencies of the SitemapService
    //   (ProductRepository, CategoryRepository, ShopRepository, ?).
    //   Please make sure that the argument Number at index [3] is available.
    //
    // Đã dính thật ở đúng chỗ này: 8/8 unit test xanh trong khi app không dựng
    // nổi — vì unit test tự `new SitemapService(...)`, không đi qua DI. Đúng
    // con bẫy của task #14 (worker xanh 26/26 mà `node dist/worker` chết).
    // `scripts/selfcheck-boot.ts` sinh ra từ lần này để bắt loại lỗi đó.
    //
    // Có `@Optional()` thì Nest tiêm `undefined`, và lúc đó mặc định của TS mới
    // có tác dụng.
    @Optional()
    private readonly kichThuocLo: number = KICH_THUOC_LO,
  ) {
    // KHÔNG đọc thẳng process.env.SITE_URL: trên staging biến đó là một DANH
    // SÁCH ngăn bởi dấu phẩy (main.ts dùng nó cho CORS). Đọc thô thì mọi <loc>
    // thành URL rác — đã đo được trên api-staging trước khi sửa.
    this.siteUrl = siteUrlChinh(process.env.SITE_URL);
  }

  /** Danh sách file con cho bảng chỉ mục — chỉ những lô THẬT SỰ có hàng. */
  async danhSachFileCon(): Promise<FileCon[]> {
    const lo = await this.productRepository
      .createQueryBuilder('p')
      .select('FLOOR((p.id - 1) / :size)', 'lo')
      .addSelect('MAX(p.updated_at)', 'moi_nhat')
      .where('p.status = :st', { st: ProductStatus.ACTIVE })
      .andWhere('p.deleted_at IS NULL')
      .groupBy('lo')
      .orderBy('lo', 'ASC')
      .setParameter('size', this.kichThuocLo)
      .getRawMany<{ lo: string | number; moi_nhat: Date | null }>();

    return [
      { loc: `${this.siteUrl}/sitemap-static.xml` },
      ...lo.map((l) => ({
        loc: `${this.siteUrl}/sitemap-products-${Number(l.lo)}.xml`,
        lastmod: ngay(l.moi_nhat),
      })),
    ];
  }

  /**
   * Trang tĩnh + danh mục + shop. Ba thứ này nhỏ và tăng chậm, để chung một file.
   *
   * Chỉ những trang CÓ NỘI DUNG công khai. Bản trước liệt kê /cart, /login,
   * /register — trong khi public/robots.txt lại ghi `Disallow: /cart`. Vừa bảo
   * Google đừng vào, vừa nộp nó trong sitemap: Search Console báo lỗi
   * "Submitted URL blocked by robots.txt". Giỏ hàng và đăng nhập cũng không có
   * gì để xếp hạng — với khách vãng lai chỉ là một khung rỗng.
   */
  async urlTinh(): Promise<SitemapUrl[]> {
    const urls: SitemapUrl[] = [
      { loc: `${this.siteUrl}/`, priority: '1.0' },
      { loc: `${this.siteUrl}/search`, priority: '0.8' },
    ];

    const categories = await this.categoryRepository.find({
      select: ['id', 'slug', 'updated_at'],
    });
    for (const c of categories) {
      urls.push({
        loc: `${this.siteUrl}/category/${c.slug || c.id}`,
        lastmod: ngay(c.updated_at),
        priority: '0.6',
      });
    }

    const shops = await this.shopRepository.find({
      where: { status: ShopStatus.ACTIVE },
      select: ['id', 'updated_at'],
      relations: ['user'],
    });
    for (const s of shops) {
      urls.push({
        loc: `${this.siteUrl}/shop/${s.user?.id || s.id}`,
        lastmod: ngay(s.updated_at),
        priority: '0.7',
      });
    }

    return urls;
  }

  /** Sản phẩm trong lô thứ `lo` — id nằm trong khoảng của lô đó. */
  async urlSanPham(lo: number): Promise<SitemapUrl[]> {
    const dau = lo * this.kichThuocLo + 1;
    const cuoi = (lo + 1) * this.kichThuocLo;

    const products = await this.productRepository.find({
      where: { status: ProductStatus.ACTIVE, id: Between(dau, cuoi) },
      select: ['id', 'name', 'slug', 'updated_at'],
      order: { id: 'ASC' },
      // Chặn trên thừa so với khoảng id ở trên, nhưng giữ có chủ đích: nếu sau
      // này ai đó đổi cách chia lô mà quên, `take` vẫn không cho một request
      // nạp cả bảng. Một chốt rẻ cho thứ đã hỏng một lần.
      take: this.kichThuocLo,
    });

    return products.map((p) => ({
      // `<slug>-p<id>`, KHÔNG phải slug trần.
      //
      // Bản trước phát `/product/${slug || id}`. Ứng dụng lại tra sản phẩm theo
      // id, nên mọi URL dạng slug đều mở ra trang "không tìm thấy" mà vẫn đáp
      // HTTP 200 — đo được: cả 377 URL sản phẩm trong sitemap đều như vậy.
      // Google gọi đó là soft 404 và vẫn lập chỉ mục trang rỗng.
      //
      // Đuôi -p<id> giữ chữ cho người đọc mà vẫn cho máy một khoá chắc chắn.
      loc: `${this.siteUrl}${productPath(p)}`,
      lastmod: ngay(p.updated_at),
      priority: '0.8',
    }));
  }
}
