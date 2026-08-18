import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { Product } from './entities/product.entity';
import { CategoriesModule } from '@catalog/categories/categories.module';
import { FollowsModule } from '@catalog/follows/follows.module';
import { NotificationsModule } from '@messaging/notifications/notifications.module';
import { Follow } from '@catalog/follows/entities/follow.entity';
import { Shop } from '@catalog/shop/entities/shop.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Product, Follow, Shop]),
    CategoriesModule,
    FollowsModule,
    NotificationsModule,
  ],
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
