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

/** Chữ cho thấy người dùng có nói tới tình trạng món hàng. */
const CONDITION_HINTS = new Set([
  'mới',
  'cũ',
  'new',
  'used',
  'zin',
  'seal',
  'fullbox',
  'tân',
  'trang',
  'refurbished',
  'trầy',
  'xước',
  'lỗi',
  'hỏng',
  'tốt',
  'đẹp',
]);
/** Chữ cho thấy người dùng muốn sắp xếp: "rẻ nhất", "mới đăng", "giá cao". */
const SORT_HINTS = new Set([
  'rẻ',
  'đắt',
  'nhất',
  'thấp',
  'cao',
  'đăng',
  'cheap',
  'cheapest',
  'newest',
  'latest',
]);

/** Chữ chỉ nơi chốn: "ở", "tại", và tên viết tắt hay gặp của hai thành phố lớn. */
const PLACE_HINTS = new Set([
  'ở',
  'tại',
  'hcm',
  'tphcm',
  'sg',
  'saigon',
  'sài',
  'hn',
]);

/**
 * Bỏ bộ lọc mà người dùng không nhắc tới. Mô hình hay tự điền thêm, đo trên
 * staging 12/11 với gpt-6-luna:
 *  - "tai nghe bluetooth" ra condition "new", sort "newest": sàn đồ cũ gần như
 *    không có hàng mới, cả bảy câu thử ra rỗng.
 *  - "tai nghe bluetooth" ra price_max 999999999; "may anh" ra price_max
 *    3000000 và province "Hồ Chí Minh".
 * Nên giá chỉ giữ khi câu có số, tỉnh chỉ giữ khi câu có nơi chốn, tình trạng và
 * sắp xếp chỉ giữ khi câu có chữ gợi ý. Đọc mọi câu của người dùng trong cuộc
 * trò chuyện ("tai nghe", rồi "loại như mới thôi").
 *
 * Hạng "used" luôn bỏ: sàn so tình trạng khớp chính xác, "iphone cũ" thành hạng
 * Cũ 70-80% thì mất hết iPhone hạng Tốt, Như mới. Trên sàn đồ cũ, "cũ" nghĩa là
 * đồ đã dùng nói chung.
 */
export function dropUnaskedFilters(
  f: AssistantFilters,
  userTexts: string[],
): AssistantFilters {
  const said = new Set(userTexts.flatMap(tokens));
  const mentions = (hints: Set<string>) => [...hints].some((w) => said.has(w));
  const bare = ' ' + stripAccents(tokens(userTexts.join(' ')).join(' ')) + ' ';
  const out = { ...f };
  if (out.condition === 'used' || (out.condition && !mentions(CONDITION_HINTS)))
    delete out.condition;
  if (out.sort && !mentions(SORT_HINTS)) delete out.sort;
  // Giá nào cũng phải có con số: "600k", "6 trăm", "10 triệu".
  if (![...said].some((w) => /\d/.test(w))) {
    delete out.price_min;
    delete out.price_max;
  }
  if (out.province) {
    const place = stripAccents(tokens(out.province).join(' ')).replace(
      /^(tinh|thanh pho|tp) /,
      '',
    );
    if (!mentions(PLACE_HINTS) && !bare.includes(' ' + place + ' '))
      delete out.province;
  }
  return out;
}

/** Chữ chỉ dùng để chào hỏi, không phải tên món. */
const GREETING_WORDS = new Set([
  'chào',
  'xin',
  'bạn',
  'hello',
  'hi',
  'alo',
  'ơi',
  'shop',
  'ad',
  'admin',
  'em',
  'anh',
  'chị',
]);

/**
 * Từ khoá chỉ gồm chữ chào hỏi. Đo staging 12/11: cùng câu "chào bạn", có lượt
 * mô hình chào lại, có lượt nó gọi tìm với q "chào bạn" và trợ lý báo "chưa tìm
 * thấy món nào khớp chào bạn".
 */
export function isGreeting(q: string): boolean {
  const words = tokens(q);
  return words.length > 0 && words.every((w) => GREETING_WORDS.has(w));
}

/** Hạ chữ thường, tách chữ, GIỮ dấu: "bàn" và "bán" là hai chữ khác nhau. */
function tokens(s: string): string[] {
  return s
    .normalize('NFC')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

function stripAccents(w: string): string {
  return w
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd');
}

/**
 * Chữ chung chung không nói lên món gì: "giày chạy bộ như mới" mà tính cả
 * "như", "mới" thì áo khoác như mới cũng được điểm. Viết CÓ dấu: bỏ "bán"
 * nhưng giữ "bàn" (cái bàn).
 */
const STOP_WORDS = new Set([
  'cũ',
  'mới',
  'như',
  'còn',
  'đẹp',
  'rẻ',
  'giá',
  'hàng',
  'mua',
  'bán',
  'tìm',
  'cho',
  'mình',
  'tôi',
  'cần',
  'dưới',
  'trên',
  'ở',
  'tại',
  'và',
  'loại',
  'cái',
]);

/**
 * Món phải có ít nhất 60% số chữ của câu hỏi. Câu hai chữ ("máy ảnh") phải
 * khớp cả hai, nên máy xay không lọt; "nồi cơm điện Nhật" (mô hình hay giữ chữ
 * xuất xứ) thì nồi cơm điện khớp 3/4 vẫn giữ.
 */
const MIN_COVERAGE = 0.6;

/**
 * Xếp món theo phần chữ của câu hỏi có trong tên, bỏ món khớp dưới ngưỡng.
 *
 * Vì sao cần: tìm kiếm của sàn (FULLTEXT, collation unicode_ci) trả món chỉ cần
 * trùng MỘT chữ và không phân biệt dấu. Đo trên staging 12/11: hỏi "nồi cơm
 * điện" ra nồi áp suất, hỏi "bàn" ra máy nướng bánh mì, hỏi "máy ảnh" ra máy
 * xay. Thà trả rỗng (trợ lý gợi ý gõ ngắn hơn) còn hơn đưa món sai lên đầu.
 *
 * Chữ có dấu phải khớp đúng dấu; người dùng gõ không dấu ("may anh") thì khớp
 * cả chữ có dấu. Điểm bằng nhau giữ thứ tự gốc của tìm kiếm.
 */
export function rankByName<T extends { name: string }>(
  items: T[],
  q: string,
): T[] {
  let want = [...new Set(tokens(q))].filter((w) => !STOP_WORDS.has(w));
  // "điện thoại iPhone": tên món chỉ ghi "iPhone 13", không ghi "điện thoại",
  // nên chỉ còn khớp 1/3 chữ và bị loại. Bỏ cụm chung này khi còn chữ khác.
  const generic = ['điện', 'thoại'];
  if (generic.every((w) => want.includes(w)) && want.length > 2)
    want = want.filter((w) => !generic.includes(w));
  if (!want.length) return items;
  const coverage = (name: string) => {
    const have = tokens(name);
    const exact = new Set(have);
    const bare = new Set(have.map(stripAccents));
    const hit = want.filter((w) =>
      stripAccents(w) === w ? bare.has(w) : exact.has(w),
    );
    return hit.length / want.length;
  };
  return items
    .map((item, i) => ({ item, i, c: coverage(item.name) }))
    .filter((x) => x.c >= MIN_COVERAGE)
    .sort((a, b) => b.c - a.c || a.i - b.i)
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
