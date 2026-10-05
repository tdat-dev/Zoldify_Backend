import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SitemapController } from './sitemap.controller';
import { SitemapService } from './sitemap.service';
import { Product } from '@catalog/products/entities/product.entity';
import { Category } from '@catalog/categories/entities/category.entity';
import { Shop } from '@catalog/shop/entities/shop.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Product, Category, Shop])],
  controllers: [SitemapController],
  providers: [SitemapService],
})
export class SitemapModule {}
