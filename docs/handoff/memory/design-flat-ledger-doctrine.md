---
name: design-flat-ledger-doctrine
description: "Zoldify_Frontend cố ý dùng ngôn ngữ \"sổ kê\" phẳng — góc gần vuông, hairline, KHÔNG pill/glow. Đừng \"làm đẹp\" bằng bo tròn hay bóng màu."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: <session>
  modified: 2026-09-05T05:19:31.322Z
---

Zoldify_Frontend có một **doctrine thiết kế cố ý**, ghi rõ trong `tailwind.config.ts` (block `borderRadius`, ~dòng 130): ba mức bo đặt theo VAI TRÒ, hạ từ 10/14/16 xuống **`control: 4px`, `card: 4px`, `modal: 8px`** ngày 2026-08-08. Comment nói thẳng: *"Bo góc lớn cộng rounded-full ở ô tìm kiếm và chip là ngôn ngữ 'app thân thiện'; sàn này đọc đúng hơn ở dạng SỔ KÊ — hairline, góc gần vuông, cột thẳng."*

**Why:** Mình từng "polish" thanh search bằng `rounded-full` (pill) + bóng glow màu brand ở nút — user phản đối ngay ("nút không tròn quá như thế"), và config xác nhận đó là đi ngược doctrine. Prettify kiểu SaaS/app friendly (pill, gradient, glow) là SAI với sàn C2C đồ cũ này.

**How to apply:** Trước khi chọn bo góc / bóng cho UI Zoldify, đọc block `borderRadius` trong `tailwind.config.ts`. Dùng `rounded-control`/`rounded-card` (4px), KHÔNG `rounded-full` cho input/button/card (chỉ chip nhỏ/avatar tròn mới hợp). Ưu tiên viền hairline (`border-ink/10..16`), bóng trung tính nhẹ (`shadow-sm`) — KHÔNG bóng màu brand/glow. Muốn "đẹp hơn" thì tăng chiều sâu qua trạng thái (giếng nghỉ→hover→focus), typography, spacing — giữ mặt phẳng. Header thật sự đang render là `Header.tsx` MỘT TẦNG (không phải bản 2 tầng cũ trong ảnh screenshot). Liên quan [[admin-dev-setup]].

**Đĩa icon danh mục = TRẮNG, không tint (2026-09-05):** Ảnh danh mục (API `/categories`, host `img.zoldify.com/default/{slug}-*.png`) **vốn đã là PNG nền trong suốt** (RGBA, product cắt nền sẵn). Nên đĩa tròn bọc ảnh PHẢI `bg-white` + hairline `ring-1 ring-ink/10` — KHÔNG `bg-brand-tint`/`bg-surface-sunken`, vì màu đĩa lộ ra sau vùng trong suốt = user đọc là "phông xấu đằng sau ảnh". Đã sửa `CategoryTiles.tsx` + `CategoryRail.tsx` (ô có ảnh→đĩa trắng; ô chữ-cái/icon fallback mới giữ tint cho khỏi rỗng). Ảnh KHÔNG cần đụng (đã cutout sẵn) — vấn đề chỉ ở màu đĩa. `--surface-card = 1 0 0` (trắng tinh) nên đĩa trắng chỉ còn hairline vẽ vòng.
