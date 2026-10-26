import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { CreateCartDto } from './dto/create-cart.dto';
import { UpdateCartDto } from './dto/update-cart.dto';
import { IUser } from '@identity/users/users.interface';
import { InjectRepository } from '@nestjs/typeorm';
import { Cart } from './entities/cart.entity';
import { QueryFailedError, Repository } from 'typeorm';
import {
  Product,
  ProductStatus,
} from '@catalog/products/entities/product.entity';

/** Mã lỗi MySQL khi đụng ràng buộc UNIQUE. Cùng hằng số mà `orders.service.ts` dùng. */
const ER_DUP_ENTRY = 1062;

function laLoiTrungKhoa(err: unknown): boolean {
  if (!(err instanceof QueryFailedError)) return false;
  const driverError = err.driverError as { errno?: number } | undefined;
  return driverError?.errno === ER_DUP_ENTRY;
}

/**
 * Số vòng "thử cộng, không có dòng thì chèn" tối đa. Vòng 2 chỉ xảy ra khi lần
 * chèn đụng `unique_user_product` vì một request khác vừa chèn trước; lúc đó
 * dòng đã có và lần cộng ở vòng 2 sẽ ăn. Vòng 3 là dư phòng cho trường hợp
 * dòng vừa chèn lại bị xoá ngay giữa hai bước.
 */
const SO_VONG_THEM = 3;

@Injectable()
export class CartService {
  constructor(
    @InjectRepository(Cart)
    private readonly cartRepository: Repository<Cart>,
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
   *
   * CỘNG DỒN PHẢI LÀ MỘT CÂU SQL (26/10). Bản trước đọc dòng giỏ rồi ghi
   * `quantity = cũ + mới`: đo trên MySQL thật, 10 lần bấm "Thêm" cùng lúc vào
   * dòng đang có 1 để lại 2 chứ không phải 11, và cả 10 lần đều báo thành công.
   * Giờ phép cộng và phép so với kho nằm chung một câu UPDATE có điều kiện, nên
   * MySQL tự xếp hàng các lần cộng trên khoá dòng của nó.
   */
  async create(createCartDto: CreateCartDto, user: IUser) {
    const { product_id } = createCartDto;
    const muonThem = createCartDto.quantity || 1;

    const product = await this.docSanPhamTuoi(+product_id);
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
    if (muonThem > product.stock) {
      throw new BadRequestException(
        `Sản phẩm "${product.name}" chỉ còn ${product.stock} trong kho`,
      );
    }

    for (let vong = 0; vong < SO_VONG_THEM; vong++) {
      if (await this.congCoTran(user.id, product_id, muonThem)) {
        return this.dongCuaSanPham(product_id, user);
      }

      // Cộng không ăn: hoặc chưa có dòng, hoặc có rồi mà cộng thêm thì vượt kho.
      const hienTai = await this.dongVaKho(user.id, product_id);
      if (hienTai) {
        // Dòng có rồi mà cộng vẫn còn chỗ: phép cộng vừa trượt chỉ vì dòng do
        // một request song song chèn chưa kịp commit lúc ta UPDATE (thấy 0
        // dòng), rồi commit ngay trước lúc ta đọc lại. CI 26/10 bắt đúng ca
        // này: 5 lần thêm đầu cùng lúc, kho 50, một lần nhận nhầm "chỉ thêm
        // được 49 cái nữa". Còn chỗ thì quay lại cộng, chỉ báo khi thật vượt.
        if (hienTai.quantity + muonThem <= hienTai.stock) continue;
        throw new BadRequestException(
          this.cauVuotKho(hienTai.quantity, hienTai.stock),
        );
      }

      try {
        await this.cartRepository.insert({
          user: { id: user.id },
          product: { id: product_id },
          quantity: muonThem,
        });
        return this.dongCuaSanPham(product_id, user);
      } catch (err) {
        // Lần thêm ĐẦU TIÊN bấm cùng lúc: cả năm request cùng thấy "chưa có
        // dòng", cùng chèn, bốn cái đụng `unique_user_product`. Bản trước để
        // lỗi đó thành 500. Giờ quay lại vòng sau: dòng đã có, phép cộng ăn.
        if (!laLoiTrungKhoa(err)) throw err;
      }
    }
    throw new ConflictException(
      'Giỏ hàng đang được cập nhật ở nơi khác, vui lòng thử lại',
    );
  }

  /**
   * HẠ DÒNG VƯỢT KHO NGAY LÚC ĐỌC GIỎ (26/10).
   *
   * Kho giảm SAU khi người mua bỏ hàng vào giỏ (người khác mua mất, người bán
   * sửa kho) thì không có ai đụng tới dòng giỏ. Ảnh chụp giỏ web 26/10: ô số
   * lượng hiện 7, kho còn 4, thành tiền tính theo 4. Hạ luôn trong database để
   * mọi client (web, app, màn thanh toán) cùng thấy một con số, và trả kèm
   * `quantity_adjusted_from` để client báo cho người mua biết vì sao số đổi.
   *
   * KHÔNG hạ dòng hết hàng (kho 0), ngừng bán, hay sản phẩm đã xoá: hạ về 0 là
   * xoá mất ý định mua của người ta, mà hàng có thể về lại. Client hiện các
   * dòng đó là "hết hàng" và loại khỏi tổng tiền.
   */
  async findAll(user: IUser) {
    const [result, totalItems] = await this.cartRepository.findAndCount({
      where: { user: { id: user.id } },
      relations: ['product'],
    });

    for (const dong of result) {
      const sp = dong.product;
      if (
        !sp ||
        sp.status !== ProductStatus.ACTIVE ||
        sp.stock <= 0 ||
        dong.quantity <= sp.stock
      ) {
        continue;
      }
      const cu = dong.quantity;
      // Điều kiện `quantity = cu`: nếu giữa lúc đọc và lúc ghi người mua vừa
      // sửa số lượng ở tab khác thì không ghi đè số mới của họ.
      const kq = await this.cartRepository.update(
        { id: dong.id, quantity: cu },
        { quantity: sp.stock },
      );
      if (!kq.affected) continue;
      dong.quantity = sp.stock;
      dong.quantity_adjusted_from = cu;
    }

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
    // Kho ở đây đọc qua quan hệ `product` của chính câu SELECT này, tức là đọc
    // thẳng database, không qua cache 60s của ProductsService như `create` cũ.
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

  /**
   * Đọc sản phẩm THẲNG từ database, không qua `ProductsService.findOne`.
   *
   * `findOne` cache chi tiết sản phẩm ~60s trong Redis cho trang công khai.
   * Đúng cho trang sản phẩm, sai cho phép kiểm kho: đo trên MySQL thật, kho
   * vừa hạ từ 5 xuống 1 mà cache còn ghi 5, giỏ vẫn nhận thêm. Trang chi tiết
   * cũng tăng view_count, nên bấm "Thêm vào giỏ" còn đếm nhầm một lượt xem.
   */
  private docSanPhamTuoi(id: number) {
    return this.cartRepository.manager.findOne(Product, {
      where: { id },
      relations: { seller: true },
      select: {
        id: true,
        name: true,
        stock: true,
        status: true,
        seller: { id: true },
      },
    });
  }

  /**
   * Cộng `them` vào dòng giỏ đang có, CHỈ KHI tổng không vượt kho hiện tại.
   * Trả false khi không có dòng nào được cộng (chưa có dòng, hoặc sẽ vượt kho).
   *
   * Câu con đọc `products` chứ không đọc `carts`, nên MySQL không báo lỗi 1093
   * ("không được đọc chính bảng đang UPDATE"). Sản phẩm đã xoá mềm cho câu con
   * ra NULL, phép so ra NULL, dòng không được cộng.
   */
  private async congCoTran(
    userId: number,
    productId: number,
    them: number,
  ): Promise<boolean> {
    const kq = await this.cartRepository
      .createQueryBuilder()
      .update(Cart)
      .set({ quantity: () => 'quantity + :them' })
      .where('user_id = :userId AND product_id = :productId')
      .andWhere(
        'quantity + :them <= (SELECT p.stock FROM products p WHERE p.id = :productId AND p.deleted_at IS NULL)',
      )
      .setParameters({ them, userId, productId })
      .execute();
    return (kq.affected ?? 0) > 0;
  }

  /** Số đang có trong dòng giỏ và kho hiện tại, đọc trong cùng một câu. */
  private async dongVaKho(
    userId: number,
    productId: number,
  ): Promise<{ quantity: number; stock: number } | undefined> {
    const rows = await this.cartRepository.manager.query<
      Array<{ quantity: number; stock: number }>
    >(
      `SELECT c.quantity, p.stock
         FROM carts c JOIN products p ON p.id = c.product_id
        WHERE c.user_id = ? AND c.product_id = ?`,
      [userId, productId],
    );
    if (!rows[0]) return undefined;
    return { quantity: Number(rows[0].quantity), stock: Number(rows[0].stock) };
  }

  /**
   * Câu từ chối khi dòng giỏ đã có hàng. Nói rõ giỏ ĐANG có bao nhiêu: câu cũ
   * chỉ nói "chỉ còn 4 trong kho", người mua không biết là do món đã nằm sẵn
   * trong giỏ, tưởng bấm "Thêm" là được thêm một dòng mới.
   */
  private cauVuotKho(dangCo: number, kho: number): string {
    if (dangCo === kho) {
      return `Giỏ của bạn đã có ${dangCo} cái, bằng số còn trong kho`;
    }
    if (dangCo > kho) {
      return `Giỏ của bạn đã có ${dangCo} cái, nhiều hơn số còn trong kho (${kho})`;
    }
    return `Giỏ của bạn đã có ${dangCo} cái, kho còn ${kho}, chỉ thêm được ${kho - dangCo} cái nữa`;
  }

  private async dongCuaSanPham(productId: number, user: IUser) {
    const dong = await this.cartRepository.findOne({
      where: { user: { id: user.id }, product: { id: productId } },
      select: { id: true },
    });
    if (!dong) {
      throw new NotFoundException('Không tìm thấy giỏ hàng');
    }
    return this.findOne(dong.id, user);
  }
}
