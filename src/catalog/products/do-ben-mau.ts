import { DANH_MUC_CO_PIN, type DoBen } from './do-ben';

/**
 * Độ bền MẪU cho dữ liệu seed, KHÔNG dùng cho tin thật: tin thật để `null`
 * tới khi người bán tự khai. Script `scripts/dien-do-ben-seed.ts` gọi hàm này.
 *
 * Tất định theo `id`: chạy lại ra đúng giá trị cũ, nên đường lùi của script so
 * khớp từng dòng và chỉ xoá đúng thẻ nó đã ghi, không xoá thẻ người bán sửa sau.
 *
 * Các khoảng số bám thang tình trạng của web: Như mới pin 95-100%, Tốt 88-94%,
 * Khá 80-87%, Cũ 70-79%. Cùng một `id` thì mức cũ hơn không có pin cao hơn.
 */

/** Băm Knuth ra số trong [0, 1). Đủ đều cho mẫu, không dùng cho bảo mật. */
function ngauNhien(id: number, muoi: number): number {
  const h = Math.imul(id ^ Math.imul(muoi, 0x9e3779b1), 2654435761) >>> 0;
  return h / 0x1_0000_0000;
}

function trongKhoang(r: number, thap: number, cao: number): number {
  return thap + Math.floor(r * (cao - thap + 1));
}

const KHUYET_DIEM: Record<string, string[]> = {
  dien_tu: [
    'Xước nhẹ ở viền',
    'Mặt lưng có vết xước dăm',
    'Cấn nhẹ một góc',
    'Màn hình có vết xước nhỏ, không ảnh hưởng hiển thị',
  ],
  'quan-ao': [
    'Sờn nhẹ cổ áo',
    'Bạc màu nhẹ sau giặt',
    'Đường chỉ bung nhẹ ở gấu',
  ],
  'the-thao': ['Trầy nhẹ bề mặt', 'Đế mòn nhẹ', 'Tay cầm hơi sờn'],
  'nau-an': [
    'Ố nhẹ ở đáy',
    'Lớp chống dính trầy nhẹ',
    'Vỏ ngoài có vết xước dăm',
  ],
  khac: ['Trầy nhẹ bề mặt', 'Dây hơi sờn'],
};

const PHU_KIEN: Record<string, string[]> = {
  'dien-thoai': ['Hộp', 'Cáp sạc', 'Củ sạc'],
  laptop: ['Hộp', 'Sạc', 'Túi chống sốc'],
  'may-tinh-bang': ['Hộp', 'Cáp sạc', 'Bao da'],
  'tai-nghe': ['Hộp', 'Cáp sạc', 'Nút tai dự phòng'],
  'dong-ho': ['Hộp', 'Dây sạc', 'Dây đeo dự phòng'],
  'nau-an': ['Hộp', 'Sách hướng dẫn'],
  'quan-ao': ['Túi giấy', 'Tem mác'],
  'phu-kien': ['Hộp'],
};

const DA_SUA: Record<string, string> = {
  dien_tu: 'Đã thay màn hình', // không ghi "thay pin": mức Khá, Cũ có pin 70-87%
  'quan-ao': 'Đã khâu lại đường chỉ',
  'the-thao': 'Đã thay tay cầm',
  'nau-an': 'Đã thay gioăng nắp',
  khac: 'Đã thay khoá cài',
};

const TAN_TRANG: Record<string, string> = {
  dien_tu: 'Tân trang: thay pin, thay vỏ, vệ sinh máy',
  khac: 'Tân trang: làm mới bề mặt, vệ sinh kỹ',
};

/** Pin theo mức, từ cùng một `r` để mức cũ hơn không bao giờ pin cao hơn. */
const PIN: Record<string, [number, number]> = {
  new: [100, 100],
  like_new: [95, 100],
  good: [88, 94],
  fair: [80, 87],
  used: [70, 79],
  refurbished: [100, 100],
};

const THANG_DUNG: Record<string, [number, number]> = {
  new: [0, 0],
  like_new: [1, 6],
  good: [4, 18],
  fair: [12, 30],
  used: [18, 48],
  refurbished: [12, 36],
};

const SO_KHUYET_DIEM: Record<string, [number, number]> = {
  new: [0, 0],
  like_new: [0, 0],
  good: [0, 1],
  fair: [1, 2],
  used: [2, 2],
  refurbished: [0, 0],
};

const SO_PHU_KIEN: Record<string, [number, number]> = {
  new: [9, 9],
  like_new: [2, 2],
  good: [1, 2],
  fair: [0, 1],
  used: [0, 1],
  refurbished: [1, 1],
};

/** Tỉ lệ đã sửa ở mức Khá và Cũ; mới, như mới, tốt thì chưa sửa. */
const TI_LE_SUA: Record<string, number> = { fair: 0.2, used: 0.35 };

export function doBenMau(
  id: number,
  condition: string,
  categorySlug: string,
): DoBen {
  const muc = condition in PIN ? condition : 'good';
  const coPin = DANH_MUC_CO_PIN.includes(categorySlug);
  const nhom = coPin
    ? 'dien_tu'
    : categorySlug in KHUYET_DIEM
      ? categorySlug
      : 'khac';
  const r = (muoi: number) => ngauNhien(id, muoi);
  const ra: DoBen = {};

  if (coPin) ra.battery_health = trongKhoang(r(1), ...PIN[muc]);
  ra.used_months = trongKhoang(r(2), ...THANG_DUNG[muc]);

  // Quần áo, đồ thể thao, phụ kiện không có bảo hành; đồ điện tử và đồ bếp có.
  if (coPin || categorySlug === 'nau-an') {
    ra.warranty_months =
      muc === 'new'
        ? 12
        : muc === 'like_new'
          ? trongKhoang(r(3), 3, 11)
          : muc === 'good'
            ? trongKhoang(r(3), 0, 6)
            : muc === 'refurbished'
              ? 6
              : 0;
  }

  const dsLoi = KHUYET_DIEM[nhom];
  const soLoi = trongKhoang(r(4), ...SO_KHUYET_DIEM[muc]);
  if (soLoi > 0) {
    const dau = Math.floor(r(5) * dsLoi.length);
    ra.defects = Array.from(
      { length: Math.min(soLoi, dsLoi.length) },
      (_, i) => dsLoi[(dau + i) % dsLoi.length],
    );
  }

  const dsPk = PHU_KIEN[categorySlug] ?? [];
  const soPk = Math.min(trongKhoang(r(6), ...SO_PHU_KIEN[muc]), dsPk.length);
  if (soPk > 0) ra.accessories = dsPk.slice(0, soPk);

  if (muc === 'refurbished') {
    ra.repaired = true;
    ra.repair_note = TAN_TRANG[coPin ? 'dien_tu' : 'khac'];
  } else if (r(7) < (TI_LE_SUA[muc] ?? 0)) {
    ra.repaired = true;
    ra.repair_note = DA_SUA[nhom];
  } else {
    ra.repaired = false;
  }
  return ra;
}
