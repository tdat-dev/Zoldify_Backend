---
name: mobile-google-signin
description: "Google sign-in Zoldify_Mobile (Firebase zoldify) — NATIVE GSI, ĐÃ CHẠY+verify live Android (2026-08-28); root cause invalid_request = policy Google chặn browser+client Android. iOS chờ EAS."
metadata: 
  node_type: memory
  type: project
  originSessionId: <session>
  modified: 2026-09-04T14:52:18.569Z
---

> ✅ **ĐÃ SỬA XONG & VERIFY LIVE (2026-08-28):** Google sign-in Android CHẠY hoàn hảo. Đăng nhập ra
> **Đạt Đặng / <google-account>@gmail.com** (avatar Google thật) trên emulator. Lỗi invalid_request đã hết.

## Root cause của `invalid_request` (đã fix)
expo-auth-session `57.0.7` mở OAuth qua **trình duyệt/Custom Tab** dùng **client ID loại "Android"** +
redirect custom-scheme `com.zoldify.app:/oauthredirect` (xem provider Google.js dòng ~145, bản reverse-
client-id bị comment out). **Google CHẶN** luồng browser với client Android → 400 invalid_request. Custom-
scheme chỉ được chấp nhận cho client **iOS** (reverse-client-id trong CFBundleURLTypes → nên iOS chạy) và
**Web** (https). Android BẮT BUỘC dùng Google Identity Services **native**. Đã loại trừ: SHA-1 khớp
(APK `5e8f1606...` = cái đăng ký), client ID đúng, request đúng format — vấn đề ở CHÍNH SÁCH Google, không
phải config.

## Giải pháp: NATIVE GSI (@react-native-google-signin/google-signin v16.1.4)
Thay hẳn expo-auth-session. `use-google-auth.ts`: `GoogleSignin.configure({webClientId, iosClientId})` (chỉ
native, guard `Platform.OS!=='web'`) → `hasPlayServices()` → `signIn()` → `res.data.idToken` (phát hành cho
webClientId nên Firebase chấp nhận) → `GoogleAuthProvider.credential` → `signInWithCredential` → getIdToken →
`POST /auth/firebase`. `isSuccessResponse`/`isErrorWithCode`+`statusCodes.SIGN_IN_CANCELLED` để nuốt huỷ.
`googleAvailable()`: native-only (web ẩn nút; vẫn loại Expo Go). Config plugin `@react-native-google-signin/
google-signin` tự thêm vào app.json (autolink gradle lúc build). Commit mobile `refactor/feature-first-structure`.
**CẦN rebuild native** (module native mới) — đã build `expo run:android` (BUILD SUCCESSFUL ~6m cache nóng).
Verify live: bấm nút → `SignInHubActivity` (Google native) mở → chọn account → vào app, Account hiện tên+email+
avatar Google + role seller. **KHÔNG dùng expo-auth-session cho Google nữa** (firebase JS vẫn dùng để đổi credential).

**"Đặt mật khẩu" cho tài khoản Google (2026-08-28):** user Google tạo với `password=''` → trước KHÔNG
đổi/đặt được (change-password bắt buộc mật khẩu cũ). Đã sửa: BE `getProfile` trả `has_password`;
`ChangePasswordDto.oldPassword` optional; `changePassword` khi user chưa có mật khẩu → đặt trực tiếp (bỏ
check cũ). Mobile: `useProfile()` đọc has_password; màn change-password chuyển chế độ **Đặt mật khẩu** (ẩn ô
mật khẩu cũ, ghi chú "đăng nhập bằng Google, đặt để login cả bằng email"); menu Account đổi nhãn Đặt/Đổi;
`useChangePassword.onSuccess` invalidate profile. **BE deploy prod** (nhánh chore/soat-cau-hinh-payos-firebase).
**Verify live FULL**: menu "Đặt mật khẩu" → đặt zoldify123 → đăng xuất → **đăng nhập lại BẰNG EMAIL
<google-account>@gmail.com + zoldify123 THÀNH CÔNG**. Giờ tài khoản Google login được cả 2 cách.

**Siết bảo mật luồng đặt/đổi mật khẩu (2026-08-28, deploy prod):** (#1) **Email cảnh báo** khi đặt/đổi
mật khẩu thành công (`notifyPasswordChanged`, non-blocking qua MailerService). (#2) **Thu hồi phiên
KHÁC**: `changePassword` tăng `token_version` (jwt.strategy dòng ~26 từ chối access token version cũ) +
`login()` ghi đè refresh_token → mọi phiên khác bị đá; cấp token MỚI cho phiên hiện tại, trả về
`{access_token, refresh_token}`; mobile `authApi.changePassword` LƯU token mới (`tokenStore.save`) để phiên
hiện tại liền mạch. (#3) **Throttle** `@Throttle({short:1/1s, medium:3/60s})` — **override per-route
throttler CHỈ ăn sau khi container rebuild**; deploy đầu không nạp (docker cache) làm tưởng hỏng, phải
deploy lại. Verify live qua API: 2 phiên → đổi ở B → **token cũ A+B đều 401, token mới B2 = 200** (thu hồi
khác + giữ hiện tại); throttle req thứ 2/giây và thứ 4/phút → **429**. Test dùng seller@zoldify.com/<pass>
(đổi tạm abc12345 rồi khôi phục <pass>).

Zoldify_Mobile có Google sign-in qua **native GSI + firebase JS (v12)** → lấy Firebase idToken → backend `POST /auth/firebase` (backend tự tạo user). Nút "Tiếp tục/Đăng ký với Google" nằm trên login + register (component `src/features/auth/components/google-button.tsx`, hook `use-google-auth.ts`, init `src/lib/firebase.ts`, config công khai `src/lib/firebase-config.ts`).

**Firebase project = `zoldify`** (project number 1031347416096). Backend verify idToken của đúng project này (service account `firebase-service-account.json`, project_id "zoldify"). firebase CLI đã login `<google-account>@gmail.com`. Đã đăng ký app iOS + Android (`com.zoldify.app`) trong project. Client ID (công khai, đã nhúng trong firebase-config.ts): web `1031347416096-955r8fer...`, iOS `1031347416096-fs98nut...`. iOS URL scheme (reversed client id) đã thêm vào app.json.

**✅ GOOGLE ĐÃ CHẠY THẬT trên Android dev build (2026-08-24).** Bấm nút → mở MinuteMaidActivity (Google Sign-In native) OK. Đã: lấy SHA-1 debug keystore (`android/app/debug.keystore`, pass `android`) = `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25` → `firebase apps:android:sha:create` → Android OAuth client tự tạo → `GOOGLE_CLIENT_IDS.android = 1031347416096-8p8lbnipo926ehn43ht82cropg9eepbp...` (đã nhét vào firebase-config.ts). Dev build nạp JS từ Metro nên sửa client id chỉ cần **cold-restart app**, KHỎI build lại APK.

**⚠️→✅ 2026-08-24: `invalid_request` xuất hiện; 2026-08-28: ĐÃ FIX bằng cách chuyển sang native GSI**
(xem mục "Root cause" + "Giải pháp" ở đầu file). Bản expo-auth-session (browser) KHÔNG BAO GIỜ chạy được
Google trên Android vì chính sách Google — không phải lỗi config. Đừng quay lại expo-auth-session cho Google.

**Build local Android (KHÔNG cần EAS cloud) — đã chạy được:** `npx expo run:android` với `JAVA_HOME=D:/Android Studio/jbr` (JDK 21), `ANDROID_HOME=D:/AndroidSdk`. Emulator Pixel_10a (API 37.2-beta3, Google Play), AVD ở `D:/Android/avd` (ANDROID_AVD_HOME). Xem [[pitfall-windows-android-sdk-space-path]].

**Còn lại:**
1. **iOS native**: cần EAS dev build (Windows không build iOS local được; cần Apple account). iOS client id + URL scheme đã cấu hình sẵn.
3. **Web trên điện thoại qua LAN `http://<IP>:8081`**: KHÔNG chạy Google được — expo-auth-session tạo PKCE bằng **WebCrypto**, chỉ có ở **secure origin (localhost/https)**; LAN http ném "Access to the WebCrypto API is restricted to secure origins". Đã guard `googleAvailable()` (src/lib/firebase-config.ts) → **ẩn nút Google khi web không secure**, tránh crash; native/localhost/https vẫn hiện. Muốn test Google trên web thật thì dùng localhost (desktop) hoặc `expo start --tunnel` (https, nhưng backend http sẽ dính mixed-content). Test đúng nhất = **dev build native**.
4. **Web (localhost/https)**: bấm Google còn cần thêm `http://localhost:8081` + expo redirect vào **Authorized origins/redirect URIs** của web OAuth client trong **Google Cloud Console** (firebase CLI không set được).

**Lưu ý môi trường:** firebase v12 bundle OK trên Expo SDK 57 (không cần hack metro.config) nhưng **bundle web đầu tiên ~90s** (1600+ modules) → dễ tưởng treo. Đã từng restart expo web = `expo start --web --port 8081` (KHÔNG kèm env LAN); nếu test trên phone qua LAN thì restart lại với `EXPO_PUBLIC_API_ORIGIN`/`EXPO_PUBLIC_MEDIA_ORIGIN` trỏ IP LAN. Xem [[admin-dev-setup]] [[deploy-vps-backend]].
