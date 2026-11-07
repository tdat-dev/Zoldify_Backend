import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Cache } from 'cache-manager';
import { Repository } from 'typeorm';
import { Category } from '@catalog/categories/entities/category.entity';
import {
  Product,
  ProductStatus,
} from '@catalog/products/entities/product.entity';
import { toSlug } from '@common/slug';

/** Dưới mức này trang quá mỏng để đưa cho Google. Giả định khởi đầu, chỉnh theo số thật. */
const SO_TIN_TOI_THIEU = 5;
const TIN_MOI_TRANG = 48;
/** Chặn trên phòng khi kho tin thật lớn lên: đọc cả vào bộ nhớ là ổn với vài nghìn tin. */
const TOI_DA_TIN = 20_000;
const TTL_MS = 10 * 60 * 1000;
const KHOA_CACHE = 'landing:tin-that';

const TAM_GIA = [
  { slug: 'gia-duoi-100-nghin', label: 'dưới 100 nghìn', min: 0, max: 100_000 },
  {
    slug: 'gia-100-den-300-nghin',
    label: 'từ 100 đến 300 nghìn',
    min: 100_000,
    max: 300_000,
  },
  {
    slug: 'gia-300-nghin-den-1-trieu',
    label: 'từ 300 nghìn đến 1 triệu',
    min: 300_000,
    max: 1_000_000,
  },
  {
    slug: 'gia-1-den-5-trieu',
    label: 'từ 1 đến 5 triệu',
    min: 1_000_000,
    max: 5_000_000,
  },
  {
    slug: 'gia-5-den-10-trieu',
    label: 'từ 5 đến 10 triệu',
    min: 5_000_000,
    max: 10_000_000,
  },
  {
    slug: 'gia-tren-10-trieu',
    label: 'trên 10 triệu',
    min: 10_000_000,
    max: Infinity,
  },
];

export type LoaiBoLoc = 'brand' | 'price' | 'location';

export interface BoLoc {
  type: LoaiBoLoc;
  slug: string;
  label: string;
  count: number;
}

export interface TinThat {
  id: number;
  name: string;
  slug: string | null;
  image: string | null;
  price: number;
  currency: string;
  stock: number;
  condition: string;
  brand: string | null;
  province_name: string;
  province_slug: string;
  sold_count: number;
  rating_avg: number;
  review_count: number;
  view_count: number;
  category_id: number;
}

/**
 * Trang đích theo hãng, tầm giá, địa điểm trong một danh mục.
 *
 * ĐỌC TOÀN BỘ TIN THẬT RỒI TÍNH TRONG BỘ NHỚ, CACHE 10 PHÚT. Prod có hơn 1 triệu dòng
 * thử nhưng chỉ khoảng một nghìn tin thật, và `province_slug` chỉ có ở tin thật, nên
 * index trên cột đó đưa ra đúng phần cần đọc. Một câu truy vấn thay cho một câu GROUP BY
 * cho mỗi trang. Khi kho tin thật vượt `TOI_DA_TIN` thì đổi sang tính ở SQL.
 *
 * Luật mở trang ghi ở landing.service.spec.ts.
 */
@Injectable()
export class LandingService {
  constructor(
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
    @InjectRepository(Category)
    private readonly categories: Repository<Category>,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  private async tinThat(): Promise<TinThat[]> {
    // Fail-open cùng kiểu ProductsService: cache hỏng thì đọc thẳng DB.
    try {
      const co = await this.cache.get<TinThat[]>(KHOA_CACHE);
      if (co) return co;
    } catch {
      /* coi như miss */
    }

    const dong = await this.products
      .createQueryBuilder('p')
      .select([
        'p.id AS id',
        'p.name AS name',
        'p.slug AS slug',
        'p.image AS image',
        'p.price AS price',
        'p.currency AS currency',
        'p.stock AS stock',
        'p.condition AS `condition`',
        'p.brand AS brand',
        'p.province_name AS province_name',
        'p.province_slug AS province_slug',
        'p.sold_count AS sold_count',
        'p.rating_avg AS rating_avg',
        'p.review_count AS review_count',
        'p.view_count AS view_count',
        'p.category_id AS category_id',
      ])
      .where('p.province_slug IS NOT NULL')
      .andWhere('p.status = :st', { st: ProductStatus.ACTIVE })
      .andWhere('p.stock > 0')
      .orderBy('p.id', 'DESC')
      .limit(TOI_DA_TIN)
      .getRawMany<TinThat>();

    const tin = dong.map((d) => ({
      ...d,
      price: Number(d.price),
      rating_avg: Number(d.rating_avg),
    }));
    try {
      await this.cache.set(KHOA_CACHE, tin, TTL_MS);
    } catch {
      /* không lưu được cũng không sao */
    }
    return tin;
  }

  private async danhMuc(slug: string) {
    const category = await this.categories.findOne({
      where: { slug },
      select: { id: true, name: true, slug: true },
    });
    if (!category) throw new NotFoundException('Không có danh mục này');
    return category;
  }

  /** Mọi bộ lọc của một nhóm tin, kèm tin khớp từng bộ lọc. */
  private dungBoLoc(tin: TinThat[]): { boLoc: BoLoc; tin: TinThat[] }[] {
    const nhom = new Map<string, { boLoc: BoLoc; tin: TinThat[] }>();
    const them = (type: LoaiBoLoc, slug: string, label: string, t: TinThat) => {
      if (!slug) return;
      const co = nhom.get(slug);
      if (co) {
        co.boLoc.count += 1;
        co.tin.push(t);
      } else {
        nhom.set(slug, { boLoc: { type, slug, label, count: 1 }, tin: [t] });
      }
    };

    for (const t of tin) {
      if (t.brand) them('brand', toSlug(t.brand), t.brand, t);
      const gia = TAM_GIA.find((g) => t.price >= g.min && t.price < g.max);
      if (gia) them('price', gia.slug, gia.label, t);
      them('location', `tai-${t.province_slug}`, t.province_name, t);
    }

    return [...nhom.values()]
      .filter(
        (n) =>
          n.boLoc.count >= SO_TIN_TOI_THIEU &&
          // Phủ cả danh mục thì nội dung trùng hệt trang danh mục.
          n.boLoc.count < tin.length,
      )
      .sort((a, b) => b.boLoc.count - a.boLoc.count);
  }

  async boLoc(slug: string) {
    const category = await this.danhMuc(slug);
    const tin = (await this.tinThat()).filter(
      (t) => t.category_id === category.id,
    );
    return {
      category,
      total: tin.length,
      facets: this.dungBoLoc(tin).map((n) => n.boLoc),
    };
  }

  async trang(slug: string, facet: string) {
    const category = await this.danhMuc(slug);
    const tin = (await this.tinThat()).filter(
      (t) => t.category_id === category.id,
    );
    const bo = this.dungBoLoc(tin);
    const khop = bo.find((n) => n.boLoc.slug === facet);
    if (!khop) throw new NotFoundException('Không có trang này');

    const gia = khop.tin.map((t) => t.price);
    return {
      category,
      facet: khop.boLoc,
      total: khop.tin.length,
      price_min: Math.min(...gia),
      price_max: Math.max(...gia),
      items: khop.tin.slice(0, TIN_MOI_TRANG),
      related: bo.filter((n) => n !== khop).map((n) => n.boLoc),
    };
  }

  /** Đường dẫn mọi trang đủ điều kiện, cho sitemap. */
  async duongDan(): Promise<string[]> {
    const [tin, danhMuc] = await Promise.all([
      this.tinThat(),
      this.categories.find({ select: { id: true, slug: true } }),
    ]);
    return danhMuc.flatMap((c) =>
      this.dungBoLoc(tin.filter((t) => t.category_id === c.id)).map(
        (n) => `/category/${c.slug}/${n.boLoc.slug}`,
      ),
    );
  }
}
