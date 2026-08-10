import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';

/** Khoá trong bảng settings giữ tỉ lệ phí sàn, đơn vị phần trăm */
const FEE_KEY = 'platform_fee_percent';

/** Không đọc được thì coi như không thu phí, KHÔNG đoán một con số */
const DEFAULT_PERCENT = 0;

@Injectable()
export class PlatformFeeService {
  private readonly logger = new Logger(PlatformFeeService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Đọc tỉ lệ phí sàn từ bảng settings bằng truy vấn thẳng, KHÔNG import
   * SettingsService.
   *
   * `settings` là bảng cấu hình dùng chung, nhưng `SettingsService` thuộc
   * context `ops`, mà luật phụ thuộc không cho `money` trỏ sang `ops` — chiều
   * đúng là `ops` gọi `money`. Import vào đây sẽ làm hỏng ranh giới và CI đỏ.
   * Đọc một dòng cấu hình không phải là phụ thuộc nghiệp vụ, nên truy vấn
   * thẳng là cách giữ đúng cả hai điều.
   */
  async getPercent(manager?: EntityManager): Promise<number> {
    const em = manager ?? this.dataSource.manager;
    const rows: { value: string }[] = await em.query(
      'SELECT value FROM settings WHERE `key` = ? LIMIT 1',
      [FEE_KEY],
    );

    if (!rows.length) {
      this.logger.warn(
        `Không có ${FEE_KEY} trong bảng settings, tạm coi phí sàn là 0%`,
      );
      return DEFAULT_PERCENT;
    }

    const parsed = Number(rows[0].value);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
      this.logger.warn(
        `${FEE_KEY} = "${rows[0].value}" không hợp lệ, tạm coi phí sàn là 0%`,
      );
      return DEFAULT_PERCENT;
    }
    return parsed;
  }

  /**
   * Tính phí trên một khoản tiền.
   *
   * Làm tròn XUỐNG, tức phần lẻ nghiêng về phía người bán. Tiền Việt không có
   * đơn vị nhỏ hơn đồng nên buộc phải bỏ phần lẻ, và khi phải chọn thì để sàn
   * chịu thiệt vài đồng dễ giải thích hơn là trừ thừa của người bán.
   *
   * Tính bằng điểm cơ bản để hỗ trợ tỉ lệ lẻ như 5,5% mà không đụng số thực:
   * 5,5% -> 550 điểm cơ bản -> amount * 550 / 10000.
   */
  computeFee(amount: bigint, percent: number): bigint {
    if (amount <= 0n || percent <= 0) return 0n;
    const basisPoints = BigInt(Math.round(percent * 100));
    return (amount * basisPoints) / 10_000n;
  }
}
