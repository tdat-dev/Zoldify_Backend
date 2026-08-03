import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { Product } from './entities/product.entity';
import { CategoriesModule } from '../categories/categories.module';
import { FollowsModule } from '../follows/follows.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { Follow } from '../follows/entities/follow.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Product, Follow]),
    CategoriesModule,
    FollowsModule,
    NotificationsModule,
  ],
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}

