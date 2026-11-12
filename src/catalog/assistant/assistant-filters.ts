/**
 * Bộ lọc của trợ lý mua hàng: phần THUẦN (không gọi mạng, không DB).
 *
 * Mô hình AI chỉ làm một việc: đọc câu người dùng gõ ("nồi cơm Nhật dưới 600k
 * ở HCM") rồi trả về bộ lọc qua tool call. Thứ nó trả là đầu vào KHÔNG tin
 * được: bịa trường (seller_id), giá dạng chuỗi "600k", min lớn hơn max, từ khoá
 * dài cả đoạn. Nên mọi thứ đi qua `normalizeFilters` rồi mới thành truy vấn.
 */

export const VALID_CONDITIONS = [
  'new',
  'like_new',
  'good',
  'fair',
  'used',
  'refurbished',
] as const;
export const VALID_SORTS = ['price_asc', 'price_desc', 'newest'] as const;

export interface AssistantFilters {
  q: string;
  price_min?: number;
  price_max?: number;
  condition?: (typeof VALID_CONDITIONS)[number];
  province?: string;
  sort?: (typeof VALID_SORTS)[number];
}

/** Từ khoá dài hơn thế này là mô hình chép nguyên câu, không phải từ khoá. */
const MAX_QUERY_LENGTH = 80;
/** Trần giá: 10 tỷ. Lớn hơn là mô hình đọc nhầm đơn vị. */
const MAX_PRICE = 10_000_000_000;

/** "600k" -> 600000, "1tr" -> 1000000, "1,5 triệu" -> 1500000, 600000 -> 600000. */
export function parsePrice(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return value > 0 && value <= MAX_PRICE ? Math.round(value) : undefined;
  }
  if (typeof value !== 'string') return undefined;
  const s = value
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/vnđ|vnd|đ/g, '');
  const m = s.match(/^(\d+(?:[.,]\d+)?)(k|nghìn|ngàn|tr|triệu|trieu|m)?$/);
  if (!m) return undefined;
  const amount = Number(m[1].replace(',', '.'));
  const unit =
    m[2] === undefined
      ? 1
      : ['k', 'nghìn', 'ngàn'].includes(m[2])
        ? 1_000
        : 1_000_000;
  return parsePrice(amount * unit);
}

const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === 'string' && (list as readonly string[]).includes(v);

export function normalizeFilters(
  raw: Record<string, unknown>,
): AssistantFilters {
  const q =
    typeof raw?.q === 'string'
      ? raw.q.replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY_LENGTH)
      : '';
  const filters: AssistantFilters = { q };
  let min = parsePrice(raw?.price_min);
  let max = parsePrice(raw?.price_max);
  if (min !== undefined && max !== undefined && min > max)
    [min, max] = [max, min];
  if (min !== undefined) filters.price_min = min;
  if (max !== undefined) filters.price_max = max;
  if (isOneOf(VALID_CONDITIONS, raw?.condition))
    filters.condition = raw.condition;
  if (isOneOf(VALID_SORTS, raw?.sort)) filters.sort = raw.sort;
  const province =
    typeof raw?.province === 'string' ? raw.province.trim().slice(0, 40) : '';
  if (province) filters.province = province;
  return filters;
}

interface ModelToolCall {
  function?: { name?: string; arguments?: string };
}
interface ModelResponse {
  choices?: { message?: { content?: unknown; tool_calls?: ModelToolCall[] } }[];
}

/**
 * Router 9router trả JSON rồi nối thêm `data: [DONE]` (dấu vết chế độ stream)
 * vào cùng body, nên JSON.parse thẳng sẽ ném lỗi. Cắt ở dấu `}` cuối cùng
 * trước phần đuôi đó. Body hỏng (502 trả HTML) thì trả rỗng: nơi gọi tự tìm
 * bằng câu người dùng gõ.
 */
export function parseModelResponse(body: string): {
  filters?: AssistantFilters;
  text?: string;
} {
  const end = body.lastIndexOf('}');
  if (end < 0) return {};
  let parsed: ModelResponse;
  try {
    parsed = JSON.parse(body.slice(0, end + 1)) as ModelResponse;
  } catch {
    return {};
  }
  const message = parsed?.choices?.[0]?.message;
  const call = (message?.tool_calls ?? []).find(
    (c) => c?.function?.name === 'search_products',
  );
  if (call) {
    try {
      const args = JSON.parse(call.function?.arguments || '{}') as Record<
        string,
        unknown
      >;
      const filters = normalizeFilters(args);
      if (filters.q) return { filters };
    } catch {
      return {};
    }
  }
  const text =
    typeof message?.content === 'string' ? message.content.trim() : '';
  return text ? { text: text.slice(0, 400) } : {};
}

/** Bỏ dấu, hạ chữ thường, tách chữ: "Nồi Cơm" và "noi com" là như nhau. */
function words(s: string): string[] {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Xếp món theo số chữ của câu hỏi có trong tên, nhiều hơn đứng trước. Tìm
 * FULLTEXT trả món chỉ cần trùng MỘT chữ: hỏi "nồi cơm điện" thì nồi áp suất
 * và máy xay (trùng "nồi", "điện") đứng trước nồi cơm thật (staging 12/11).
 * Điểm bằng nhau giữ thứ tự gốc (Array.prototype.sort ổn định từ ES2019).
 */
export function rankByName<T extends { name: string }>(
  items: T[],
  q: string,
): T[] {
  const want = new Set(words(q));
  if (!want.size) return items;
  const score = (name: string) => words(name).filter((w) => want.has(w)).length;
  return items
    .map((item, i) => ({ item, i, s: score(item.name) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.item);
}

const formatVnd = (n: number) => n.toLocaleString('vi-VN') + ' đ';

/** Câu trả lời dựng từ bộ lọc, không để mô hình viết: nhanh và không bịa. */
export function buildReply(
  f: AssistantFilters,
  count: number,
  relaxed: string[],
): string {
  if (count === 0) {
    return `Mình chưa tìm thấy món nào khớp "${f.q}". Bạn thử gõ ngắn hơn, ví dụ chỉ tên món và tầm giá.`;
  }
  const price =
    f.price_min && f.price_max
      ? ` từ ${formatVnd(f.price_min)} đến ${formatVnd(f.price_max)}`
      : f.price_max
        ? ` dưới ${formatVnd(f.price_max)}`
        : f.price_min
          ? ` trên ${formatVnd(f.price_min)}`
          : '';
  const place = f.province && !relaxed.length ? ` ở ${f.province}` : '';
  let s = `Mình tìm được ${count} món "${f.q}"${price}${place}.`;
  if (relaxed.length)
    s += ` Không có món nào ở ${relaxed.join(', ')} nên mình mở rộng ra cả nước.`;
  return s + ' Bấm Mua ngay để vào thẳng trang đặt hàng.';
}
