import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * Hằng số trần số dòng trả về cho danh sách tài khoản lệch.
 *
 * Cùng lý do với `AdminAuditService.TRAN_MOI_TRANG`: một response quá lớn
 * làm kẹt event loop Node (một luồng JS duy nhất). 100 dòng đủ để admin
 * thấy "có bao nhiêu tài khoản lệch" và xem mẫu 100 cái đầu để xác định
 * phạm vi hỏng. Con số thực `so_tai_khoan_lech` vẫn đếm đầy đủ.
 */
const TRAN_MOI_TRANG = 100;

/**
 * Kết quả câu SQL 1: tổng bút toán toàn hệ.
 */
interface TongButToanRow {
  tong: string;
}

/**
 * Kết quả câu SQL 2: tài khoản lệch.
 */
interface LechRow {
  id: number;
  owner_type: string;
  owner_id: string | null;
  purpose: string;
  balance: string;
  tong_but_toan: string;
}

/**
 * Kết quả câu SQL 3: danh sách tài khoản platform + external.
 */
interface TaiKhoanHeThongRow {
  owner_type: string;
  purpose: string;
  balance: string;
}

/**
 * Dịch vụ đối soát sổ cái (task #35).
 *
 * Chỉ ĐỌC, không ghi. Tiêm DataSource để chạy ba câu SQL xác định:
 *  1. SUM(amount) của TOÀN BỘ ledger_entries = 0
 *  2. Với MỖI tài khoản: balance = SUM(entries.amount) — chỉ trả về tài khoản LỆCH
 *  3. Danh sách số dư platform + external để UI hiển thị và lấy escrow_hold
 *
 * Hai câu SQL dùng nguyên văn từ lệnh — không tự viết lại.
 *
 * Bẫy BIGINT: tiền lưu bằng BIGINT đơn vị đồng. TypeORM trả về chuỗi,
 * trong code là bigint của JS. JSON.stringify(1n) ném TypeError.
 * Nên mọi số tiền trong response PHẢI LÀ CHUỖI.
 */
@Injectable()
export class LedgerDoiSoatService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async doiSoat(): Promise<{
    can_bang: boolean;
    tong_but_toan: string;
    tong_dang_giu_ho: string;
    so_du_he_thong: Array<{
      owner_type: string;
      purpose: string;
      balance: string;
    }>;
    so_tai_khoan_lech: number;
    tai_khoan_lech: Array<{
      id: number;
      owner_type: string;
      owner_id: number | null;
      purpose: string;
      balance: string;
      tong_but_toan: string;
      lech: string;
    }>;
  }> {
    // Bất biến 1: tổng bút toán toàn hệ
    const tongResult = await this.dataSource.query<TongButToanRow[]>(
      `SELECT COALESCE(SUM(amount), 0) AS tong FROM ledger_entries`,
    );
    const tong_but_toan = String(tongResult[0]?.tong ?? '0');

    // Bất biến 2: tìm tài khoản lệch (balance <> SUM(entries.amount))
    const lechRows = await this.dataSource.query<LechRow[]>(
      `SELECT a.id, a.owner_type, a.owner_id, a.purpose, a.balance,
              COALESCE(SUM(e.amount), 0) AS tong_but_toan
       FROM ledger_accounts a
       LEFT JOIN ledger_entries e ON e.account_id = a.id
       GROUP BY a.id, a.owner_type, a.owner_id, a.purpose, a.balance
       HAVING a.balance <> COALESCE(SUM(e.amount), 0)`,
    );

    // Đếm thật số tài khoản lệch (không phải length của mảng đã cắt)
    const so_tai_khoan_lech = lechRows.length;

    // Cắt danh sách lệch theo TRAN_MOI_TRANG
    const tai_khoan_lech = lechRows
      .slice(0, TRAN_MOI_TRANG)
      .map((r: LechRow) => ({
        id: r.id,
        owner_type: r.owner_type,
        owner_id: r.owner_id ? Number(r.owner_id) : null,
        purpose: r.purpose,
        balance: String(r.balance),
        tong_but_toan: String(r.tong_but_toan),
        lech: String(Number(r.balance) - Number(r.tong_but_toan)), // lệch = balance - tổng bút toán
      }));

    // Danh sách số dư mọi tài khoản platform + external (dùng cho UI hiển thị)
    const allAccounts = await this.dataSource.query<TaiKhoanHeThongRow[]>(
      `SELECT owner_type, purpose, balance FROM ledger_accounts
       WHERE owner_type IN ('platform', 'external')
       ORDER BY owner_type, purpose`,
    );
    const so_du_he_thong = allAccounts.map((r: TaiKhoanHeThongRow) => ({
      owner_type: r.owner_type,
      purpose: r.purpose,
      balance: String(r.balance),
    }));

    // tong_dang_giu_ho = số dư platform/escrow_hold
    const escrowHold = allAccounts.find(
      (r: TaiKhoanHeThongRow) =>
        r.owner_type === 'platform' && r.purpose === 'escrow_hold',
    );
    const tong_dang_giu_ho = escrowHold ? String(escrowHold.balance) : '0';

    return {
      can_bang: tong_but_toan === '0' && so_tai_khoan_lech === 0,
      tong_but_toan,
      tong_dang_giu_ho,
      so_du_he_thong,
      so_tai_khoan_lech,
      tai_khoan_lech,
    };
  }
}
