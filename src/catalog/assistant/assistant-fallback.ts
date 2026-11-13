import { AssistantFilters, parsePrice } from './assistant-filters';
import type { ChatMessage } from './assistant-model';

/**
 * Đường lui khi mô hình lỗi hay quá giờ: tự tách giá, tỉnh, bỏ chữ thừa, không
 * cần mạng. Đo staging 13/11 (150 lượt): router 9router trả 503 năm lần, quá
 * hạn ba lần; tìm bằng nguyên câu gõ thì "loại dưới 200k thôi" thành từ khoá
 * "200k thôi". Không bằng mô hình (không hiểu nhu cầu, không dịch), nhưng đủ
 * cho câu thường gặp: tên món, tầm giá, nơi nhận, câu nối tiếp.
 */

// Đơn vị dài đứng trước: nếu "tr" đứng trước "triệu" thì "3 triệu" chỉ khớp "tr" và sót lại "iệu".
const NUM = String.raw`(\d+(?:[.,]\d+)?)\s*(triệu|trieu|tr|nghìn|nghin|ngàn|ngan|k|củ|cu|m)?`;
const RANGE = new RegExp(
  String.raw`(?:từ|tu)\s+${NUM}\s*(?:đến|den|tới|toi|-)\s*${NUM}`,
  'u',
);
const MAX = new RegExp(
  String.raw`(?:dưới|duoi|tối đa|toi da|không quá|khong qua|tầm|tam|khoảng|khoang|max)\s+${NUM}`,
  'u',
);
const MIN = new RegExp(String.raw`(?:trên|tren|từ|tu|hơn|hon)\s+${NUM}`, 'u');

const PROVINCES: [RegExp, string][] = [
  [
    /(?:tp\.?\s*)?(?:hồ chí minh|ho chi minh|hcm|sài gòn|sai gon|saigon|\bsg\b)/u,
    'Hồ Chí Minh',
  ],
  [/(?:hà nội|ha noi|\bhn\b)/u, 'Hà Nội'],
  [/(?:đà nẵng|da nang)/u, 'Đà Nẵng'],
];

/**
 * Chữ không nói lên món gì, cả dạng có dấu lẫn gõ không dấu. Không bỏ "tai"
 * (tai nghe) dù "tại" gõ không dấu cũng là "tai".
 */
const DROP = new Set([
  'tìm',
  'tim',
  'mua',
  'cho',
  'mình',
  'minh',
  'tôi',
  'toi',
  'cần',
  'can',
  'muốn',
  'muon',
  'giúp',
  'giup',
  'loại',
  'loai',
  'cái',
  'cai',
  'thôi',
  'thoi',
  'nhé',
  'nhe',
  'nha',
  'với',
  'voi',
  'ạ',
  'đi',
  'ơi',
  'có',
  'co',
  'không',
  'khong',
  'ở',
  'o',
  'tại',
  'giá',
  'gia',
  'rẻ',
  're',
  'cũ',
  'cu',
  'mới',
  'moi',
  'như',
  'nhu',
  'còn',
  'con',
  'đẹp',
  'dep',
  'hàng',
  'đồng',
  'vnd',
  'đ',
]);

/** "200k" -> 200000; số không có đơn vị dưới 1000 hiểu là nghìn ("dưới 500"). */
function money(num: string, unit: string | undefined): number | undefined {
  const u =
    unit === 'nghin' || unit === 'ngan'
      ? 'k'
      : unit === 'củ' || unit === 'cu'
        ? 'tr'
        : unit;
  if (!u && Number(num.replace(',', '.')) < 1000) return parsePrice(`${num}k`);
  return parsePrice(`${num}${u ?? ''}`);
}

function parseOne(text: string): AssistantFilters {
  let s = ` ${text.normalize('NFC').toLowerCase()} `;
  const out: AssistantFilters = { q: '' };

  const range = s.match(RANGE);
  if (range) {
    // "từ 1 đến 3 triệu": số đầu không có đơn vị thì mượn đơn vị số sau.
    out.price_min = money(range[1], range[2] ?? range[4]);
    out.price_max = money(range[3], range[4]);
    s = s.replace(range[0], ' ');
  }
  const max = s.match(MAX);
  if (max && out.price_max === undefined) {
    out.price_max = money(max[1], max[2]);
    s = s.replace(max[0], ' ');
  }
  const min = s.match(MIN);
  if (min && out.price_min === undefined) {
    out.price_min = money(min[1], min[2]);
    s = s.replace(min[0], ' ');
  }
  for (const [re, name] of PROVINCES) {
    if (re.test(s)) {
      out.province = name;
      s = s.replace(re, ' ');
      break;
    }
  }
  out.q = s
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w && !DROP.has(w))
    .join(' ')
    .slice(0, 80);
  if (out.price_min === undefined) delete out.price_min;
  if (out.price_max === undefined) delete out.price_max;
  return out;
}

export function parseFallback(history: ChatMessage[]): AssistantFilters {
  const users = history.filter((m) => m.role === 'user').map((m) => m.content);
  const out = parseOne(users.at(-1) ?? '');
  // Câu nối tiếp ("loại dưới 200k thôi") không có tên món: lấy từ câu trước gần nhất.
  for (let i = users.length - 2; !out.q && i >= 0; i--) {
    out.q = parseOne(users[i]).q;
  }
  return out;
}
