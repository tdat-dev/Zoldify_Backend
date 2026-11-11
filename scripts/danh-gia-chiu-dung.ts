/**
 * Bộ phân tích SỨC CHỊU ĐỰNG — thuần logic, KHÔNG chạm DB hay mạng.
 *
 * Tách khỏi runner (`do-chiu-dung.ts`) có chủ đích: đây là phần duy nhất
 * nghiệm thu được trên máy KHÔNG có Docker (pre-mortem K7). Nhận một chuỗi mẫu
 * đo theo thời gian, trả về "backend có rò / trôi không" — và `check:chiu-dung`
 * nạp chuỗi tổng hợp để chứng minh nó ĐỎ ĐƯỢC (K2), không xanh giả.
 *
 * TẠM THỜI: thân hàm là STUB luôn báo "đạt" để bài tự kiểm đỏ trước. Logic thật
 * ở commit sau.
 */

/** Một lần lấy mẫu trong lúc bắn tải. */
export interface MauChiuDung {
  /** Phút kể từ lúc bắt đầu bắn tải (để bỏ warmup và tính độ dốc theo thời gian). */
  tPhut: number;
  /** `rss` của tiến trình SERVER (MB) — thước đo rò bộ nhớ thường trú. */
  rssMB: number;
  /** `heapUsed` của SERVER (MB) — rò trong heap JS. */
  heapMB: number;
  /** p95 độ trễ request trong lượt lấy mẫu (ms). */
  p95ms: number;
  /** event loop lag p99 của SERVER (ms). */
  lagP99ms: number;
  /** Tỉ lệ lỗi trong lượt (0..1). */
  loiTyLe: number;
}

export interface NguongChiuDung {
  /** Bỏ qua bao nhiêu phút đầu (cache ấm, pool mở, JIT) trước khi xét — K3. */
  warmupPhut: number;
  /** Dốc RSS tối đa cho phép (MB/phút). Vượt là nghi rò. */
  docRssMBmoiPhut: number;
  /** Dốc heapUsed tối đa cho phép (MB/phút). */
  docHeapMBmoiPhut: number;
  /** p95/lag nửa sau vượt nửa đầu bao nhiêu lần thì coi là trôi. */
  heSoTroi: number;
  /** Tỉ lệ lỗi tuyệt đối tối đa ở nửa sau. */
  loiToiDa: number;
}

export interface SoDoChiuDung {
  docRss: number;
  docHeap: number;
  p95Dau: number;
  p95Sau: number;
  lagDau: number;
  lagSau: number;
  loiDau: number;
  loiSau: number;
  soMauXet: number;
}

export interface KetLuanChiuDung {
  dat: boolean;
  /** Vì sao đỏ; rỗng khi đạt. */
  lyDo: string[];
  soDo: SoDoChiuDung;
}

export const NGUONG_MAC_DINH: NguongChiuDung = {
  warmupPhut: 3,
  docRssMBmoiPhut: 1.5,
  docHeapMBmoiPhut: 1.0,
  heSoTroi: 1.5,
  loiToiDa: 0.01,
};

const tb = (a: number[]): number => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

/**
 * Độ dốc hồi quy tuyến tính của `ys` theo `xs` (đơn vị: y mỗi đơn vị x).
 *
 * Dùng hồi quy trên TẤT CẢ mẫu thay vì lấy (điểm cuối − điểm đầu): RSS cưa răng
 * theo chu kỳ GC, hai điểm đầu/cuối có thể rơi đúng đỉnh và đáy cho ra dốc giả
 * cả về dấu lẫn độ lớn (pre-mortem K4). Hồi quy "san" dao động đó, chỉ còn lại
 * xu hướng thật.
 */
function doDoc(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const mx = tb(xs);
  const my = tb(ys);
  let tu = 0;
  let mau = 0;
  for (let i = 0; i < n; i++) {
    tu += (xs[i] - mx) * (ys[i] - my);
    mau += (xs[i] - mx) ** 2;
  }
  return mau === 0 ? 0 : tu / mau;
}

const lamTron = (x: number): number => Math.round(x * 100) / 100;

/**
 * Backend có rò (bộ nhớ / kết nối) hay trôi (độ trễ, lag) theo thời gian không.
 *
 * Bỏ warmup trước (K3), rồi xét HAI thứ trên phần còn lại:
 *   - RÒ: độ dốc hồi quy của rss / heapUsed theo phút vượt ngưỡng.
 *   - TRÔI: trung bình p95 / lag / lỗi của nửa SAU so với nửa ĐẦU.
 */
export function danhGiaChiuDung(
  mau: MauChiuDung[],
  nguong: NguongChiuDung = NGUONG_MAC_DINH,
): KetLuanChiuDung {
  const xet = mau.filter((m) => m.tPhut >= nguong.warmupPhut);
  const lyDo: string[] = [];

  const docRss = lamTron(doDoc(xet.map((m) => m.tPhut), xet.map((m) => m.rssMB)));
  const docHeap = lamTron(doDoc(xet.map((m) => m.tPhut), xet.map((m) => m.heapMB)));

  const mid = Math.floor(xet.length / 2);
  const dau = xet.slice(0, mid);
  const sau = xet.slice(mid);
  const p95Dau = lamTron(tb(dau.map((m) => m.p95ms)));
  const p95Sau = lamTron(tb(sau.map((m) => m.p95ms)));
  const lagDau = lamTron(tb(dau.map((m) => m.lagP99ms)));
  const lagSau = lamTron(tb(sau.map((m) => m.lagP99ms)));
  const loiDau = lamTron(tb(dau.map((m) => m.loiTyLe)));
  const loiSau = lamTron(tb(sau.map((m) => m.loiTyLe)));

  const soDo: SoDoChiuDung = {
    docRss, docHeap, p95Dau, p95Sau, lagDau, lagSau, loiDau, loiSau,
    soMauXet: xet.length,
  };

  // Dưới 4 mẫu sau warmup thì không đủ để nói gì về xu hướng — không kết tội.
  if (xet.length < 4) return { dat: true, lyDo, soDo };

  if (docRss > nguong.docRssMBmoiPhut) {
    lyDo.push(
      `Rò RSS: dốc ${docRss} MB/phút > ngưỡng ${nguong.docRssMBmoiPhut} ` +
        `(ngoại suy ~${lamTron(docRss * 60)} MB/giờ)`,
    );
  }
  if (docHeap > nguong.docHeapMBmoiPhut) {
    lyDo.push(`Rò heap: dốc ${docHeap} MB/phút > ngưỡng ${nguong.docHeapMBmoiPhut}`);
  }
  if (p95Sau > p95Dau * nguong.heSoTroi) {
    lyDo.push(
      `Trôi p95: nửa sau ${p95Sau}ms > nửa đầu ${p95Dau}ms × ${nguong.heSoTroi}`,
    );
  }
  if (lagSau > lagDau * nguong.heSoTroi) {
    lyDo.push(
      `Trôi event loop lag: nửa sau ${lagSau}ms > nửa đầu ${lagDau}ms × ${nguong.heSoTroi}`,
    );
  }
  if (loiSau > nguong.loiToiDa) {
    lyDo.push(
      `Lỗi dồn: tỉ lệ lỗi nửa sau ${lamTron(loiSau * 100)}% > ngưỡng ${lamTron(nguong.loiToiDa * 100)}%`,
    );
  }

  return { dat: lyDo.length === 0, lyDo, soDo };
}
