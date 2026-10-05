import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { CreateCartDto } from './dto/create-cart.dto';
import { UpdateCartDto } from './dto/update-cart.dto';
import { IUser } from '@identity/users/users.interface';
import { InjectRepository } from '@nestjs/typeorm';
import { Cart } from './entities/cart.entity';
import { Repository } from 'typeorm';
import { ProductsService } from '@catalog/products/products.service';
import { ProductStatus } from '@catalog/products/entities/product.entity';

@Injectable()
export class CartService {
  constructor(
    @InjectRepository(Cart)
    private readonly cartRepository: Repository<Cart>,
    private readonly productService: ProductsService,
  ) {}

  /**
   * BÁO LỖI Ở ĐÚNG LÚC NGƯỜI MUA CÒN SỬA ĐƯỢC.
   *
   * Tới 25/09 hàm này kiểm đúng hai thứ: sản phẩm có tồn tại, và người mua
   * không phải người bán. Nó KHÔNG kiểm `status` và KHÔNG kiểm `stock`.
   *
   * `orders.create` chặn hết những thứ đó, nên tiền không bao giờ sai. Nhưng
   * người mua chỉ biết mình không mua được ở màn THANH TOÁN — sau khi đã chọn
   * địa chỉ, chọn phương thức trả tiền, và bấm đặt hàng. Lúc đó họ phải quay
   * ngược về giỏ, đoán xem món nào hỏng, xoá nó đi rồi làm lại từ đầu.
   *
   * Kiểm ở đây thì họ còn đang đứng ở trang sản phẩm và chọn được món khác.
   *
   * Đây KHÔNG phải lớp chặn về tiền — lớp đó vẫn là `orders.create`, nơi có
   * khoá hàng và đọc lại kho dưới khoá. Giỏ hàng đọc kho không khoá, và điều
   * đó đúng: giữa lúc thêm vào giỏ và lúc đặt hàng có thể là vài ngày.
   */
  async create(createCartDto: CreateCartDto, user: IUser) {
    const { product_id, quantity } = createCartDto;
    const product = await this.productService.findOne(+product_id);
    if (!product) {
      throw new NotFoundException('Không tìm thấy sản phẩm');
    }
    if (product.status !== ProductStatus.ACTIVE) {
      throw new BadRequestException(
        `Sản phẩm "${product.name}" hiện không mở bán`,
      );
    }
    if (product.seller?.id === user.id) {
      throw new BadRequestException(
        'Bạn không thể mua sản phẩm của chính mình',
      );
    }

    const existingCart = await this.cartRepository.findOne({
      where: { user: { id: user.id }, product: { id: product_id } },
    });

    // CỘNG DỒN CŨNG PHẢI ĐẾM. Bản cũ làm `existingCart.quantity += quantity`
    // không trần, nên bấm "Thêm vào giỏ" đủ nhiều lần là giỏ vượt kho.
    const dangCo = existingCart?.quantity ?? 0;
    const muonThem = quantity || 1;
    const tong = dangCo + muonThem;
    if (tong > product.stock) {
      throw new BadRequestException(
        `Sản phẩm "${product.name}" chỉ còn ${product.stock} trong kho` +
          (dangCo > 0 ? `, giỏ của bạn đang có ${dangCo}` : ''),
      );
    }

    if (existingCart) {
      existingCart.quantity = tong;
      await this.cartRepository.save(existingCart);
      return this.findOne(existingCart.id, user);
    }
    const saved = await this.cartRepository.save({
      user: { id: user.id },
      product: { id: product_id },
      quantity: quantity || 1,
    });
    return this.findOne(saved.id, user);
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
      result,
    };
  }

  async findOne(id: number, user: IUser) {
    const cart = await this.cartRepository.findOne({
      where: { id, user: { id: user.id } },
      relations: ['user', 'product'],
    });
    if (!cart) {
      throw new NotFoundException('Không tìm thấy giỏ hàng');
    }
    return cart;
  }

  async update(id: number, updateCartDto: UpdateCartDto, user: IUser) {
    const cart = await this.cartRepository.findOne({
      where: { id, user: { id: user.id } },
      // `product` cần để kiểm tồn kho — bản cũ không nạp nên không kiểm được.
      relations: ['product'],
    });
    if (!cart) {
      throw new NotFoundException('Không tìm thấy mặt hàng trong giỏ hàng');
    }

    const { quantity } = updateCartDto;
    const moi = quantity || cart.quantity;

    // Cùng lý do với `create`: đặt thẳng số lượng lớn hơn kho thì người mua
    // chỉ biết ở màn thanh toán. `cart.product` có thể rỗng nếu sản phẩm vừa
    // bị xoá mềm — khi đó bỏ qua kiểm, `orders.create` sẽ báo bằng câu của nó.
    if (cart.product && moi > cart.product.stock) {
      throw new BadRequestException(
        `Sản phẩm "${cart.product.name}" chỉ còn ${cart.product.stock} trong kho`,
      );
    }

    await this.cartRepository.update(id, { quantity: moi });
    return this.findOne(id, user);
  }

  async remove(id: number, user: IUser) {
    const cart = await this.cartRepository.findOne({
      where: { id, user: { id: user.id } },
    });
    if (!cart) {
      throw new NotFoundException('Không tìm thấy mặt hàng trong giỏ hàng');
    }
    await this.cartRepository.delete(id);
    return { message: 'Xóa giỏ hàng thành công' };
  }
}
