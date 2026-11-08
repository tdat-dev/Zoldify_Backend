import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ConditionDetailsDto } from './dto/condition-details.dto';
import { DANH_MUC_CO_PIN } from './do-ben';
import { doBenMau } from './do-ben-mau';

/**
 * Độ bền mẫu cho dữ liệu seed (`scripts/dien-do-ben-seed.ts`). Prod có hơn 1
 * triệu tin seed: mẫu sai thì lỗi nhân lên cả triệu trang, và trang sửa tin gửi
 * lại nguyên thẻ nên mẫu không qua DTO là người bán bấm Lưu nhận 400.
 */
const TINH_TRANG = ['new', 'like_new', 'good', 'fair', 'used', 'refurbished'];
const DANH_MUC = [
  ...DANH_MUC_CO_PIN,
  'quan-ao',
  'the-thao',
  'nau-an',
  'phu-kien',
];

describe('doBenMau', () => {
  const moiCap = TINH_TRANG.flatMap((t) =>
    DANH_MUC.flatMap((d) => [1, 2, 3, 7, 1099999].map((id) => ({ id, t, d }))),
  );

  it('cùng đầu vào thì cùng kết quả, để chạy lại và đường lùi so khớp được', () => {
    for (const { id, t, d } of moiCap) {
      expect(doBenMau(id, t, d)).toEqual(doBenMau(id, t, d));
    }
  });

  it('mọi mẫu qua được DTO, không có trường lạ', async () => {
    for (const { id, t, d } of moiCap) {
      const loi = await validate(
        plainToInstance(ConditionDetailsDto, doBenMau(id, t, d)),
        { whitelist: true, forbidNonWhitelisted: true },
      );
      expect(loi).toEqual([]);
    }
  });

  it('chỉ hàng có pin mới có pin', () => {
    for (const { id, t, d } of moiCap) {
      const coPin = doBenMau(id, t, d).battery_health !== undefined;
      expect(coPin).toBe(DANH_MUC_CO_PIN.includes(d));
    }
  });

  it('hàng mới: chưa dùng, không khuyết điểm, không sửa, pin 100%', () => {
    for (const d of DANH_MUC) {
      const m = doBenMau(5, 'new', d);
      expect(m.used_months).toBe(0);
      expect(m.defects).toBeUndefined();
      expect(m.repaired).toBe(false);
      if (DANH_MUC_CO_PIN.includes(d)) expect(m.battery_health).toBe(100);
    }
  });

  it('tình trạng càng cũ thì pin không cao hơn mức trên', () => {
    const thuTu = ['like_new', 'good', 'fair', 'used'];
    for (let id = 1; id < 200; id++) {
      const pin = thuTu.map(
        (t) => doBenMau(id, t, 'dien-thoai').battery_health!,
      );
      for (let i = 1; i < pin.length; i++) {
        expect(pin[i]).toBeLessThanOrEqual(pin[i - 1]);
      }
    }
  });

  it('tân trang: đã sửa và nói rõ sửa gì', () => {
    const m = doBenMau(9, 'refurbished', 'laptop');
    expect(m.repaired).toBe(true);
    expect(m.repair_note).toBeTruthy();
  });
});
