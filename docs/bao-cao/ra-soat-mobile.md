# Rà soát `Zoldify_Mobile` — đối chiếu rubric capstone

**Ngày:** 2026-09-24 · **Nhánh:** `main` @ `1e93875` · **87 commit**

> Ghi ra file thay vì giữ trong đầu, đúng lý do `docs/BAN-GIAO.md` nêu: ngữ cảnh
> của một phiên làm việc sẽ mất, file thì không.

---

## 1. Kết luận

Repo mobile **tốt hơn nhiều** so với những gì kế hoạch 06/08 ghi lại. Ba mục mà
tôi tưởng còn thiếu — **OAuth, push notification, state management** — đều đã có
thật ở đây. Chúng thiếu ở *backend* `staging`, không phải thiếu ở dự án.

Còn đúng **hai** khoảng trống: **offline mode** và **bằng chứng iOS chạy thật**.

---

## 2. Công nghệ

| | |
|---|---|
| Nền tảng | **Expo SDK 57** (managed / CNG) · React Native 0.86 · React 19.2 |
| Điều hướng | `expo-router` v57, typed routes |
| Giao diện | NativeWind 4 + Tailwind 3, font Be Vietnam Pro |
| **State management** | **Zustand 5 + TanStack Query 5** |
| Gọi API | axios, có interceptor token + refresh-queue |
| Kiểu dữ liệu API | `openapi-typescript` sinh `src/api/schema.d.ts` **từ `openapi.json` của backend** |
| Form | react-hook-form + zod |
| Build | **EAS** (projectId `9d3de819…`, owner `nguyenhuy140923`) |

149 file `.ts/.tsx`, chia **feature-first 16 nhóm** (`account`, `addresses`,
`auth`, `cart`, `categories`, `chat`, `checkout`, `follows`, `notifications`,
`onboarding`, `orders`, `products`, `reviews`, `shared`, `shop`, `wishlist`) —
cùng triết lý với backend.

> **Điểm đáng kể cho báo cáo:** `npm run gen:api` sinh kiểu TypeScript của app
> thẳng từ `openapi.json` của backend. Hợp đồng API không phải chép tay giữa hai
> repo — đổi endpoint ở backend, chạy lại lệnh là app báo lỗi biên dịch ngay.
> Đây là thứ hội đồng hỏi "hai bên đồng bộ kiểu gì" thì trả lời được bằng lệnh.

---

## 3. Đối chiếu rubric Level 3

| Tiêu chí | Trạng thái | Bằng chứng |
|---|---|---|
| React Native / Flutter | ✅ | Expo SDK 57 |
| **Gọi API tới hosting thật, không local** | ✅ | `eas.json` — cả 3 profile (`development`, `preview`, `production`) đặt `EXPO_PUBLIC_API_ORIGIN=https://api.zoldify.com` |
| **State management** | ✅ | Zustand + TanStack Query |
| **OAuth** | ✅ | `@react-native-google-signin` + `expo-auth-session` · `src/features/auth/use-google-auth.ts` |
| **Push notifications** | ✅ | `expo-notifications` + `google-services.json` · `src/features/notifications/push.ts` |
| Real-time | ✅ | `socket.io-client` · `src/features/chat/socket.ts`, `realtime.ts` |
| Chạy Android | ✅ | `android.package = com.zoldify.app`, adaptive icon đủ bộ |
| Chạy iOS | ⚠️ | Cấu hình đủ (`bundleIdentifier`, URL scheme Google), **chưa thấy bằng chứng build thật** — xem mục 5 |
| **Offline mode** | ❌ | Không có `persistQueryClient`, không `NetInfo`, không AsyncStorage cho cache |

`src/lib/env.ts` xử lý đúng bẫy kinh điển: emulator Android không dùng được
`localhost`, có fallback dev và thông báo lỗi chỉ thẳng biến cần sửa. Bản build
EAS thì luôn trỏ `api.zoldify.com` — **demo trước hội đồng không chạm máy local**,
đúng yêu cầu mục 10 của thầy.

---

## 4. Đóng góp git — sửa lại nhận định cũ

Nhận định "Đạt 0 commit trong 30 ngày" của tôi hôm 24/09 **chỉ đúng với repo
backend**. Nhìn cả dự án thì ngược lại:

| Người | Mobile (tổng) | Mobile (30 ngày) |
|---|---|---|
| `tdatdev` (Đạt) | **83** | **39** |
| `Nguyễn Huy` | 4 | 4 |

Đạt chuyển sang làm mobile, không phải ngừng làm. Commit gần nhất 23/09.

---

## 5. Hai việc còn lại

### ❶ Offline mode — thiếu thật

Rubric Level 3 gọi tên `handling offline mode`. Hiện chỉ có `expo-secure-store`
giữ token; dữ liệu sản phẩm/đơn hàng không được cache lại.

Chi phí thấp vì đã có TanStack Query: thêm `@tanstack/query-async-storage-persister`
+ `persistQueryClient` là có chế độ đọc offline cho danh sách sản phẩm và đơn
hàng. Ước lượng nửa ngày công.

### ❷ iOS — ĐÃ XÁC NHẬN CHẠY

Cường xác nhận 24/09: **iOS chạy được**. Cấu hình trong repo khớp với điều đó —
`ios.bundleIdentifier = com.zoldify.app`, URL scheme Google đã khai trong
`infoPlist`, `eas.json` build cho máy thật (`ios.simulator = false`).

Rủi ro "không được bảo vệ vì thiếu iOS" **đóng lại**. Còn một việc nhỏ thuộc
khâu chuẩn bị demo, không phải khâu code: giữ sẵn một bản build iOS đã cài trên
máy thật cầm tới hôm bảo vệ, đừng phụ thuộc vào việc build tại chỗ.

---

## 6. Ảnh hưởng tới nhận định về backend

Ba mục tôi đánh ❌ cho `staging` hôm qua cần đọc lại cho đúng:

| Mục | Đọc lại |
|---|---|
| OAuth | App **có**. Backend `staging` **không có** endpoint tương ứng — nhưng nhánh production `chore/soat-cau-hinh-payos-firebase` **có** (`feat(auth): cho phép ĐẶT mật khẩu cho tài khoản Google/social`) |
| Push notification | App **có**. Backend: cũng chỉ nằm ở nhánh production (`feat(notifications): push FCM…`) |
| Sơ đồ "mất 17/20" | **Sai** — 3 file `.drawio` gộp **35 trang sơ đồ** + 20 PNG trong `renders/`. Không thiếu gì |

→ Củng cố thêm kết luận cũ: **việc chặn số 1 vẫn là hợp nhất production ↔ staging**.
App mobile đang gọi `api.zoldify.com`, tức nhánh production — nhánh đi sau
`staging` 142 commit. App dùng OAuth và push thì *phải* trỏ production, nhưng
production lại thiếu toàn bộ phần Redis / worker / webhook GHN / sửa hiệu năng
của staging.
