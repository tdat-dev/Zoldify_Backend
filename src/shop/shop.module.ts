import { Module } from '@nestjs/common';
import { ShopService } from './shop.service';
import { ShopController } from './shop.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from 'src/users/entities/user.entity';
import { Product } from 'src/products/entities/product.entity';
import { Follow } from 'src/follows/entities/follow.entity';
import { OrderItem } from 'src/orders/entities/order-item.entity';
import { Shop } from './entities/shop.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Shop, User, Product, Follow, OrderItem])],
  controllers: [ShopController],
  providers: [ShopService],
})
export class ShopModule { }
