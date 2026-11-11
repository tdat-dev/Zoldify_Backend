/**
 * Tự kiểm BỘ PHÂN TÍCH sức chịu đựng — chạy ĐƯỢC trên máy KHÔNG có Docker.
 *
 *   npm run check:chiu-dung
 *
 * Đây là chốt chống "xanh giả" (pre-mortem K2): nếu bộ phân tích không thể
 * chuyển một chuỗi RÕ RÀNG có rò từ xanh sang đỏ, thì bài soak 30 phút dù báo
 * "khoẻ" cũng vô nghĩa. Nên ở đây ta nạp các chuỗi tổng hợp đã biết trước kết
 * quả và bắt bộ phân tích gọi đúng tên:
 *
 *   - rò RSS tuyến tính            → ĐỎ
 *   - trôi p95 ở nửa sau           → ĐỎ
 *   - trôi event loop lag nửa sau  → ĐỎ
 *   - lỗi dồn ở nửa sau            → ĐỎ
 *   - phẳng (chỉ nhiễu nhỏ)        → XANH
 *   - RSS cưa răng theo GC, dốc 0  → XANH  (K4: không kết tội GC là rò)
 *
 * Không có DB, không có mạng: thuần hàm số.
 */
import {
  danhGiaChiuDung,
  MauChiuDung,
  NGUONG_MAC_DINH,
  NguongChiuDung,
} from './danh-gia-chiu-dung';

// 30 mẫu, mỗi mẫu cách nhau 1 phút (warmup mặc định 3 phút → xét 27 mẫu sau).
const SO_MAU = 30;

/** Dựng một chuỗi mẫu từ hàm sinh từng trường theo chỉ số phút. */
function chuoi(
  sinh: (t: number) => Partial<MauChiuDung>,
  nen: Omit<MauChiuDung, 'tPhut'> = {
    rssMB: 200,
    heapMB: 80,
    p95ms: 20,
    lagP99ms: 5,
    loiTyLe: 0,
  },
): MauChiuDung[] {
  return Array.from({ length: SO_MAU }, (_v, t) => ({
    tPhut: t,
    ...nen,
    ...sinh(t),
  }));
}

interface Ca {
  ten: string;
  mau: MauChiuDung[];
  datMongDoi: boolean;
  /** Nếu đỏ: một từ khoá phải xuất hiện trong lý do, để chắc bắt ĐÚNG bệnh. */
  lyDoChua?: string;
  nguong?: NguongChiuDung;
}

const cac: Ca[] = [
  {
    // RSS leo 3 MB/phút sau warmup — rò rõ ràng.
    ten: 'rò RSS tuyến tính',
    mau: chuoi((t) => ({ rssMB: 200 + (t <= 3 ? 0 : (t - 3) * 3) })),
    datMongDoi: false,
    lyDoChua: 'RSS',
  },
  {
    // Nửa sau p95 gấp ~3 lần nửa đầu — pool cạn dần / xử lý chậm dần.
    ten: 'trôi p95 nửa sau',
    mau: chuoi((t) => ({ p95ms: t < SO_MAU / 2 ? 20 : 65 })),
    datMongDoi: false,
    lyDoChua: 'p95',
  },
  {
    // event loop lag p99 vọt ở nửa sau — một request giữ CPU không nhả.
    ten: 'trôi event loop lag nửa sau',
    mau: chuoi((t) => ({ lagP99ms: t < SO_MAU / 2 ? 4 : 20 })),
    datMongDoi: false,
    lyDoChua: 'lag',
  },
  {
    // Lỗi dồn về cuối (3%).
    ten: 'lỗi dồn nửa sau',
    mau: chuoi((t) => ({ loiTyLe: t < SO_MAU / 2 ? 0 : 0.03 })),
    datMongDoi: false,
    lyDoChua: 'lỗi',
  },
  {
    // Phẳng, chỉ nhiễu ±1 MB — backend khoẻ.
    ten: 'ổn định (nhiễu nhỏ)',
    mau: chuoi((t) => ({ rssMB: 200 + (t % 2 === 0 ? 1 : -1) })),
    datMongDoi: true,
  },
  {
    // RSS cưa răng biên độ 40 MB theo chu kỳ GC nhưng DỐC = 0.
    // K4: lấy mẫu rơi đúng đỉnh/đáy không được thành "rò".
    ten: 'GC cưa răng, dốc 0 (không phải rò)',
    mau: chuoi((t) => ({ rssMB: 200 + (t % 4 < 2 ? 0 : 40) })),
    datMongDoi: true,
  },
  {
    // Warmup leo mạnh (cache ấm, pool mở) rồi PHẲNG hẳn sau phút 3.
    // K3: không được kết tội phần khởi động.
    ten: 'leo lúc warmup rồi phẳng (không phải rò)',
    mau: chuoi((t) => ({ rssMB: t <= 3 ? 150 + t * 20 : 210 })),
    datMongDoi: true,
  },
];

let hong = 0;
console.log(`▶ Tự kiểm bộ phân tích chịu đựng — ${cac.length} ca\n`);
for (const c of cac) {
  const kl = danhGiaChiuDung(c.mau, c.nguong ?? NGUONG_MAC_DINH);
  const dungKetLuan = kl.dat === c.datMongDoi;
  const dungLyDo =
    c.datMongDoi || !c.lyDoChua
      ? true
      : kl.lyDo.some((l) => l.toLowerCase().includes(c.lyDoChua!.toLowerCase()));
  const ok = dungKetLuan && dungLyDo;
  if (!ok) hong++;
  const dau = ok ? '✓ PASS' : '✗ FAIL';
  const mongDoi = c.datMongDoi ? 'ĐẠT' : 'ĐỎ';
  const thucTe = kl.dat ? 'ĐẠT' : 'ĐỎ';
  console.log(`  ${dau}  ${c.ten} — mong ${mongDoi}, ra ${thucTe}`);
  if (!ok) {
    if (!dungKetLuan) console.log(`         kết luận sai dấu`);
    if (!dungLyDo) console.log(`         thiếu lý do chứa "${c.lyDoChua}"; lý do: ${JSON.stringify(kl.lyDo)}`);
  }
}

if (hong > 0) {
  console.error(`\n═══ ${hong}/${cac.length} ca FAIL — bộ phân tích chưa đủ nhạy ═══`);
  process.exit(1);
}
console.log(`\n✓ ${cac.length}/${cac.length} ca PASS — bộ phân tích bắt được rò/trôi và không báo oan.`);
