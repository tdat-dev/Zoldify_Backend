import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Product,
  ProductStatus,
} from '@catalog/products/entities/product.entity';
import { Category } from '@catalog/categories/entities/category.entity';
import { Shop, ShopStatus } from '@catalog/shop/entities/shop.entity';

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
  ) {
    this.siteUrl = process.env.SITE_URL || 'http://localhost:3001';
  }

  async generateUrls() {
    const urls: Array<{ loc: string; lastmod?: string; priority: string }> = [];

    /**
     * Chỉ những trang CÓ NỘI DUNG công khai.
     *
     * Bản trước liệt kê /cart, /login, /register — trong khi public/robots.txt
     * lại ghi `Disallow: /cart`. Tức là vừa bảo Google đừng vào, vừa nộp nó
     * trong sitemap: một mâu thuẫn tự phát ra, và Search Console báo lỗi
     * "Submitted URL blocked by robots.txt".
     *
     * Giỏ hàng và đăng nhập cũng không có gì để xếp hạng: nội dung của chúng
     * phụ thuộc người đang đăng nhập, với khách vãng lai chỉ là một khung rỗng.
     */
    urls.push(
      { loc: `${this.siteUrl}/`, priority: '1.0' },
      { loc: `${this.siteUrl}/search`, priority: '0.8' },
    );

    // Active products
    const products = await this.productRepository.find({
      where: { status: ProductStatus.ACTIVE },
      select: ['id', 'name', 'slug', 'updated_at'],
    });
    for (const product of products) {
      urls.push({
        // `<slug>-p<id>`, KHÔNG phải slug trần.
        //
        // Bản trước phát `/product/${slug || id}`. Ứng dụng lại tra sản phẩm
        // theo id, nên mọi URL dạng slug đều mở ra trang "không tìm thấy" mà
        // vẫn đáp HTTP 200 — đo được: cả 377 URL sản phẩm trong sitemap đều
        // như vậy. Google gọi đó là soft 404 và vẫn lập chỉ mục trang rỗng.
        //
        // Đuôi -p<id> giữ chữ cho người đọc mà vẫn cho máy một khoá chắc chắn.
        loc: `${this.siteUrl}${productPath(product)}`,
        lastmod: product.updated_at?.toISOString().split('T')[0],
        priority: '0.8',
      });
    }

    // Categories
    const categories = await this.categoryRepository.find({
      select: ['id', 'slug', 'updated_at'],
    });
    for (const category of categories) {
      urls.push({
        loc: `${this.siteUrl}/category/${category.slug || category.id}`,
        lastmod: category.updated_at?.toISOString().split('T')[0],
        priority: '0.6',
      });
    }

    // Shops
    const shops = await this.shopRepository.find({
      where: { status: ShopStatus.ACTIVE },
      select: ['id', 'updated_at'],
      relations: ['user'],
    });
    for (const shop of shops) {
      urls.push({
        loc: `${this.siteUrl}/shop/${shop.user?.id || shop.id}`,
        lastmod: shop.updated_at?.toISOString().split('T')[0],
        priority: '0.7',
      });
    }

    return urls;
  }
}
