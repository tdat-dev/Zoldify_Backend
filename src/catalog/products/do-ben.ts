/**
 * Thẻ "Độ bền" của tin đăng: những câu người mua đồ cũ luôn hỏi, mỗi câu một
 * trường có kiểu để web và app hiện thành bảng thay vì một đoạn chữ tự do.
 * Bài kiểm: `do-ben.spec.ts`.
 */
export interface DoBen {
  /** Phần trăm pin còn lại, 0-100. Chỉ hàng có pin. */
  battery_health?: number;
  /** Đã dùng bao nhiêu tháng. */
  used_months?: number;
  /** Bảo hành còn bao nhiêu tháng, 0 là đã hết. */
  warranty_months?: number;
  defects?: string[];
  accessories?: string[];
  repaired?: boolean;
  repair_note?: string;
}

/**
 * Slug danh mục có pin. Theo slug chứ không theo id vì id khác nhau giữa máy
 * dev, staging và prod, còn slug thì giống. Web và app chép cùng danh sách này
 * để ẩn ô pin; thêm danh mục có pin (máy ảnh, loa) thì sửa cả ba chỗ.
 */
export const DANH_MUC_CO_PIN = [
  'dien-thoai',
  'laptop',
  'may-tinh-bang',
  'tai-nghe',
  'dong-ho',
];

function chuoiSach(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t ? t : undefined;
}

function dsSach(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const ds = v.map(chuoiSach).filter((x): x is string => !!x);
  return ds.length ? ds : undefined;
}

/**
 * Cắt khoảng trắng, bỏ dòng trống, bỏ trường trống. Không còn gì thì `null`:
 * form gửi `{ defects: [''] }` khi người bán mở rồi bỏ trống, không được thành
 * một thẻ Độ bền rỗng trên trang công khai.
 *
 * Đầu vào đã qua `ConditionDetailsDto` nên kiểu từng trường đã đúng; hàm này
 * chỉ dọn, không kiểm.
 */
export function chuanHoaDoBen(raw: unknown): DoBen | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const ra: DoBen = {};
  for (const k of [
    'battery_health',
    'used_months',
    'warranty_months',
  ] as const) {
    if (typeof r[k] === 'number') ra[k] = r[k];
  }
  const defects = dsSach(r.defects);
  if (defects) ra.defects = defects;
  const accessories = dsSach(r.accessories);
  if (accessories) ra.accessories = accessories;
  if (typeof r.repaired === 'boolean') ra.repaired = r.repaired;
  const repairNote = chuoiSach(r.repair_note);
  if (repairNote) ra.repair_note = repairNote;
  return Object.keys(ra).length ? ra : null;
}
