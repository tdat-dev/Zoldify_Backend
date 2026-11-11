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

/**
 * STUB — luôn báo đạt. Có mặt để bài tự kiểm biên dịch và CHẠY RA ĐỎ trước khi
 * có logic thật. Thay ở commit sau.
 */
export function danhGiaChiuDung(
  mau: MauChiuDung[],
  _nguong: NguongChiuDung = NGUONG_MAC_DINH,
): KetLuanChiuDung {
  return {
    dat: true,
    lyDo: [],
    soDo: {
      docRss: 0,
      docHeap: 0,
      p95Dau: 0,
      p95Sau: 0,
      lagDau: 0,
      lagSau: 0,
      loiDau: 0,
      loiSau: 0,
      soMauXet: mau.length,
    },
  };
}
