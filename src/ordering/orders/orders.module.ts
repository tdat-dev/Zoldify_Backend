import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { CartModule } from '@ordering/carts/cart.module';
import { Cart } from '@ordering/carts/entities/cart.entity';
import { Product } from '@catalog/products/entities/product.entity';
import { User } from '@identity/users/entities/user.entity';
import { UsersModule } from '@identity/users/users.module';
import { ProductsModule } from '@catalog/products/products.module';
import { NotificationsModule } from '@messaging/notifications/notifications.module';
import { GhnModule } from '@ordering/ghn/ghn.module';
import { EscrowsModule } from '@money/escrows/escrows.module';
import { PayosModule } from '@money/payos/payos.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, OrderItem, Cart, Product, User]),
    UsersModule,
    ProductsModule,
    CartModule,
    NotificationsModule,
    GhnModule,
    EscrowsModule,
    // Huỷ đơn phải đóng luôn link thanh toán còn treo. An toàn vì PayosModule
    // KHÔNG import ngược OrdersModule — nó chỉ dùng entity Order.
    PayosModule,
  ],
  controllers: [OrdersController],
  providers: [OrdersService],
  // Job quá hạn dùng chung đường huỷ ở đây thay vì chép lại. An toàn vì
  // TasksModule chỉ được AppModule nạp, không module nào ở trên nạp nó.
  exports: [OrdersService],
})
export class OrdersModule {}
