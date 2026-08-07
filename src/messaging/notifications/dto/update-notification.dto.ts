import { IsOptional } from 'class-validator';

export class UpdateNotificationDto {
  @IsOptional()
  is_read?: boolean;
}
