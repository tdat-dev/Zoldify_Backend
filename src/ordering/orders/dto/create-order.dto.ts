import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsEnum,
  IsNumber,
  Min,
  IsInt,
  IsArray,
  ArrayMaxSize,
  ArrayNotEmpty,
  MaxLength,
} from 'class-validator';
import { PaymentMethod } from '@common/enums/payment.enum';

/**
 * Trần độ dài lấy theo cột của bảng `orders` (varchar(100), varchar(20)).
 * Vượt trần mà không chặn ở đây thì MySQL strict mode ném "Data too long"
 * thành 500, SAU khi đơn đã đi qua cả vòng khoá kho. Hai cột `text`
 * (shipping_address, note) không lỗi gì, nên trần của chúng là trần nghiệp
 * vụ: ghi chú 60KB thì nằm trên mọi màn đơn hàng và mọi thông báo. Đo bằng
 * `dat-hang-gioi-han.spec.ts`.
 *
 * Địa chỉ 500 chứ không 255 (review 27/10): web và app GHÉP số nhà, đường
 * (ô nhập tới 255) với tên phường, quận, tỉnh (tới 100 mỗi phần) vào trường
 * này. Trần 255 từ chối oan một địa chỉ thật có tên đường dài.
 */
export class CreateOrderDto {
  @IsNotEmpty({ message: 'Địa chỉ giao hàng không được để trống' })
  @IsString({ message: 'Địa chỉ giao hàng phải là chuỗi' })
  @MaxLength(500, { message: 'Địa chỉ giao hàng tối đa 500 ký tự' })
  shipping_address: string;

  @IsNotEmpty({ message: 'Tên người nhận không được để trống' })
  @IsString({ message: 'Tên người nhận phải là chuỗi' })
  @MaxLength(100, { message: 'Tên người nhận tối đa 100 ký tự' })
  receiver_name: string;

  @IsNotEmpty({ message: 'Số điện thoại không được để trống' })
  @IsString({ message: 'Số điện thoại phải là chuỗi' })
  @MaxLength(20, { message: 'Số điện thoại tối đa 20 ký tự' })
  receiver_phone: string;

  @IsOptional()
  @IsString({ message: 'Tỉnh/Thành phố phải là chuỗi' })
  @MaxLength(100, { message: 'Tỉnh/Thành phố tối đa 100 ký tự' })
  province?: string;

  @IsOptional()
  @IsString({ message: 'Quận/Huyện phải là chuỗi' })
  @MaxLength(100, { message: 'Quận/Huyện tối đa 100 ký tự' })
  district?: string;

  @IsOptional()
  @IsString({ message: 'Ghi chú phải là chuỗi' })
  @MaxLength(500, { message: 'Ghi chú tối đa 500 ký tự' })
  note?: string;

  @IsOptional()
  @IsEnum(PaymentMethod, { message: 'Phương thức thanh toán không hợp lệ' })
  payment_method?: PaymentMethod;

  @IsOptional()
  @IsNumber()
  @Min(0)
  shipping_fee?: number;

  /**
   * BẮT BUỘC từ rà soát 26/10. Trước đó hai trường này `@IsOptional`: bỏ
   * trống là khối tính phí ship không chạy, đơn tạo với phí ship 0 và người
   * bán không tạo nổi vận đơn GHN lúc xác nhận. Web (`checkout/page.tsx`) và
   * mobile (`checkout-screen.tsx`) đều đã khoá nút đặt hàng khi thiếu chúng.
   */
  @IsNotEmpty({ message: 'Thiếu quận/huyện giao hàng (GHN)' })
  @IsInt({ message: 'Mã quận/huyện GHN phải là số nguyên' })
  @Min(1, { message: 'Thiếu quận/huyện giao hàng (GHN)' })
  ghn_district_id: number;

  @IsNotEmpty({ message: 'Thiếu phường/xã giao hàng (GHN)' })
  @IsString({ message: 'Mã phường/xã GHN phải là chuỗi' })
  @MaxLength(20, { message: 'Mã phường/xã GHN tối đa 20 ký tự' })
  ghn_ward_code: string;

  // Không gửi = cả giỏ. Gửi thì phải có ít nhất một món: mảng rỗng từng bị
  // hiểu thành "cả giỏ" (orders.service kiểm `length > 0`), tức người dùng
  // bỏ chọn hết lại đặt toàn bộ giỏ. Trần 50: mỗi phần tử là một tham số của
  // câu `IN (...)`, và không giỏ thật nào gần tới đó.
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty({ message: 'Chọn ít nhất một món để đặt hàng' })
  @ArrayMaxSize(50, { message: 'Mỗi đơn tối đa 50 món trong giỏ' })
  @IsInt({ each: true })
  @Min(1, { each: true })
  cart_item_ids?: number[];
}
