import { IsNotEmpty, IsInt, IsString, IsOptional, IsEnum } from 'class-validator';
import { NotificationType } from '../entities/notification.entity';

export class CreateNotificationDto {
  @IsNotEmpty({ message: 'Mã người dùng không được để trống' })
  @IsInt({ message: 'Mã người dùng phải là số nguyên' })
  user_id: number;

  @IsNotEmpty({ message: 'Loại thông báo không được để trống' })
  @IsEnum(NotificationType, { message: 'Loại thông báo không hợp lệ' })
  type: NotificationType;

  @IsNotEmpty({ message: 'Tiêu đề không được để trống' })
  @IsString({ message: 'Tiêu đề phải là chuỗi' })
  title: string;

  @IsNotEmpty({ message: 'Nội dung không được để trống' })
  @IsString({ message: 'Nội dung phải là chuỗi' })
  content: string;

  @IsOptional()
  data?: any;
}
