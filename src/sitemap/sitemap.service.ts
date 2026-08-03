import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product, ProductStatus } from '../products/entities/product.entity';
import { Category } from '../categories/entities/category.entity';
import { Shop, ShopStatus } from '../shop/entities/shop.entity';

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

    // Static pages
    const staticPages = [
      { loc: `${this.siteUrl}/`, priority: '1.0' },
      { loc: `${this.siteUrl}/search`, priority: '0.8' },
      { loc: `${this.siteUrl}/cart`, priority: '0.5' },
      { loc: `${this.siteUrl}/login`, priority: '0.3' },
      { loc: `${this.siteUrl}/register`, priority: '0.3' },
    ];
    urls.push(...staticPages);

    // Active products
    const products = await this.productRepository.find({
      where: { status: ProductStatus.ACTIVE },
      select: ['id', 'slug', 'updated_at'],
    });
    for (const product of products) {
      urls.push({
        loc: `${this.siteUrl}/product/${product.slug || product.id}`,
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