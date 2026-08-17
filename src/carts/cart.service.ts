import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { CreateCartDto } from './dto/create-cart.dto';
import { UpdateCartDto } from './dto/update-cart.dto';
import { IUser } from 'src/users/users.interface';
import { InjectRepository } from '@nestjs/typeorm';
import { Cart } from './entities/cart.entity';
import { Repository } from 'typeorm';
import { ProductsService } from 'src/products/products.service';

@Injectable()
export class CartService {
  constructor(
    @InjectRepository(Cart)
    private readonly cartRepository: Repository<Cart>,
    private readonly productService: ProductsService,
  ) { }

  async create(createCartDto: CreateCartDto, user: IUser) {
    const { product_id, quantity } = createCartDto;
    const product = await this.productService.findOne(+product_id);
    if (!product) {
      throw new NotFoundException('Không tìm thấy sản phẩm')
    }
    if (product.status !== 'active') {
      throw new BadRequestException('Sản phẩm này hiện không khả dụng');
    }
    if (product.stock < (quantity || 1)) {
      throw new BadRequestException('Sản phẩm đã hết hàng hoặc không đủ số lượng');
    }
    if (product.seller?.id === user.id) {
      throw new BadRequestException('Bạn không thể mua sản phẩm của chính mình');
    }
    const existingCart = await this.cartRepository.findOne({
      where: { user: { id: user.id }, product: { id: product_id } }
    });
    if (existingCart) {
      existingCart.quantity += quantity || 1;
      await this.cartRepository.save(existingCart);
      return await this.findOne(existingCart.id, user);
    }
    const saved = await this.cartRepository.save({
      user: { id: user.id },
      product: { id: product_id },
      quantity: quantity || 1
    })
    return await this.findOne(saved.id, user);
  }

  async findAll(user: IUser) {
    const [result, totalItems] = await this.cartRepository.findAndCount({
      where: { user: { id: user.id } },
      relations: ['product'],
    });

    return {
      meta: {
        current: 1,
        pageSize: totalItems,
        pages: 1,
        total: totalItems,
      },
      result
    };
  }

  async findOne(id: number, user: IUser) {
    const cart = await this.cartRepository.findOne({
      where: { id, user: { id: user.id } },
      relations: ['user', 'product'],
    })
    if (!cart) {
      throw new NotFoundException('Không tìm thấy giỏ hàng')
    }
    return cart;
  }

  async update(id: number, updateCartDto: UpdateCartDto, user: IUser) {
    const cart = await this.cartRepository.findOne({ where: { id, user: { id: user.id } } })
    if (!cart) {
      throw new NotFoundException('Không tìm thấy mặt hàng trong giỏ hàng')
    }
    const { quantity } = updateCartDto;
    await this.cartRepository.update(id, { quantity: quantity || cart.quantity });
    return await this.findOne(id, user);
  }

  async remove(id: number, user: IUser) {
    const cart = await this.cartRepository.findOne({ where: { id, user: { id: user.id } } })
    if (!cart) {
      throw new NotFoundException('Không tìm thấy mặt hàng trong giỏ hàng')
    }
    await this.cartRepository.delete(id);
    return { message: 'Xóa giỏ hàng thành công' };
  }
}
