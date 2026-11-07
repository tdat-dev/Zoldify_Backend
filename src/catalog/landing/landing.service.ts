import { Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { Cache } from 'cache-manager';
import { Product } from '@catalog/products/entities/product.entity';
import { Category } from '@catalog/categories/entities/category.entity';

@Injectable()
export class LandingService {
  constructor(
    private readonly products: Repository<Product>,
    private readonly categories: Repository<Category>,
    private readonly cache: Cache,
  ) {}

  boLoc(_slug: string): Promise<{ total: number; facets: { slug: string }[] }> {
    return Promise.reject(new Error('chưa làm'));
  }

  trang(_slug: string, _facet: string): Promise<any> {
    return Promise.reject(new Error('chưa làm'));
  }

  duongDan(): Promise<string[]> {
    return Promise.reject(new Error('chưa làm'));
  }
}
