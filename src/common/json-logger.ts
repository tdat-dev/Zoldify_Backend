import { LoggerService } from '@nestjs/common';
import { reqIdHienTai } from './request-context';

export interface DongLog {
  level: 'log' | 'info' | 'warn' | 'error' | 'debug' | 'verbose';
  msg: string;
  reqId?: string;
  ctx?: string;
  [k: string]: unknown;
}

/**
 * GOM LÔ RỒI GHI MỘT LẦN — chứ không ghi từng dòng.
 *
 * Đo thật (`scripts/tmp-bench-mw.ts`, 200.000 lượt) trước khi chọn cách này:
 *
 *   fs.writeSync ra thiết bị rỗng   1,74 µs/lượt   ← đắt nhất, gấp ba mọi thứ khác
 *   new Date().toISOString()        0,72 µs
 *   JSON.stringify dòng log         0,55 µs
 *   randomUUID()                    0,10 µs
 *   als.run(...)                    0,05 µs        ← rẻ, không phải thủ phạm
 *   đẩy vào mảng                    0,01 µs        ← rẻ hơn 170 lần
 *
 * Đây là chỗ đã đoán sai: tôi ngờ `AsyncLocalStorage` là thứ nặng, hoá ra nó rẻ
 * nhất nhóm. Thứ nặng là LỜI GỌI HỆ THỐNG mỗi request — và trên một tiến trình
 * Node chỉ có một luồng JS, mỗi lời gọi ghi là một lần luồng ấy đứng lại.
 *
 * Bản không gom lô làm thông lượng tụt 12–15% (đo bằng `npm run loadtest`).
 *
 * ĐÁNH ĐỔI, NÓI RÕ: nếu tiến trình bị giết cứng (SIGKILL, mất điện) thì mất
 * phần log của tối đa `NHIP_XA` mili-giây cuối. Thoát bình thường thì không mất
 * gì — có chốt xả ở `exit`, `SIGTERM`, `SIGINT`.
 */
const NHIP_XA = 100;
const TRAN_LO = 1000;
const lo: string[] = [];
let henGio: NodeJS.Timeout | null = null;

/** Xả ngay, không đợi nhịp. Bài kiểm dùng; mã nghiệp vụ không cần gọi. */
export function xaNgay(): void {
  xaLo();
}

function xaLo(): void {
  if (henGio) {
    clearTimeout(henGio);
    henGio = null;
  }
  if (lo.length === 0) return;
  const noiDung = lo.join('');
  lo.length = 0;
  process.stdout.write(noiDung);
}

function xepVaoLo(dong: string): void {
  lo.push(dong);
  // Chặn trần để một đợt tải nặng không phình bộ nhớ trong lúc chờ nhịp xả.
  if (lo.length >= TRAN_LO) {
    xaLo();
    return;
  }
  if (!henGio) {
    // `unref` để cái hẹn giờ này không giữ tiến trình sống. Đổi lại phải có
    // chốt xả lúc thoát, nếu không dòng cuối cùng biến mất.
    henGio = setTimeout(xaLo, NHIP_XA);
    henGio.unref();
  }
}

for (const tin of ['exit', 'SIGTERM', 'SIGINT', 'beforeExit'] as const) {
  process.on(tin, xaLo);
}

/**
 * Dấu thời gian nhớ theo mili-giây.
 *
 * `new Date().toISOString()` tốn 0,72 µs — đắt thứ nhì trong nhóm. Nhưng trong
 * cùng một mili-giây thì kết quả y hệt nhau, nên tính lại là làm không công.
 * Ở 2.000 request/giây thì cách này chạy 1.000 lần thay vì 2.000.
 */
let tsMs = 0;
let tsChu = '';
function moc(): string {
  const bayGio = Date.now();
  if (bayGio !== tsMs) {
    tsMs = bayGio;
    tsChu = new Date(bayGio).toISOString();
  }
  return tsChu;
}

/**
 * Chỉ lấy giá trị NGUYÊN THUỶ ra chuỗi.
 *
 * `String(x)` trên một đối tượng cho ra `[object Object]` — một dòng log như thế
 * vô dụng đúng lúc cần nó nhất. Thà để trống còn hơn ghi một chuỗi vô nghĩa.
 */
const chu = (v: unknown): string =>
  typeof v === 'string' || typeof v === 'number' ? String(v) : '';

/**
 * Một dòng log = một đối tượng JSON = một dòng stdout.
 *
 * VÌ SAO JSON. Log cũ là văn xuôi của `Logger` mặc định. Đọc từng dòng thì được,
 * nhưng không trả lời nổi "p95 của `/api/v1/products` đang là bao nhiêu" hay
 * "mười request lỗi lúc 3 giờ sáng thuộc về ai". JSON thì `jq` trả lời được, và
 * `scripts/log-summary.mjs` trong repo này cũng đọc được.
 *
 * VÌ SAO KHÔNG THÊM THƯ VIỆN. `pino` nhanh hơn, nhưng thứ cần ở đây là một dòng
 * JSON mỗi request — `JSON.stringify` làm được, và không thêm phụ thuộc nghĩa là
 * không thêm thứ phải nâng cấp và vá.
 */
export function ghiDongLog(dong: Omit<DongLog, 'ts'>): void {
  if (!dangMay) {
    // Trên máy cá nhân: một dòng ngắn đọc được. Cùng lý do với `JsonLogger`
    // bên dưới — log khó chịu thì người ta tắt log, và lúc cần thì không có gì.
    const d = dong as Record<string, unknown>;
    const reqId = chu(d.reqId);
    const method = typeof d.method === 'string' ? d.method : '';
    const path = chu(d.path);
    const status = Number(d.status ?? 0);
    const ms = chu(d.ms);
    if (method) {
      const m = status >= 500 ? '\x1b[31m' : '\x1b[32m';
      xepVaoLo(
        `\x1b[2m${reqId.slice(0, 8)}\x1b[0m ${m}${String(status)}\x1b[0m ` +
          `${String(method).padEnd(6)} ${String(path)} \x1b[2m${String(ms)}ms\x1b[0m\n`,
      );
      return;
    }
  }
  xepVaoLo(JSON.stringify({ ts: moc(), ...dong }) + '\n');
}

/**
 * Người trên máy cá nhân KHÔNG phải đọc JSON thô.
 *
 * Log khó chịu thì người ta tắt log, và lúc cần thì không có gì. Nên chỉ ép
 * JSON ở nơi có máy đọc; còn lại giữ dạng người đọc được.
 */
const dangMay =
  process.env.NODE_ENV === 'production' || process.env.LOG_JSON === '1';

const MAU: Record<string, string> = {
  error: '\x1b[31m',
  warn: '\x1b[33m',
  debug: '\x1b[36m',
};

/**
 * Logger của Nest, gắn bằng `app.useLogger(...)` trong `main.ts`.
 *
 * Gắn ở đó nghĩa là MỌI `new Logger(...)` sẵn có trong service tự động đi qua
 * đây và tự động mang `reqId` — không phải sửa một dòng nào trong nghiệp vụ.
 */
export class JsonLogger implements LoggerService {
  private ra(level: DongLog['level'], msg: unknown, ctx?: string): void {
    const reqId = reqIdHienTai();
    const noiDung = typeof msg === 'string' ? msg : JSON.stringify(msg);

    if (dangMay) {
      ghiDongLog({ level, msg: noiDung, reqId, ctx });
      return;
    }
    const mau = MAU[level] ?? '\x1b[32m';
    const dau = reqId ? `\x1b[2m${reqId.slice(0, 8)}\x1b[0m ` : '';
    xepVaoLo(
      `${dau}${mau}${level.toUpperCase().padEnd(5)}\x1b[0m ` +
        `${ctx ? `\x1b[2m[${ctx}]\x1b[0m ` : ''}${noiDung}\n`,
    );
  }

  log(m: unknown, ctx?: string) {
    this.ra('log', m, ctx);
  }
  error(m: unknown, ctx?: string) {
    this.ra('error', m, ctx);
  }
  warn(m: unknown, ctx?: string) {
    this.ra('warn', m, ctx);
  }
  debug(m: unknown, ctx?: string) {
    this.ra('debug', m, ctx);
  }
  verbose(m: unknown, ctx?: string) {
    this.ra('verbose', m, ctx);
  }
  // Nest gọi hàm này để đặt mức log. Bỏ qua có chủ đích: mức lọc do Nest tự
  // quản, ở đây chỉ lo ĐỊNH DẠNG.
  setLogLevels?(): void {}
}
