import { Type } from 'class-transformer';
import { IsInt } from 'class-validator';

export class GetUsersParamsDto {
  @IsInt()
  @Type(() => Number)
  id: number;
}