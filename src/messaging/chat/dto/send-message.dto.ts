import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * Trần cho một tin nhắn. Bản trước chỉ có IsNotEmpty/IsString/IsArray, và qua
 * socket thì không chạy cả mấy cái đó (ValidationPipe toàn cục chỉ áp cho
 * HTTP). Nội dung 1 MB được lưu, phát cho người nhận, rồi chép nguyên vào thông
 * báo đẩy. 2000 ký tự dư cho một tin chat mua bán; 10 ảnh khớp số ảnh tối đa
 * của một bài đăng.
 */
export const TIN_NHAN_TOI_DA = 2000;
export const ANH_TOI_DA = 10;

export class SendMessageDto {
  @IsNotEmpty({ message: 'Nội dung tin nhắn không được để trống' })
  @IsString({ message: 'Nội dung tin nhắn phải là chuỗi' })
  @MaxLength(TIN_NHAN_TOI_DA, {
    message: `Tin nhắn tối đa ${TIN_NHAN_TOI_DA} ký tự`,
  })
  content: string;

  @IsOptional()
  @IsArray({ message: 'Ảnh đính kèm phải là mảng' })
  @ArrayMaxSize(ANH_TOI_DA, { message: `Tối đa ${ANH_TOI_DA} ảnh` })
  @IsString({ each: true, message: 'Mỗi ảnh phải là một URL dạng chuỗi' })
  @MaxLength(500, { each: true, message: 'URL ảnh quá dài' })
  images?: string[];
}

/** Payload của sự kiện socket send_message: thêm id hội thoại. */
export class SendMessageSocketDto extends SendMessageDto {
  @IsInt({ message: 'conversationId phải là số nguyên' })
  conversationId: number;
}
