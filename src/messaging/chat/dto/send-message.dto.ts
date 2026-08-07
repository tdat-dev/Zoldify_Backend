import { IsNotEmpty, IsString, IsOptional, IsArray } from 'class-validator';

export class SendMessageDto {
  @IsNotEmpty({ message: 'Nội dung tin nhắn không được để trống' })
  @IsString({ message: 'Nội dung tin nhắn phải là chuỗi' })
  content: string;

  @IsOptional()
  @IsArray({ message: 'Ảnh đính kèm phải là mảng' })
  images?: string[];
}
