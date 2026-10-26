import { IsIn } from 'class-validator';

/**
 * Body của PATCH /orders/:id/sim-ghn. Bản trước nhận `{ phase }` là kiểu TS
 * trần nên ValidationPipe không kiểm gì: phase lạ rơi xuống nhánh "delivered"
 * vì nhánh đó là phần còn lại sau `if (phase === 'shipping')`.
 */
export class SimGhnDto {
  @IsIn(['shipping', 'delivered'], {
    message: 'phase phải là shipping hoặc delivered',
  })
  phase: 'shipping' | 'delivered';
}
