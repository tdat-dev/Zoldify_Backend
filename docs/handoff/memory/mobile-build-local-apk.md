---
name: mobile-build-local-apk
description: "Build APK release CỤC BỘ cho Zoldify_Mobile trên Windows (KHÔNG cần EAS) — lệnh gradlew chạy được, env prod, ký debug-key giữ Google Sign-In, ~29 phút, 104MB universal."
metadata: 
  node_type: memory
  type: project
  originSessionId: <session>
  modified: 2026-11-03T08:09:27.636Z
---

Build **APK release độc lập** (JS bundle sẵn, cài là chạy, không cần Metro) cho `Zoldify_Mobile` ngay trên Windows, KHÔNG cần EAS cloud. Đã chạy thật 2026-09-09 → `app-release.apk` 104MB, BUILD SUCCESSFUL ~29 phút (universal 4-ABI).

## Lệnh chạy được (PowerShell, background)
```
$env:JAVA_HOME="D:\Android Studio\jbr"      # JDK 21
$env:ANDROID_HOME="D:\AndroidSdk"
$env:EXPO_PUBLIC_API_ORIGIN="https://api.zoldify.com"   # trỏ PROD, không thì fallback <IP>:3000 = vô dụng trên máy thật
$env:EXPO_PUBLIC_MEDIA_ORIGIN="https://zoldify.com"     # (giá trị prod lấy từ eas.json profile preview/production)
$gw="D:\Zoldify\Zoldify_Mobile\android\gradlew.bat"; $proj="D:\Zoldify\Zoldify_Mobile\android"
cmd /c "`"$gw`" -p `"$proj`" assembleRelease >> `"LOG`" 2>&1"
```
APK ra ở `android\app\build\outputs\apk\release\app-release.apk`.

## PITFALL đã vấp
- **`cmd /c "cd /d ...\android && gradlew.bat ..."` KHÔNG chạy** — cwd không đổi vào android → "'gradlew.bat' is not recognized". FIX: gọi gradlew bằng **đường dẫn TUYỆT ĐỐI + `-p <projectdir>`**, né hẳn cwd.
- **EXPO_PUBLIC_* phải set trong env lúc build** (Expo inline lúc bundle). Không set → APK trỏ dev origin, cài máy thật là chết API.
- Build nền bị **kill khi phiên Claude teardown giữa chừng** (Kotlin daemon "Connection reset" ở `:react-native-safe-area-context:compileReleaseKotlin`) — KHÔNG phải lỗi cấu hình, chạy lại là xong. Build ~29' nên dễ rơi vào ranh giới phiên.
- Foreground `sleep`/`Start-Sleep` bị chặn; build phải `run_in_background:true`, đọc log để theo dõi.

## Ký & Google Sign-In
`android/app/build.gradle`: buildType `release` cố tình ký bằng `signingConfigs.debug` (debug.keystore, pass `android`). SHA-1 debug (`5e8f16062ea3cd2c4a0d547876baa6f38cabf625`) ĐÃ đăng ký Firebase → **Google Sign-In chạy trong APK release**. Muốn lên Google Play thật thì tạo keystore release riêng + đăng ký SHA-1 đó vào Firebase (xem [[mobile-google-signin]]).

## Ghi chú
- versionCode 1 / versionName 1.0.0 (app.json + build.gradle). Universal 4-ABI (armeabi-v7a,arm64-v8a,x86,x86_64) = cài mọi máy, đổi lấy dung lượng lớn; muốn nhanh/nhẹ ~2× thì `-PreactNativeArchitectures=arm64-v8a`.
- KHÔNG commit file .apk vào git (104MB > giới hạn 100MB của GitHub, là build artifact). Toolchain path xem [[pitfall-windows-android-sdk-space-path]] (SDK không dấu cách, forward slash). Firebase push/token xem [[push-notifications]].

## Bẫy build bị ngắt giữa phiên (2026-10-05)
- Build nền hay chết khi phiên Claude kết thúc. Thêm `-Pkotlin.compiler.execution.strategy=in-process` để không phụ thuộc Kotlin daemon ("Connection to the Kotlin daemon has been unexpectedly lost").
- Build bị ngắt để lại file `.o` hỏng → lỗi `ld.lld: error: ... .o: unknown file type`. FIX: `cmd /c rd /s /q "\?D:ZoldifyZoldify_Mobileandroidapp.cxx"` + `appuildintermediatescxx`, rồi build lại.
- `ninja: error: failed recompaction: Permission denied` = có HAI build chạy cùng lúc (task nền cũ chưa chết). Chỉ chạy một build; `gradlew --stop` trước khi build lại.
- Build tăng dần chỉ ~4-5 phút (x86_64 cho máy ảo: `-PreactNativeArchitectures=x86_64`, APK ~48MB). Kiểm `stat` thời gian APK trước khi cài, tránh cài nhầm bản cũ.

## 26/10/2026
- Build từ worktree (vd D:\Zoldify\wt-mobile): thư mục android/ bị gitignore, phải chép từ Zoldify_Mobile/android (robocopy /XD build .gradle .cxx .kotlin logs) khi native deps không đổi.
- `-Pkotlin.compiler.execution.strategy=in-process` với heap mặc định 2GB => "Not enough memory to run compilation" (:react-native-worklets:compileReleaseKotlin). Sửa android/gradle.properties: org.gradle.jvmargs=-Xmx6g -XX:MaxMetaspaceSize=1g + kotlin.daemon.jvmargs=-Xmx3g; build lại ~27 phút OK. Đừng chạy jest song song lúc build.
- Bundle là Hermes: chuỗi tiếng Việt không grep UTF-8 được; kiểm bằng định danh ASCII (vd localStatus) + api.zoldify.com.

## 03/11/2026
- Chép android/ từ Zoldify_Mobile làm MẤT thay đổi app.json (splash D-01 vẫn là logo Expo). Sửa: `$env:CI='1'; npx expo prebuild --platform android --no-install` trong wt-mobile (nó XOÁ và dựng lại android/, gradle.properties về 2048m, ký debug + google-services vẫn đúng). Build x86_64 sạch sau prebuild ~21 phút với `--max-workers=2 -Dorg.gradle.jvmargs=-Xmx2g` (không in-process Kotlin).
- 03/11/2026 (chiều): **CI build APK trên GitHub Actions**, máy dev KHÔNG cần chạy Gradle nữa. Workflow `.github/workflows/build-apk.yml` + composite `.github/actions/prepare-android` (nhánh ci/build-apk, PR vào main). Push lên fix/** feat/** ci/** staging main = APK release staging; workflow_dispatch chọn env staging|prod, abi, dev_client. Artifact `zoldify-<env>-<sha7>.apk` / `zoldify-devclient-<sha7>.apk` giữ 14 ngày (`gh run download`). Secret: ANDROID_KEYSTORE_BASE64 (debug.keystore SHA-1 5e8f...), GOOGLE_SERVICES_JSON_BASE64 (project `zoldify`); variable STAGING_/PROD_EXPO_PUBLIC_API_ORIGIN và _MEDIA_ORIGIN. Doc: docs/build-apk-ci.md. BẪY: google-services.json COMMIT trong repo là project `zoldify-d2040` (sai, BE gửi push bằng project `zoldify`); APK build local từ wt-mobile mang d2040, CI ghi đè bằng secret.
- Staging: EXPO_PUBLIC_API_ORIGIN=https://api-staging.zoldify.com, MEDIA_ORIGIN=https://zoldify.com. Ngay sau khi máy ảo boot, màn đầu có thể đen hoặc cửa sổ app lệch xuống bằng thanh trạng thái: force-stop rồi mở lại app trước khi kết luận lỗi layout.
