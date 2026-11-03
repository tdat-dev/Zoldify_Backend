---
name: mobile-feature-first-migration
description: Zoldify_Mobile đang refactor sang feature-first + auth-gate; đang dở trên nhánh riêng
metadata: 
  node_type: memory
  type: project
  originSessionId: <session>
  modified: 2026-08-19T08:38:06.643Z
---

Zoldify_Mobile (Expo SDK 57) đang được refactor từ layer-based sang **feature-first**,
trên nhánh `refactor/feature-first-structure` (CHƯA merge, CHƯA push).

Đã xong (theo lộ trình trong `Zoldify_Mobile/docs/ARCHITECTURE.md`):
- **P0**: `src/features/{products,auth}` (api.ts = query-key factory + hooks colocated,
  screens/), `src/lib/{api/client.ts, api/query-client.ts, auth/token-store.ts, env.ts (zod)}`.
  Route trong `src/app/` chỉ re-export mỏng.
- **P0-2**: route groups `app/(auth)/` + `app/(app)/(tabs)/`, Zustand session
  `features/auth/store.ts` (status hydrating/signedIn/signedOut, user từ GET /auth/profile),
  cổng đăng nhập bằng `Stack.Protected guard={}` (chuẩn SDK 57, không router.replace thủ công),
  native splash che tới khi hydrate xong rồi mới mount AnimatedSplashOverlay (chống nháy login).

Verify mỗi bước: `npm run typecheck` xanh + `expo export --platform web` bundle OK.

Còn lại (chưa làm): register screen; **refresh-token single-flight** (chờ backend có
`POST /auth/refresh` — chỗ sửa đã ghi trong `src/lib/api/client.ts`); P1: socket↔Query,
design-system, testing, eas.json, Sentry, **eslint (đang vướng peer typescript@6 vs
openapi-typescript ^5, expo lint tự-cài fail)**. Xem [[deploy-vps-backend]] cho backend.

**Onboarding (2026-08-17):** 8 màn (splash→welcome carousel→email-entry→branch→
login/register/otp/passkey) phong cách tối giản/đáng tin, font **Be Vietnam Pro**,
design-system ở `src/components/ui/`. OTP đăng ký nối API THẬT
(`/auth/register/send-otp` + `verify-otp`), passkey là mockup (login thật xảy ra ở
màn passkey). Spec: `docs/superpowers/specs/2026-08-17-onboarding-design.md`. Font
grotesk cliché (Space Grotesk) bị tránh theo frontend-design skill.

**Ecommerce guest-first (2026-08-19):** bỏ auth-wall — mở app vào thẳng **feed
sản phẩm** (backend `/products` @Public), đăng nhập chỉ khi mua/bán/giỏ/chat
(`features/auth/use-require-auth`). Có **product detail** (`/products/[id]`),
**tìm kiếm** thật (`?q=`, `useProductSearch`), **bottom tab bar** 5 tab theo web
(Trang chủ/Giỏ/Đăng bán/Thông báo/Tài khoản, icon `@expo/vector-icons` Feather;
cart/sell/notifications = placeholder, account có đăng xuất).

**Design-system PORT từ web frontend** (`Zoldify_Frontend`): doctrine "sổ kê" —
giá ĐỎ `#CE1D21`, nền `#F2F4F7`, ink `#192029`, chrome navy `#043574`, góc 4px,
hairline `ink/8-12`, thang chữ web (body 14…). Token OKLCH của web đã quy đổi hex
trong `components/ui/theme.ts`. Font Be Vietnam Pro (web+mobile trùng).

**Verify preview web:** backend chạy LOCAL `npm run start:dev` cổng 3000 (DB dev
container `zoldify-mysql`, 376 sản phẩm seed), CORS cần `SITE_URL` gồm
`http://localhost:8081` (truyền inline; nên thêm vào `.env` cho cố định). Web
preview: `EXPO_PUBLIC_API_ORIGIN=http://localhost:3000 npx expo start --web`.
KHÔNG trỏ prod (VPS CORS chặn localhost). Verify bằng realbrowser (read/type OK;
screenshot RPC hay timeout với RN-web).

Chưa chạy trên device/emulator iOS thật — mới verify web preview + typecheck.
