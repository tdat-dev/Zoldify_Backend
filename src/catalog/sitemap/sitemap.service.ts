import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, IsNull, Like, Not, Repository } from 'typeorm';
import {
  Product,
  ProductStatus,
} from '@catalog/products/entities/product.entity';
import { Category } from '@catalog/categories/entities/category.entity';
import { Shop, ShopStatus } from '@catalog/shop/entities/shop.entity';
import { siteUrlChinh } from '@common/site-url';
import { toSlug } from '@common/slug';

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
 * Hai đường dẫn dưới đây phải khớp CHÍNH XÁC web
 * (Zoldify_Frontend/src/lib/public-urls.ts). Web đã đổi từ `-p<id>` sang
 * `-i<id>` và không nhận kiểu cũ: đo trên prod 06/11, URL trong sitemap trả 404.
 */
function productPath(p: { id: number; name?: string; slug?: string }): string {
  const slug = toSlug(p.slug || p.name || '');
  return slug ? `/product/${slug}-i${p.id}` : `/product/${p.id}`;
}

function shopPath(u: { id: number; full_name?: string }): string {
  const slug = toSlug(u.full_name || '');
  return slug ? `/shop/${slug}-${u.id}` : `/shop/${u.id}`;
}

/**
 * Dữ liệu sinh cho bài đo 1 triệu dòng. Trang của chúng có noindex (web, lib/seo.ts)
 * nên nộp trong sitemap là vừa mời vừa đuổi Google, lại đẩy hàng triệu URL giả vào
 * báo cáo. Gỡ hai hằng này khi prod không còn dữ liệu đó.
 */
const MAU_SAN_PHAM_THU = 'sp-1m-%';
const MAU_SHOP_THU = 'shop-1m-%';

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
  /** Gốc của TRANG WEB — dùng cho URL của các trang mà người dùng mở. */
  private readonly siteUrl: string;
  /** Gốc của CHÍNH API NÀY — dùng cho địa chỉ của các file sitemap con. */
  private readonly apiUrl: string;

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

    // HAI GỐC KHÁC NHAU, VÀ ĐÂY LÀ CHỖ ĐÃ LÀM HỎNG BẢNG CHỈ MỤC.
    //
    // Các trang trong sitemap là trang của WEB (staging.zoldify.com). Nhưng
    // bản thân mấy file sitemap lại do API phục vụ (api-staging.zoldify.com).
    // Bản đầu dùng chung `siteUrl` cho cả hai, nên bảng chỉ mục trỏ file con
    // sang web — mà web không phục vụ file nào. Đo trên staging: cả hai file
    // con đều 404. Bản cũ chỉ có MỘT file nên không có chỗ để lộ lỗi này.
    //
    // VÌ SAO KHÔNG LẤY TỪ HEADER `Host` CỦA REQUEST, DÙ NHƯ THẾ LÀ KHỎI CẤU HÌNH.
    // Vì các route sitemap có cache đánh khoá theo ĐƯỜNG DẪN, không theo host.
    // Ai đó gửi `Host: evil.com` một lần là bản sitemap trỏ sang evil.com nằm
    // luôn trong cache và được trả cho mọi người sau đó — đầu độc cache. Đọc từ
    // biến môi trường thì không ai từ bên ngoài đổi được.
    //
    // Mặc định `http://localhost:3000` chứ không để `siteUrlChinh` tự rơi về
    // 3001: 3001 là cổng của WEB, còn đây là API. Con số này khớp .env.sample.
    this.apiUrl = siteUrlChinh(
      process.env.API_PUBLIC_URL || 'http://localhost:3000',
    );
  }

  /** Danh sách file con cho bảng chỉ mục — chỉ những lô THẬT SỰ có hàng. */
  async danhSachFileCon(): Promise<FileCon[]> {
    const lo = await this.productRepository
      .createQueryBuilder('p')
      .select('FLOOR((p.id - 1) / :size)', 'lo')
      .where('p.status = :st', { st: ProductStatus.ACTIVE })
      .andWhere('p.deleted_at IS NULL')
      // Lô chỉ toàn dữ liệu thử thì file con của nó sẽ rỗng và trả 404.
      .andWhere('(p.slug IS NULL OR p.slug NOT LIKE :thu)', {
        thu: MAU_SAN_PHAM_THU,
      })
      .groupBy('lo')
      .orderBy('lo', 'ASC')
      .setParameter('size', this.kichThuocLo)
      .getRawMany<{ lo: string | number }>();

    // `apiUrl` chứ KHÔNG phải `siteUrl`: đây là địa chỉ của chính mấy file
    // sitemap, mà chúng do API phục vụ. Xem ghi chú ở constructor.
    return [
      { loc: `${this.apiUrl}/sitemap-static.xml` },
      ...lo.map((l) => ({
        loc: `${this.apiUrl}/sitemap-products-${Number(l.lo)}.xml`,
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
      where: { status: ShopStatus.ACTIVE, slug: Not(Like(MAU_SHOP_THU)) },
      select: { id: true, updated_at: true, user: { id: true, full_name: true } },
      relations: { user: true },
    });
    for (const s of shops) {
      if (!s.user) continue;
      urls.push({
        loc: `${this.siteUrl}${shopPath(s.user)}`,
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

    const dangBan = { status: ProductStatus.ACTIVE, id: Between(dau, cuoi) };
    const products = await this.productRepository.find({
      // Hai nhánh vì slug có thể NULL, mà NULL NOT LIKE ... không phải TRUE: chỉ
      // một điều kiện thì tin không có slug âm thầm rơi khỏi sitemap.
      where: [
        { ...dangBan, slug: Not(Like(MAU_SAN_PHAM_THU)) },
        { ...dangBan, slug: IsNull() },
      ],
      select: ['id', 'name', 'slug'],
      order: { id: 'ASC' },
      // Chặn trên thừa so với khoảng id ở trên, nhưng giữ có chủ đích: nếu sau
      // này ai đó đổi cách chia lô mà quên, `take` vẫn không cho một request
      // nạp cả bảng. Một chốt rẻ cho thứ đã hỏng một lần.
      take: this.kichThuocLo,
    });

    return products.map((p) => ({
      // `<slug>-i<id>`, KHÔNG phải slug trần.
      //
      // Bản trước phát `/product/${slug || id}`. Ứng dụng lại tra sản phẩm theo
      // id, nên mọi URL dạng slug đều mở ra trang "không tìm thấy" mà vẫn đáp
      // HTTP 200 — đo được: cả 377 URL sản phẩm trong sitemap đều như vậy.
      // Google gọi đó là soft 404 và vẫn lập chỉ mục trang rỗng.
      //
      // Đuôi -i<id> giữ chữ cho người đọc mà vẫn cho máy một khoá chắc chắn.
      loc: `${this.siteUrl}${productPath(p)}`,
      // KHÔNG có lastmod: repository.increment trong flushViewCount cũng đẩy
      // updated_at, nên mỗi lượt xem đều đổi ngày. Đo trên prod 06/11: mọi món
      // cùng mốc 09:10:00 của job. Google bỏ qua lastmod không đáng tin. Thêm lại
      // khi job đó giữ nguyên updated_at.
      priority: '0.8',
    }));
  }
}
