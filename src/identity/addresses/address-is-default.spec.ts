import { DataSource } from 'typeorm';
import { Address } from './entities/address.entity';

/**
 * `is_default` phải ra API là boolean (lỗi H-04, test E2E 30/09).
 *
 * Cột là `tinyint(1)`, driver mysql2 trả về số 0/1. Không có transformer thì
 * `GET /addresses` trả `"is_default": 1`; màn Sửa địa chỉ của app lấy nguyên
 * giá trị đó gửi lại trong PATCH, và `UpdateAddressDto` có `@IsBoolean()` nên
 * server trả 400 "is_default must be a boolean value". Kết quả: KHÔNG ai sửa
 * được địa chỉ nào, và app nuốt lỗi nên người dùng chỉ thấy bấm không ăn.
 *
 * Không cần database: dựng metadata offline rồi kiểm transformer của cột.
 */
describe('Address.is_default: tinyint <-> boolean', () => {
  let transformer: {
    from: (v: unknown) => unknown;
    to: (v: unknown) => unknown;
  };

  beforeAll(async () => {
    const ds = new DataSource({
      type: 'mysql',
      database: 'offline',
      entities: [__dirname + '/../../**/*.entity.ts'],
    });
    // buildMetadatas là protected; gọi thẳng để có metadata mà không kết nối DB.
    await (
      ds as unknown as { buildMetadatas(): Promise<void> }
    ).buildMetadatas();
    const col = ds
      .getMetadata(Address)
      .findColumnWithPropertyName('is_default');
    transformer = col?.transformer as typeof transformer;
  });

  it('có transformer', () => {
    expect(transformer).toBeDefined();
  });

  it('đọc từ DB: 1 -> true, 0 -> false, "1" -> true', () => {
    expect(transformer.from(1)).toBe(true);
    expect(transformer.from(0)).toBe(false);
    expect(transformer.from('1')).toBe(true);
  });

  it('ghi xuống DB: true -> 1, false -> 0', () => {
    expect(transformer.to(true)).toBe(1);
    expect(transformer.to(false)).toBe(0);
  });

  it('giữ nguyên null/undefined (cột chưa được chọn, hoặc điều kiện where)', () => {
    expect(transformer.from(null)).toBeNull();
    expect(transformer.to(undefined)).toBeUndefined();
  });
});
