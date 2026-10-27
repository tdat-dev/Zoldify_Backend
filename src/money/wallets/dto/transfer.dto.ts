import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Chuyển tiền giữa hai ví.
 *
 * Bản cũ chỉ `@IsNumber`: 1000.7 đi qua rồi bị `Math.round` lặng lẽ làm tròn
 * trong service, không có trần trên, `to_user_id` âm hay lẻ cũng qua, và
 * `note` không giới hạn mà nằm nguyên trong metadata sổ cái. Đo bằng
 * `chuyen-tien-nguoi-nhan.spec.ts`.
 */
export class TransferDto {
  @IsNotEmpty()
  @IsInt({ message: 'Mã người nhận phải là số nguyên' })
  @Min(1, { message: 'Mã người nhận không hợp lệ' })
  to_user_id: number;

  // Đồng là đơn vị nhỏ nhất: số lẻ không có nghĩa. Trần 1 tỷ một lần chuyển:
  // gõ nhầm thêm ba số 0 thì bị chặn ở cửa thay vì đi thẳng vào sổ cái.
  @IsInt({ message: 'Số tiền phải là số nguyên (đồng)' })
  @Min(1000, { message: 'Số tiền chuyển tối thiểu 1.000đ' })
  @Max(1_000_000_000, { message: 'Số tiền chuyển tối đa 1.000.000.000đ' })
  amount: number;

  @IsOptional()
  @IsString()
  @MaxLength(255, { message: 'Ghi chú tối đa 255 ký tự' })
  note?: string;
}
