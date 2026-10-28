/**
 * Dọn thông báo cũ: đã đọc quá 90 ngày, hoặc bất kỳ thông báo nào quá 180
 * ngày (rà soát "1 triệu dòng" 28/10, mục 7).
 *
 * VÌ SAO PHẢI DỌN. Mỗi đơn đổi trạng thái sinh vài thông báo, mỗi lần người
 * bán đăng hàng sinh một thông báo cho TỪNG người theo dõi. Tới nay không gì
 * xoá chúng: bảng, index `idx_user_created` và bản dump backup mỗi đêm cùng
 * phình mãi.
 *
 * VÌ SAO THEO LÔ. Một câu `DELETE` trăm nghìn dòng giữ khoá dòng và phình
 * undo log suốt thời gian chạy, chặn luôn các INSERT thông báo mới (MySQL
 * container chỉ có 1 GB). `DELETE ... LIMIT 1000` mỗi câu chỉ chạm 1.000
 * dòng theo index `idx_created_at`, nghỉ một nhịp giữa các lô để nhường
 * kết nối cho request thật.
 *
 * VÌ SAO CÓ TRẦN MỖI LẦN CHẠY. Lần chạy đầu trên production có thể gặp cả
 * triệu dòng tồn đọng; không trần thì job chạy hàng chục phút. Trần 100.000
 * dòng một lần, phần còn lại để đêm sau: lượng dọn mỗi đêm vẫn lớn hơn lượng
 * sinh ra mỗi ngày, nên tồn đọng giảm dần về 0.
 *
 * Mốc thời gian tính bằng `NOW()` của MySQL, không phải đồng hồ Node: cột
 * là `timestamp`, so trong cùng một đồng hồ thì không lệch múi giờ.
 *
 * KHÔNG dọn tin nhắn chat: đó là nội dung người dùng tự viết, xoá hay không
 * là quyết định sản phẩm (và có thể là nghĩa vụ lưu trữ khi tranh chấp đơn),
 * không phải chuyện hiệu năng.
 */
export interface TuyChonDonThongBao {
  /** Đã đọc và cũ hơn bấy nhiêu ngày thì xoá. Mặc định 90. */
  docSauNgay?: number;
  /** Cũ hơn bấy nhiêu ngày thì xoá dù chưa đọc. Mặc định 180. */
  moiSauNgay?: number;
  /** Số dòng mỗi câu DELETE. Mặc định 1.000. */
  lo?: number;
  /** Tối đa bấy nhiêu dòng mỗi lần chạy. Mặc định 100.000. */
  tranMoiLan?: number;
  /** Nghỉ giữa hai lô (ms). Mặc định 50. */
  nghiMs?: number;
}

export interface KetQuaDonThongBao {
  da_xoa: number;
  so_lo: number;
  /** true: dừng vì chạm trần, còn dòng chờ lần chạy sau. */
  cham_tran: boolean;
}

/** Thứ chạy được câu SQL thô: DataSource, EntityManager hay Repository. */
export interface ChaySql {
  query(sql: string, thamSo?: unknown[]): Promise<unknown>;
}

const ngu = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function donThongBaoCu(
  db: ChaySql,
  o: TuyChonDonThongBao = {},
): Promise<KetQuaDonThongBao> {
  const docSauNgay = o.docSauNgay ?? 90;
  const moiSauNgay = o.moiSauNgay ?? 180;
  const lo = o.lo ?? 1_000;
  const tran = o.tranMoiLan ?? 100_000;
  const nghiMs = o.nghiMs ?? 50;

  // Lượt "mọi thứ quá 180 ngày" đi trước: điều kiện chỉ có `created_at`, đi
  // thẳng index. Lượt "đã đọc quá 90 ngày" lọc thêm `is_read` trên cùng
  // khoảng index.
  const luot: Array<[string, number]> = [
    ['created_at < NOW() - INTERVAL ? DAY', moiSauNgay],
    ['is_read = 1 AND created_at < NOW() - INTERVAL ? DAY', docSauNgay],
  ];

  let daXoa = 0;
  let soLo = 0;
  for (const [dieuKien, ngay] of luot) {
    for (;;) {
      const lay = Math.min(lo, tran - daXoa);
      if (lay <= 0) return { da_xoa: daXoa, so_lo: soLo, cham_tran: true };
      const kq = (await db.query(
        `DELETE FROM notifications WHERE ${dieuKien} LIMIT ?`,
        [ngay, lay],
      )) as { affectedRows?: number };
      const n = Number(kq?.affectedRows ?? 0);
      daXoa += n;
      soLo++;
      if (n < lay) break;
      if (nghiMs > 0) await ngu(nghiMs);
    }
  }
  return { da_xoa: daXoa, so_lo: soLo, cham_tran: false };
}
