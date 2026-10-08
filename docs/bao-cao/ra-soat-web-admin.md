# Rà soát `Zoldify_Frontend` và `Zoldify_Admin`

**Ngày:** 2026-09-24 · Frontend `main` @ `eeedc64` · Admin `main` @ `37b0e91`

---

## 1. Kết luận

**Web bán hàng: chắc.** 509 commit, 30 trang, đa ngôn ngữ thật, CI/CD riêng, chạy
trên domain thật.

**Khu quản trị: đã làm xong nhưng chưa lên production.** Bảy trang quản trị nằm
trên nhánh `staging` của `Zoldify_Admin` (18 commit), `main` chỉ có 2 commit và
một trang giữ chỗ. `admin.zoldify.com` đang phục vụ bản giữ chỗ đó.

Đây là **cùng một bệnh với backend**: việc đã làm xong nhưng đọng ở nhánh, chưa
đẩy lên bản mà hội đồng sẽ bấm vào.

---

## 2. `Zoldify_Frontend`

| | |
|---|---|
| Nền tảng | **Next.js 14.2.35** · React 18 · Tailwind |
| **Đa ngôn ngữ** | **`next-intl` 3.26 — `en.json` + `vi.json`, 33 namespace mỗi bản** |
| Gọi API | axios · `NEXT_PUBLIC_API_ORIGIN` |
| Kiểu API | `npm run gen:api` sinh từ `openapi.json` của backend |
| Real-time | `socket.io-client` |
| Khác | firebase, sharp, lucide-react |
| Quy mô | **509 commit · 107 file · 30 trang** |
| CI/CD | `ci.yml` + `deploy.yml` riêng |

**Deploy:** `deploy-prod` → `zoldify.com` · `staging` → `staging.zoldify.com`.
Cùng khuôn SSH-vào-VPS như backend.

**30 trang đã có:** trang chủ, tìm kiếm, danh mục, chi tiết sản phẩm, tạo/sửa sản
phẩm, giỏ hàng, thanh toán (return + cancel của PayOS), địa chỉ (CRUD), hồ sơ,
đổi mật khẩu, đơn hàng người mua, sản phẩm của tôi, ví, cửa hàng, đơn của shop,
cài đặt shop, chat, thông báo, đăng nhập/đăng ký/quên–đặt lại mật khẩu, bảo trì.

> **`check:tokens` và `check:i18n`** là hai cổng CI tự viết. Cái thứ hai ép
> `en.json` và `vi.json` không được lệch khoá — tức đa ngôn ngữ ở đây là ràng
> buộc có máy kiểm, không phải "dịch được vài chữ". Đáng đưa vào báo cáo.

### Cần xác nhận

`deploy.yml` đặt `NEXT_PUBLIC_API_ORIGIN=https://api.zoldify.com` ở **job gate**
(bản build kiểm tra, vứt đi). Bản chạy thật build trên VPS bằng
`docker compose up -d --build frontend`, nên origin thật đến từ compose trên VPS.
Cần kiểm `staging.zoldify.com` gọi `api-staging` chứ không gọi `api` production —
tôi không đọc được điều này từ HTML trả về.

---

## 3. `Zoldify_Admin`

| Nhánh | Commit | Trang |
|---|---|---|
| `main` | 2 | **1** (giữ chỗ) |
| `chore/deploy-docker` | 4 | 1 |
| **`staging`** | **18** | **7** ✅ |

Nhánh `staging` có đủ: `page.tsx` (dashboard), `orders`, `products`,
`categories`, `users`, `withdrawals`, `settings`.

`README.md` trên `main` vẫn ghi *"Trạng thái: mới có khung. Bảy trang quản trị
chưa được chuyển sang"* — mô tả này **đã lạc hậu**, việc đó làm xong trên
`staging` rồi.

**Đã kiểm trực tiếp:** HTML của `admin.zoldify.com` còn chứa chữ "Khung"
(bản giữ chỗ); `admin-staging.zoldify.com` thì không.

Admin có `ci.yml` nhưng **không có `deploy.yml`** — khác với backend và frontend.
Cần biết `admin.zoldify.com` đang được cập nhật bằng cách nào.

### Một chi tiết đáng lưu ý cho lịch sử dự án

Bảy trang quản trị bản gốc nằm ở `Zoldify_Frontend/src/app/admin/`, bị xoá khỏi
`main` ở commit `22fe90c`. Hiện chúng **chỉ còn trên nhánh
`origin/feat/p4-buyer-confirm-receipt`** của repo frontend (9 file).

Việc tách ra repo riêng đã hoàn tất ở `Zoldify_Admin/staging`, nên không mất mát
gì. Nhưng nếu cần đối chiếu bản cũ thì đó là chỗ tìm.

---

## 4. Cập nhật đối chiếu rubric

Sau khi đọc cả 4 repo, bảng rubric Level 3 phải sửa lại đáng kể:

| Tiêu chí | Trước (chỉ nhìn backend) | Thật |
|---|---|---|
| **Multi-language** | ❌ | ✅ `next-intl`, en+vi, 33 namespace, **có cổng CI `check:i18n`** |
| **OAuth** | ❌ | ✅ Google Sign-In trong app mobile |
| **Push notification** | ❌ | ✅ `expo-notifications` + FCM |
| **Admin dashboard** | 🟡 | ✅ 7 trang — **nhưng đang ở nhánh `staging`, chưa lên production** |
| State management | — | ✅ Zustand + TanStack Query |
| Payment gateway thật | ✅ | ✅ PayOS |
| Rate limiting | ✅ | ✅ |
| Caching | ✅ | ✅ Redis (production đang `redis: off`) |
| Test | ✅ | ✅ 20 spec backend chạy MySQL thật |
| **Recommendation system** | ❌ | ❌ vẫn thiếu |
| **AI chat** | ❌ | ❌ vẫn thiếu |
| **Offline mode** | — | ❌ thiếu ở mobile |
| Real-time | 🟡 chat | 🟡 vẫn chỉ chat, chưa có tồn kho real-time |

**Chỉ còn 4 mục thiếu thật**, thay vì 7 như tôi nói hôm qua. Và ba trong bốn mục
(`recommendation`, `AI chat`, `offline`) là tính năng cộng điểm, không phải điều
kiện cần.

---

## 5. Dấu vết git toàn dự án

Thầy chấm điểm tham gia theo git (mục 9.2, 9.3). Nhìn đủ 4 repo:

| Người | Backend | Frontend | Mobile | Admin | **Tổng** |
|---|---|---|---|---|---|
| `tdatdev` (Đạt) | 108 | 380 | 83 | 7 | **578** |
| `LMCuong2K1` (Cường) | 134 | — | — | — | **134** |
| `Nguyễn Huy` | 25 | 131 | 4 | 11 | **171** |
| `linkk` / `Mai Linh` | — | 15 | — | — | **15** |
| `anday06` | 1 | 3 | — | — | **4** |

Nhận định "Đạt 0 commit trong 30 ngày" của tôi hôm 24/09 **sai** — đó chỉ là repo
backend. Đạt là người đóng góp nhiều nhất dự án.

Rủi ro thật nằm ở **`anday06` (4 commit)** và **`linkk` (15 commit)**. Thầy nói
rõ sẽ căn cứ mức độ hoạt động để cho điểm từng người.

---

## 6. Việc chặn, cập nhật sau khi đọc đủ 4 repo

Cùng một hình dạng lặp lại ở **ba** repo: **việc đã xong, đọng ở nhánh, chưa lên
bản production mà hội đồng sẽ bấm.**

| Repo | Production đang chạy | Việc đã xong nhưng chưa lên |
|---|---|---|
| Backend | nhánh `chore/soat-cau-hinh-payos-firebase` | `staging` đi trước **142 commit** |
| Admin | `main` (bản giữ chỗ) | `staging` — **7 trang quản trị** |
| Frontend | `deploy-prod` | cần đối chiếu với `main`/`staging` |

**Đây là việc số 1 của cả dự án**, không phải việc viết thêm tính năng.
