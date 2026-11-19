import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateProductDto } from './create-product.dto';
import { UpdateProductDto } from './update-product.dto';
import { GIA_TOI_DA } from '../gia-tran';

/**
 * Giá trần khi đăng/sửa món (báo cáo V2, 18/11).
 *
 * Ô giá app mobile từng nhận "99999999999999999". App đã chặn, nhưng gọi thẳng
 * API thì DTO chỉ có `@Min(1)`, số đó lọt qua validate và vỡ ở cột
 * DECIMAL(15,2) thành 500. Bài này không cần database: chỉ chạy validate.
 */
async function loiGia(
  cls: new () => object,
  price: unknown,
): Promise<string[]> {
  const loi = await validate(
    plainToInstance(cls, { name: 'Ao khoac', price, category_id: 1 }),
  );
  return loi
    .filter((e) => e.property === 'price')
    .flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('Giá trần sản phẩm', () => {
  it('đúng bằng giá trần vẫn hợp lệ', async () => {
    expect(await loiGia(CreateProductDto, GIA_TOI_DA)).toEqual([]);
  });

  it('quá giá trần 1 đồng bị từ chối, kèm câu nói rõ trần', async () => {
    const loi = await loiGia(CreateProductDto, GIA_TOI_DA + 1);
    expect(loi).toEqual(['Giá sản phẩm tối đa 10.000.000.000']);
  });

  it('con số trong báo cáo (17 chữ số) bị từ chối', async () => {
    expect(
      await loiGia(CreateProductDto, Number('99999999999999999')),
    ).not.toEqual([]);
  });

  it('PATCH (UpdateProductDto) cũng chặn, vì kế thừa CreateProductDto', async () => {
    expect(await loiGia(UpdateProductDto, GIA_TOI_DA + 1)).not.toEqual([]);
    expect(await loiGia(UpdateProductDto, 150_000)).toEqual([]);
  });

  it('câu báo lỗi khớp đúng con số của GIA_TOI_DA', () => {
    // Câu lỗi viết tay; đổi trần mà quên đổi câu thì bài này đỏ.
    const nhom = String(GIA_TOI_DA).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    expect(nhom).toBe('10.000.000.000');
  });
});
