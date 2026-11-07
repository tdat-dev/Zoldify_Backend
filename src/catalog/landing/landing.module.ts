import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Category } from '@catalog/categories/entities/category.entity';
import { Product } from '@catalog/products/entities/product.entity';
import { LandingController } from './landing.controller';
import { LandingService } from './landing.service';

@Module({
  imports: [TypeOrmModule.forFeature([Product, Category])],
  controllers: [LandingController],
  providers: [LandingService],
  exports: [LandingService],
})
export class LandingModule {}
