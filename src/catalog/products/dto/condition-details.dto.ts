import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Thẻ "Độ bền", xem `../do-ben.ts`. Mọi trường tuỳ chọn. Trần số lấy theo đời
 * thật của món đồ cũ chứ không theo giới hạn cột: 50 năm sử dụng hay bảo hành
 * 10 năm đã là gõ nhầm, chặn ở đây đỡ hiện con số vô lý trên trang công khai.
 */
export class ConditionDetailsDto {
  @IsOptional()
  @IsInt({ message: 'Pin phải là số nguyên phần trăm' })
  @Min(0, { message: 'Pin không được âm' })
  @Max(100, { message: 'Pin tối đa 100%' })
  battery_health?: number;

  @IsOptional()
  @IsInt({ message: 'Số tháng đã dùng phải là số nguyên' })
  @Min(0, { message: 'Số tháng đã dùng không được âm' })
  @Max(600, { message: 'Số tháng đã dùng tối đa 600 (50 năm)' })
  used_months?: number;

  @IsOptional()
  @IsInt({ message: 'Số tháng bảo hành phải là số nguyên' })
  @Min(0, { message: 'Số tháng bảo hành không được âm' })
  @Max(120, { message: 'Bảo hành còn lại tối đa 120 tháng' })
  warranty_months?: number;

  @IsOptional()
  @IsArray({ message: 'Khuyết điểm phải là danh sách' })
  @ArrayMaxSize(10, { message: 'Tối đa 10 khuyết điểm' })
  @IsString({ each: true, message: 'Mỗi khuyết điểm phải là chuỗi' })
  @MaxLength(100, {
    each: true,
    message: 'Mỗi khuyết điểm tối đa 100 ký tự',
  })
  defects?: string[];

  @IsOptional()
  @IsArray({ message: 'Phụ kiện phải là danh sách' })
  @ArrayMaxSize(10, { message: 'Tối đa 10 phụ kiện' })
  @IsString({ each: true, message: 'Mỗi phụ kiện phải là chuỗi' })
  @MaxLength(60, { each: true, message: 'Mỗi phụ kiện tối đa 60 ký tự' })
  accessories?: string[];

  @IsOptional()
  @IsBoolean({ message: 'Đã sửa chữa phải là đúng hoặc sai' })
  repaired?: boolean;

  @IsOptional()
  @IsString({ message: 'Ghi chú sửa chữa phải là chuỗi' })
  @MaxLength(200, { message: 'Ghi chú sửa chữa tối đa 200 ký tự' })
  repair_note?: string;
}
