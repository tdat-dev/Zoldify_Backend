import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateShopDto } from './dto/create-shop.dto';
import { UpdateShopDto } from './dto/update-shop.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Shop, ShopStatus } from './entities/shop.entity';
import { User } from '@identity/users/entities/user.entity';
import { Product, ProductStatus } from '@catalog/products/entities/product.entity';
import { Follow } from '@catalog/follows/entities/follow.entity';
import { OrderItem } from '@ordering/orders/entities/order-item.entity';
import type { IUser } from '@identity/users/users.interface';

@Injectable()
export class ShopService {
  constructor(
    @InjectRepository(Shop)
    private readonly shopRepository: Repository<Shop>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(Follow)
    private readonly followRepository: Repository<Follow>,
    @InjectRepository(OrderItem)
    private readonly orderItemRepository: Repository<OrderItem>,
  ) { }

  async create(createShopDto: CreateShopDto, user: IUser) {
    const existing = await this.shopRepository.findOne({ where: { user: { id: user.id } } });
    if (existing) {
      throw new BadRequestException('Bạn đã có shop rồi');
    }
    const slugExists = await this.shopRepository.findOne({ where: { slug: createShopDto.slug } });
    if (slugExists) {
      throw new BadRequestException('Slug này đã được sử dụng');
    }

    const shop = this.shopRepository.create({
      ...createShopDto,
      user: { id: user.id },
    });

    return this.shopRepository.save(shop);
  }

  async getMyShop(user: IUser) {
    const shop = await this.shopRepository.findOne({
      where: { user: { id: user.id } },
      relations: ['user'],
    });
    if (!shop) {
      throw new NotFoundException('Bạn chưa có shop');
    }
    return shop;
  }

  async update(updateShopDto: UpdateShopDto, user: IUser) {
    const shop = await this.getMyShop(user);

    if (updateShopDto.slug && updateShopDto.slug !== shop.slug) {
      const slugExists = await this.shopRepository.findOne({ where: { slug: updateShopDto.slug } });
      if (slugExists) {
        throw new BadRequestException('Slug này đã được sử dụng');
      }
    }

    await this.shopRepository.update(shop.id, updateShopDto);
    return this.shopRepository.findOne({ where: { id: shop.id } });
  }

  async getShopInfo(sellerId: number) {
    let shop = await this.shopRepository.findOne({
      where: { user: { id: sellerId } },
      relations: ['user'],
    });

    if (!shop) {
      const user = await this.userRepository.findOne({
        where: { id: sellerId },
        select: ['id', 'full_name', 'avatar', 'email', 'created_at'],
      });
      if (!user) throw new BadRequestException('Không tìm thấy shop');
      shop = { name: user.full_name, logo: user.avatar } as any;
    }

    const [productCount, followerCount] = await Promise.all([
      this.productRepository.count({ where: { seller: { id: sellerId }, status: ProductStatus.ACTIVE } }),
      this.followRepository.count({ where: { following: { id: sellerId } } }),
    ]);

    return { ...shop, productCount, followerCount };
  }

  async getShopProducts(sellerId: number, page: number, limit: number) {
    const [result, total] = await this.productRepository.findAndCount({
      where: { seller: { id: sellerId }, status: ProductStatus.ACTIVE },
      relations: ['category'],
      skip: (page - 1) * limit,
      take: limit,
      order: { created_at: 'DESC' },
    });

    return {
      meta: { current: page, pageSize: limit, pages: Math.ceil(total / limit), total },
      result,
    };
  }

  async getSellerOrders(sellerId: number, page: number, limit: number, status?: string) {
    const where: any = { product: { seller: { id: sellerId } } };
    if (status) {
      where.order = { status };
    }

    const [items, total] = await this.orderItemRepository.findAndCount({
      where,
      relations: ['order', 'order.user', 'product'],
      skip: (page - 1) * limit,
      take: limit,
      order: { id: 'DESC' },
    });

    const orderMap = new Map<number, any>();
    for (const item of items) {
      if (!orderMap.has(item.order.id)) {
        orderMap.set(item.order.id, {
          ...item.order,
          items: [],
        });
      }
      orderMap.get(item.order.id).items.push(item);
    }

    const result = Array.from(orderMap.values());

    return {
      meta: { current: page, pageSize: limit, pages: Math.ceil(total / limit), total },
      result,
    };
  }
}
