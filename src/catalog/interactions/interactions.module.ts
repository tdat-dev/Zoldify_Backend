import { Module } from '@nestjs/common';
import { InteractionsService } from './interactions.service';
import { ProductsModule } from '@catalog/products/products.module';
import { InteractionsController } from './interactions.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Review } from './entities/review.entity';
import { Order } from '@ordering/orders/entities/order.entity';
import { Product } from '@catalog/products/entities/product.entity';
import { User } from '@identity/users/entities/user.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Review, Order, Product, User]),
    ProductsModule,
  ],
  controllers: [InteractionsController],
  providers: [InteractionsService],
})
export class InteractionsModule { }
