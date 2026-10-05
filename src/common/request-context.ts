import { AsyncLocalStorage } from 'async_hooks';

export interface NguCanhRequest {
  /** Mã nhận dạng của request, đi theo mọi dòng log sinh ra trong nó. */
  reqId: string;
}

/**
 * Ngữ cảnh của request hiện tại, mang được xuyên qua `await`.
 *
 * VÌ SAO PHẢI DÙNG `AsyncLocalStorage` CHỨ KHÔNG TRUYỀN THAM SỐ.
 *
 * Muốn mỗi dòng log mang mã request thì mọi hàm trên đường đi phải biết mã đó.
 * Truyền tay nghĩa là sửa chữ ký của hàng trăm hàm, và chỉ cần một chỗ quên là
 * đứt chuỗi. `AsyncLocalStorage` giữ giá trị theo "nhánh thực thi bất đồng bộ",
 * nên nó đi qua được `await` mà không ai phải khai gì.
 *
 * Đây đúng là kỹ thuật đã dùng trong `scripts/sql-audit.ts` để truy mỗi câu SQL
 * về đúng dòng mã đã gọi nó — ở đó cũng vì cùng một lý do: stack đồng bộ bị xoá
 * sạch sau mỗi lần `await`.
 */
export const nguCanh = new AsyncLocalStorage<NguCanhRequest>();

/** Mã request hiện tại, hoặc `undefined` khi đang ở ngoài một request (cron, worker). */
export function reqIdHienTai(): string | undefined {
  return nguCanh.getStore()?.reqId;
}
