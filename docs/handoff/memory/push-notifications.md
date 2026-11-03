---
name: push-notifications
description: "Push FCM cho Zoldify (mobile expo-notifications + BE firebase-admin) — đã build+verify token, chờ deploy BE để E2E"
metadata: 
  node_type: memory
  type: project
  originSessionId: <session>
  modified: 2026-08-28T12:54:31.720Z
---

Push notification (FCM) cho Zoldify_Mobile + Zoldify_Backend (2026-08-28). Xem [[mobile-design-roadmap]].

## Kiến trúc (KHÔNG dùng Expo push/EAS projectId)
BE đã có `firebase-admin` (verify idToken) → gửi FCM THẲNG qua `admin.messaging()`. Mobile lấy
**FCM device token** qua `Notifications.getDevicePushTokenAsync()` (không cần projectId). Đơn giản hơn
và không phụ thuộc hạ tầng Expo push.

## Mobile (nhánh `refactor/feature-first-structure`, commit ~`refacto`)
- Cài `expo-notifications` + `expo-device`.
- `google-services.json` ở gốc mobile (lấy qua Firebase MCP `get_sdk_config android`, project `zoldify`,
  app đã tồn tại `1:1031347416096:android:840c845db7803d0d066045`, package com.zoldify.app, SHA-1 sẵn) +
  `android.googleServicesFile` + plugin `expo-notifications` trong app.json. **google-services.json là config
  public (nhúng trong APK), nhưng ĐÃ gitignore** (`/google-services.json`).
- `features/notifications/push.ts`: `usePushNotifications()` (gắn ở RootLayout) — xin quyền + lấy FCM token +
  POST `/notifications/push-token` khi signedIn; gỡ token khi đăng xuất; `setNotificationHandler` foreground;
  `addNotificationResponseReceivedListener` + `getLastNotificationResponseAsync` → điều hướng theo data
  (type+id, mirror `routeFor` màn Thông báo). `savePushToken/removePushToken` trong notifications/api.ts.

## Backend — ĐÃ DEPLOY PROD (2026-08-28)
Cherry-pick commit push `b5b23a0` (staging) → nhánh prod `chore/soat-cau-hinh-payos-firebase`
(commit `f20ba1a`), KHÔNG merge cả staging (staging vượt prod 20+ commit epic không định deploy).
Xung đột chỉ ở 2 file docs drawio (lọt vào commit do `git add -A`) → resolve về bản prod. Push →
CI `deploy.yml` (gate build → SSH VPS `/opt/zoldify-backend` → `docker compose -p zoldify up -d --build`
= chạy migration:run + restart api) → **SUCCESS**. Verify: `POST /notifications/push-token` không token
→ **401** (route sống); relaunch app → token POST lên prod **không còn 404** (register error count=0) →
token đã lưu `push_tokens` prod. **E2E prod sẵn sàng**: notification create() sẽ đẩy FCM tới token đã lưu.
`gh run list --branch chore/soat-cau-hinh-payos-firebase` xem lịch sử deploy.

## Backend (code) — nhánh staging `b5b23a0` / prod `f20ba1a`
- `PushToken` entity + migration `1787670000000-CreatePushTokens` (bảng `push_tokens`, token UNIQUE, FK user).
  BE `synchronize:false` → PHẢI chạy `npm run migration:run` khi deploy.
- `FirebaseService.sendPush(tokens, {title,body,data})` = `admin.messaging().sendEachForMulticast` + trả
  token chết để dọn. `NotificationsService.create()` đẩy push tới mọi thiết bị của user (data=type+id).
  `registerToken/unregisterToken` + `POST/DELETE /notifications/push-token` (đặt TRƯỚC route `:id`).

## Build cục bộ (đã làm, THÀNH CÔNG)
`expo prebuild -p android` (android/ là CNG gitignore → regenerate, tự wire google-services plugin +
expo-notifications) → tạo `android/local.properties` = `sdk.dir=D:/AndroidSdk` (forward slash, né pitfall
space/backslash) → `expo run:android`. **BUILD SUCCESSFUL 22m58s**. Worklets C++ build OK (SDK path
D:/AndroidSdk không space). Env: ANDROID_HOME=D:\AndroidSdk, JAVA_HOME=jbr. Chạy expo qua `rtk proxy npx expo`
(rtk hook viết nhầm `npx expo`→`npm expo`).

## Verify live (2026-08-28)
- ✅ App chạy build mới không crash, mọi tính năng còn nguyên.
- ✅ Đăng nhập (seller@zoldify.com/<pass>) → prompt "Allow Zoldify to send you notifications" → Allow.
- ✅ **Lấy FCM token THẬT**: `[push] FCM token: d9wCwM2y...:APA91b...` (logcat ReactNativeJS).
- ✅ POST token → **404** (đúng: endpoint chỉ có ở staging, prod api.zoldify.com chưa deploy).
- ✅ BE gửi FCM: script node dùng firebase-admin + firebase-service-account.json (có sẵn ở BE root) →
  `admin.messaging().send` → **PUSH_SENT_OK** (FCM nhận, trả message id).
- ⚠️ **Banner KHÔNG hiện trên emulator** dù POST_NOTIFICATIONS granted=true + FCM accept 3 lần gửi. Đã loại
  trừ quyền/token/creds → là **FCM delivery tới emulator hay rớt** (hạn chế Google Play Services trên máy
  ảo, KHÔNG phải code). Trên máy THẬT sẽ hiện.

## CÒN LẠI (chỉ 1 hop môi trường)
- BE **đã deploy prod**, token đăng ký prod OK (register error=0). Chỉ còn **banner render trên
  emulator** chưa thấy (FCM delivery tới máy ảo hay rớt) — trên **máy thật** sẽ hiện, không cần sửa code.
Mọi code đã xong + tsc sạch cả 2 phía + deployed prod.
