import { BadRequestException, PipeTransform } from '@nestjs/common';

/**
 * Tham số query KIỂU SỐ, KHÔNG BẮT BUỘC: bỏ trống thì `undefined`, có mà
 * không phải số thì 400.
 *
 * VÌ SAO KHÔNG DÙNG `new ParseIntPipe({ optional: true })`. Pipe đó chỉ bỏ
 * qua `undefined`/`null`; chuỗi rỗng (`?category_id=`, form gửi nguyên ô
 * trống) bị nó coi là số hỏng và trả 400, trong khi tới 26/10 API vẫn coi ô
 * trống là "không lọc". Đổi hành vi đó là làm vỡ client đang chạy.
 *
 * VÌ SAO PHẢI CHẶN. Controller cũ làm `Number(qs.price_min)`: chữ thành NaN,
 * NaN đi thẳng vào SQL (`price >= NaN`, `BETWEEN NaN AND ...`), MySQL từ
 * chối và người dùng nhận 500 cho lỗi của chính họ (rà soát 26/10 mục 9).
 */
export class SoTuyChonPipe implements PipeTransform<
  unknown,
  number | undefined
> {
  constructor(
    private readonly ten: string,
    private readonly chiSoNguyen = false,
  ) {}

  transform(value: unknown): number | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    // Query string luôn là chuỗi; mảng (`?price_min=1&price_min=2`) hay
    // object thì không phải một con số, từ chối luôn.
    if (typeof value !== 'string' && typeof value !== 'number') {
      throw new BadRequestException(`${this.ten} phải là một số`);
    }
    const chuoi = String(value).trim();
    const hopLe = this.chiSoNguyen
      ? /^-?\d+$/.test(chuoi)
      : /^-?\d+(\.\d+)?$/.test(chuoi);
    if (!hopLe) {
      throw new BadRequestException(
        `${this.ten} phải là ${this.chiSoNguyen ? 'số nguyên' : 'số'}, nhận được "${chuoi}"`,
      );
    }
    return Number(chuoi);
  }
}
