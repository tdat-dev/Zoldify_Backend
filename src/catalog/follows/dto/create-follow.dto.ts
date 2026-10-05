import { IsNumber } from 'class-validator';

export class CreateFollowDto {
  @IsNumber({}, { message: 'ID người bán không hợp lệ' })
  following_id: number;
}