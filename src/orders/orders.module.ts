import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { CartModule } from 'src/carts/cart.module';
import { Cart } from 'src/carts/entities/cart.entity';
import { Product } from 'src/products/entities/product.entity';
import { User } from 'src/users/entities/user.entity';
import { UsersModule } from 'src/users/users.module';
import { ProductsModule } from 'src/products/products.module';
import { NotificationsModule } from 'src/notifications/notifications.module';
import { GhnModule } from '../ghn/ghn.module';
import { EscrowsModule } from '../escrows/escrows.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, OrderItem, Cart, Product, User]),
    UsersModule,
    ProductsModule,
    CartModule,
    NotificationsModule,
    GhnModule,
    EscrowsModule,
  ],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule { }
