import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tách phí ship ra khỏi tiền hàng trong bảng `escrows`.
 *
 * VẤN ĐỀ ĐANG SỬA. Người mua trả `orders.final_amount` = tiền hàng + phí ship,
 * và cả số đó chảy vào `platform/escrow_hold`. Nhưng `createOrderEscrows` chỉ
 * ghi tiền hàng (`SUM(order_items.subtotal)`), nên phần phí ship không có đường
 * nào ra khỏi két:
 *
 *   · giải ngân  -> người bán nhận `escrow.amount`, không có phí ship
 *   · hoàn tiền  -> người mua nhận `escrow.amount`, MẤT đúng phần phí ship
 *
 * Đo được bằng TC-P0-04a/b (`ky-quy-khong-co-tien.spec.ts`): huỷ một đơn đã trả
 * 530.000 thì người mua chỉ nhận lại 500.000, và `escrow_hold` đọng 30.000
 * vĩnh viễn — mỗi đơn một ít.
 *
 * VÌ SAO CỘT RIÊNG CHỨ KHÔNG CỘNG VÀO `amount`. Phí sàn tính trên `amount`, mà
 * theo quyết định của trưởng nhóm (24/09): *"Tiền ship bên mua bán họ tự trả
 * chứ sàn không thu tiền"*. Sàn cầm hộ rồi chuyển đi, không ăn phần trăm trên
 * đó. Gộp hai con số là mất đúng ranh giới ấy, và không còn tách ngược ra được.
 *
 * DỮ LIỆU CŨ. Các khoản ký quỹ có trước migration này để `shipping_amount = 0`.
 * Chúng vẫn kẹt phần ship trong két như trước — migration KHÔNG tự đoán và tự
 * chia lại, vì đoán sai trên dữ liệu tiền là thứ không sửa lại được. Nếu
 * production đã có đơn thật thì phải đối soát tay:
 *
 *   SELECT o.id, o.shipping_fee
 *   FROM orders o JOIN escrows e ON e.order_id = o.id
 *   WHERE o.shipping_fee > 0 AND e.shipping_amount = 0;
 */
export class AddEscrowShippingAmount1787500000000
  implements MigrationInterface
{
  name = 'AddEscrowShippingAmount1787500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`escrows\` ADD \`shipping_amount\` decimal(15,2) NOT NULL DEFAULT '0.00'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`escrows\` DROP COLUMN \`shipping_amount\``,
    );
  }
}
