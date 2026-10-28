import { Logger as NestLogger } from '@nestjs/common';
import type { Logger as TypeOrmLogger } from 'typeorm';

/**
 * Ngưỡng mặc định coi một câu SQL là "chậm".
 *
 * 1 giây chứ không thấp hơn: đo trên zoldify_1mb (scripts/explain-1m.ts), mọi
 * câu danh sách nóng sau khi có index chạy 2-25ms, câu tệ nhất (job tự chốt
 * vận đơn) ~90ms. Thứ vượt 1s là thứ thật sự có vấn đề, ví dụ sắp theo
 * sold_count khi thiếu index đo được 1,7-1,9s. Đặt thấp hơn thì log đầy những
 * lần MySQL khựng vì đĩa, và người đọc học cách bỏ qua dòng này.
 */
const NGUONG_MAC_DINH_MS = 1000;

/** Dài hơn thế thì cắt: câu `IN (...)` hàng nghìn id thành một dòng log vài trăm KB. */
const DAI_TOI_DA = 500;

const rutGon = (sql: string): string => {
  const mot = sql.replace(/\s+/g, ' ').trim();
  return mot.length > DAI_TOI_DA
    ? `${mot.slice(0, DAI_TOI_DA)}… (+${mot.length - DAI_TOI_DA} ký tự)`
    : mot;
};

/**
 * Logger TypeORM chỉ làm hai việc mà logger mặc định làm khi `logging` tắt:
 * báo câu chậm và báo migration. Mọi thứ khác im lặng, đúng như trước.
 *
 * VÌ SAO KHÔNG DÙNG LOGGER MẶC ĐỊNH. `AdvancedConsoleLogger` in câu chậm KÈM
 * THAM SỐ ra console.warn: với UPDATE users đó là email, hash mật khẩu, refresh
 * token, nằm thẳng trong `docker compose logs`. Và nó đi vòng qua JsonLogger,
 * nên `log:summary` không đọc được. Ở đây chỉ ghi số mili-giây và câu SQL với
 * dấu `?`, qua Nest Logger (tức qua JsonLogger, kèm reqId của request gây ra).
 */
class LogTruyVanCham implements TypeOrmLogger {
  private readonly nest = new NestLogger('TruyVanCham');

  logQuerySlow(time: number, query: string): void {
    this.nest.warn(`${time}ms ${rutGon(query)}`);
  }

  logMigration(message: string): void {
    this.nest.log(message);
  }

  logQuery(): void {}
  logQueryError(): void {}
  logSchemaBuild(): void {}
  log(): void {}
}

/**
 * Hai tuỳ chọn trải vào cấu hình TypeORM của AppModule và WorkerModule, để hai
 * tiến trình báo câu chậm theo cùng một ngưỡng và cùng một định dạng.
 *
 * Ngưỡng đổi được bằng DB_SLOW_QUERY_MS (giá trị không phải số dương thì về
 * mặc định) mà không phải build lại ảnh.
 */
export function tuyChonTruyVanCham(): {
  maxQueryExecutionTime: number;
  logger: TypeOrmLogger;
} {
  const n = Number(process.env.DB_SLOW_QUERY_MS);
  return {
    maxQueryExecutionTime: Number.isFinite(n) && n > 0 ? n : NGUONG_MAC_DINH_MS,
    logger: new LogTruyVanCham(),
  };
}
