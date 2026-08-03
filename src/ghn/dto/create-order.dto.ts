import { IsNotEmpty, IsString, IsNumber, IsArray, ValidateNested, Min } from 'class-validator';
import { Type } from 'class-transformer';

class OrderItemDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsNumber()
  @Min(1)
  quantity: number;

  @IsNumber()
  @Min(0)
  weight: number;

  @IsNumber()
  @Min(0)
  price: number;
}

export class CreateOrderDto {
  @IsString()
  @IsNotEmpty()
  to_name: string;

  @IsString()
  @IsNotEmpty()
  to_phone: string;

  @IsString()
  @IsNotEmpty()
  to_address: string;

  @IsString()
  @IsNotEmpty()
  to_ward_code: string;

  @IsNumber()
  @IsNotEmpty()
  to_district_id: number;

  @IsNumber()
  @Min(0)
  weight: number;

  @IsNumber()
  @Min(0)
  cod_amount: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];
}