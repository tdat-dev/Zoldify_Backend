# Audit B: Production Readiness (toàn dự án Zoldify)

- Ngày: 2026-09-28
- Phạm vi: `Zoldify_Backend`, `Zoldify_Frontend`, `Zoldify_Admin`, `Zoldify_Mobile`
- Cách làm: 3 lượt rà song song (bảo mật + tuân thủ, vận hành backend, 3 app client), cộng dữ liệu từ [Audit A](A-validation-concurrency.md). Các lỗi Critical/High đều đã được đọc lại code để xác nhận. Chỉ audit, **chưa sửa code**.
- Mã lỗi `A-xx` nằm trong báo cáo A. Mã `B-xx` là lỗi mới của báo cáo này.

## Bảng điểm 13 hạng mục

| # | Hạng mục | Điểm | Nhận xét một dòng |
|---|---|---|---|
| 1 | Input Validation | 5/10 | ValidationPipe toàn cục tốt, nhưng có body `any`, không có `@MaxLength`, giá âm vẫn qua (A) |
| 2 | Concurrency Control | 4/10 | Sổ cái làm chuẩn; đơn hàng, escrow, rút tiền, tồn kho không khoá (A) |
| 3 | Security (xác thực, phân quyền) | **2/10** | **Đăng ký tự chọn được role admin**; khoá tài khoản không có tác dụng; nhiều endpoint lộ dữ liệu cá nhân |
| 4 | Idempotency & thanh toán | 5/10 | Webhook PayOS chuẩn; nhưng có đường tự đánh dấu đã trả tiền, ví không tạo escrow (A) |
| 5 | Resilience khi gọi dịch vụ ngoài | 5/10 | Có timeout 30s, lỗi GHN được cô lập; không retry, không circuit breaker, SMTP không có timeout |
| 6 | Error handling | 4/10 | Chỉ bắt `HttpException`; không có handler `unhandledRejection`, không có graceful shutdown |
| 7 | Observability | **1/10** | Không Sentry/Crashlytics ở cả 4 app; log dạng text, không có request-id, không có cảnh báo |
| 8 | Database ops | 5/10 | Migration có `down()`, index hợp lý; **không có backup nào** |
| 9 | Performance & caching | 4/10 | CacheModule có khai báo nhưng không cache response nào; ảnh không resize; tìm kiếm `LIKE '%x%'` |
| 10 | Testing | 3/10 | Test tiền tệ viết tốt nhưng **không chạy trong CI**; không có test cho đặt hàng và auth; client 0 test |
| 11 | CI/CD & config | 3/10 | CI web không chạy trên nhánh deploy; không validate env lúc khởi động; không rollback |
| 12 | Background jobs | 6/10 | 2 cron mỗi giờ, xử lý lỗi từng bản ghi; thiếu job đối soát PayOS, chạy 2 bản sẽ trùng |
| 13 | Compliance & audit (NĐ 13/2023) | **2/10** | Không có log thao tác admin, không có xoá tài khoản, không có trang chính sách |
| + | Mobile release | 2/10 | Ký bằng debug key, APK 104MB, không có force update, không có OTA |
| + | SEO web | 3/10 | Trang sản phẩm chỉ render phía client, không có metadata riêng cho từng sản phẩm |

**Tổng: khoảng 3.6/10. Chưa sẵn sàng production.** Điểm sáng nhất là lõi tiền (sổ cái kép, webhook, test tiền tệ). Điểm yếu nhất là bảo mật tài khoản, khả năng quan sát (không biết khi nào hệ thống lỗi) và không có backup.

---

## Việc phải làm NGAY (đang mở trên production)

Năm lỗi dưới đây khai thác được bằng một request, không cần kỹ năng gì. Nên sửa trước mọi việc khác.

| Mã | Lỗi | Vị trí | Sửa |
|---|---|---|---|
| **B-01** | **Ai đăng ký cũng tự chọn được `role: admin`**. `POST /api/v1/auth/register {..., "role": "admin"}` tạo ra tài khoản admin, có toàn quyền duyệt rút tiền, sửa user, sửa settings | `src/identity/users/dto/create-user.dto.ts:51-53`, `src/identity/users/users.service.ts:80-93` | Xoá trường `role` khỏi `RegisterUserDto`, gán cứng `role = BUYER` trong `register()`. **Rà lại bảng `users` xem đã có ai tự lên admin chưa** |
| A-01 | Người mua tự đánh dấu đơn đã thanh toán qua `PATCH /payments/:id` | `src/money/payments/payments.service.ts:198-225` | Xem báo cáo A |
| **B-02** | Ai đăng nhập cũng gửi được thông báo và push tới bất kỳ user nào (lừa đảo giả danh Zoldify) | `src/messaging/notifications/notifications.controller.ts:31-35` | Chỉ admin, hoặc bỏ route (chỉ dùng nội bộ) |
| **B-03** | `GET /escrows` và các route con trả toàn bộ escrow kèm thông tin người mua/bán (tên, SĐT, địa chỉ, email) cho mọi người đã đăng nhập | `src/money/escrows/escrows.controller.ts:15-49`, `escrows.service.ts:245-300` | Chỉ admin, hoặc lọc theo `user.id`, và chỉ `select` cột cần |
| **B-04** | Khoá tài khoản không có tác dụng: `is_locked` không được kiểm tra khi đăng nhập, trong JWT strategy hay socket | `src/identity/auth/passport/jwt.strategy.ts:23-35`, `auth.service.ts:61-72` | Chặn `is_locked` ở `validateUser` và `JwtStrategy.validate`, tăng `token_version` khi khoá |

Ngoài ra nên **bật backup DB ngay hôm nay** (xem B-20), vì hiện chỉ có một volume Docker trên một VPS.

---

## 3. Security (xác thực, phân quyền)

| Mã | Mức | Lỗi | Vị trí | Sửa |
|---|---|---|---|---|
| B-05 | High | **Chiếm tài khoản trước khi nạn nhân đăng ký**: `/auth/register` không cần OTP. Kẻ xấu đăng ký trước `victim@gmail.com`; khi nạn nhân dùng "Đăng nhập Google", backend tự nối theo email vào đúng tài khoản đó, và kẻ xấu vẫn giữ mật khẩu | `auth.controller.ts:98-101`, `firebase.service.ts:119-131` | Bỏ đăng ký không OTP, hoặc không tự nối tài khoản chưa xác minh email |
| B-06 | High | `firebaseLogin` không kiểm tra `email_verified` và provider; token không có email/phone thì dò `phone_number = ''`, trùng với mọi user tạo qua Google | `firebase.service.ts:119-131` | Bắt buộc `email_verified === true`, chỉ cho phép provider nằm trong danh sách, từ chối khi cả email lẫn phone đều rỗng |
| B-07 | High | API công khai lộ dữ liệu cá nhân: review (`GET /interactions/product/:id`), người theo dõi, thông tin shop (SĐT, địa chỉ lấy hàng là **nhà riêng** người bán C2C), trả nguyên bản ghi `User` | `interactions.service.ts:66-105`, `follows.service.ts:55-80`, `shop.service.ts:84-104` | `select` tường minh `{id, full_name, avatar}`; thêm `ClassSerializerInterceptor` + `@Exclude` cho trường nhạy cảm của `User` |
| B-08 | Medium | Role lấy từ JWT chứ không lấy từ DB; hạ quyền admin vẫn còn hiệu lực tới 1 ngày | `common/guards/admin.guard.ts:7`, `jwt.strategy.ts:30-35` | Trả `role` từ DB trong `validate()`, tăng `token_version` khi đổi role |
| B-09 | Medium | OTP dùng `Math.random`, không giới hạn số lần nhập sai, cache OTP chỉ 100 mục (spam 100 email là đẩy OTP thật ra khỏi cache); reset mật khẩu không thu hồi phiên cũ; API OTP để lộ email nào đã đăng ký | `auth.service.ts:108, 182, 204-221`, `auth.module.ts:23` | `crypto.randomInt`, tối đa 5 lần sai mỗi OTP, rate-limit theo email, tăng `token_version` khi reset, trả thông báo chung chung |
| B-10 | Medium | File: ai cũng liệt kê được mọi file, xem thông tin người upload, xoá file người khác | `catalog/files/files.controller.ts:95-119` | Lọc theo `uploaded_by`, admin mới xem tất cả |
| B-11 | Medium | Người mua xoá được đơn đã thanh toán hoặc đang giao; xoá được bản ghi payment của mình. Mất chứng cứ khi tranh chấp, escrow có thể bị kẹt | `orders.service.ts:1132-1136`, `payments.service.ts` (`remove`) | Chỉ cho xoá đơn `cancelled` hoặc chưa trả tiền; bỏ quyền xoá payment của người thường |
| B-12 | Medium | Socket chat: không kiểm tra `token_version`/`is_locked`, không rate-limit tin nhắn, `cors: '*'` | `chat.gateway.ts:20, 36-42, 95-120` | Dùng chung kiểm tra DB với JwtStrategy, giới hạn tin/giây, origin theo `SITE_URL` |
| B-13 | Medium | Swagger `/api/docs` mở công khai trên production, lộ toàn bộ route admin | `main.ts:82-88` | Chỉ bật khi `NODE_ENV !== 'production'`, hoặc đặt sau basic auth |
| B-14 | Medium | Web lưu token trong localStorage và **không có CSP**; `images.remotePatterns` cho phép `**` (biến `/_next/image` thành proxy mở) | `Zoldify_Frontend/src/lib/session.ts`, `next.config.mjs:12-17` (Admin tương tự) | Thêm CSP + security headers trong `next.config`, giới hạn `remotePatterns` về domain ảnh |
| B-15 | Medium | Dependency có lỗ hổng (npm audit backend, prod deps): 1 critical, 20 high. Gồm multer DoS (route upload), socket.io/ws cạn bộ nhớ, axios prototype pollution, nodemailer CRLF injection. Gói `firebase` (SDK client) không nên có trong backend | `Zoldify_Backend/package.json` | Nâng `@nestjs/platform-express`, `@nestjs/platform-socket.io`, `socket.io`, `axios`, `nodemailer`, `typeorm@^0.3.31`; gỡ `firebase`. Web: lên kế hoạch Next 15 |
| B-16 | Low | Có phát refresh token (sống 7 ngày) nhưng không có endpoint refresh, nên user bị đăng xuất mỗi ngày và token này là credential "chết" | `auth.service.ts`, `Zoldify_Mobile/src/lib/api/client.ts:38-57` | Làm `/auth/refresh` có xoay vòng token, hoặc thôi phát |
| B-17 | Low | Nhỏ lẻ: `markAsRead` chat không kiểm tra thành viên; shop ném `Error` thường (500 thay vì 403); `GET /payos/order/:id` xem được trạng thái đơn người khác; login chỉ throttle theo IP | nhiều file | Sửa khi tiện |

Xem thêm từ báo cáo A: A-07 (nghe lén chat), A-14 (tạo vận đơn GHN), A-15 (upload SVG), A-16 (admin sửa user `any`), A-18 (phân trang không giới hạn).

**Đã làm tốt:** `order-status.policy.ts` phân quyền chuyển trạng thái theo vai trò; `password` và `refresh_token` để `select: false`; thu hồi phiên bằng `token_version` khi logout/đổi mật khẩu; không có `dangerouslySetInnerHTML`; mobile lưu token trong SecureStore; secret không nằm trong code; `firebase-service-account.json` chưa bao giờ vào git; `route-guards.spec.ts` tự quét mọi route phải có guard hoặc `@Public()`.

---

## 4. Idempotency & thanh toán

Chi tiết đã nằm ở báo cáo A: A-01, A-05, A-06, A-09, A-11, A-17, A-19. Thêm một việc còn thiếu:

- **B-18. Không có job đối soát PayOS.** Payment `PENDING` chỉ được cập nhật khi webhook về hoặc khi người dùng bấm refresh (`payos.service.ts:269-340`). Nếu webhook bị lạc, tiền đã trừ nhưng đơn vẫn chưa thanh toán cho tới khi có người để ý. Sửa: cron 10-15 phút một lần, hỏi PayOS trạng thái các payment `PENDING` quá 15 phút.

## 5. Resilience khi gọi dịch vụ ngoài

- **B-19.** Xác nhận đơn gọi GHN **đồng bộ, tuần tự theo từng người bán** (`orders.service.ts:465-467`, `902-1008`), timeout 30s mỗi lần. GHN chậm thì request xác nhận có thể treo 30s nhân số người bán. Không có retry, không có circuit breaker. SMTP không đặt timeout.
- Sửa: đẩy tạo vận đơn vào hàng đợi, hoặc ít nhất giảm timeout còn 10s và chạy song song; thêm retry có backoff cho lỗi mạng; đặt `connectionTimeout` và `socketTimeout` cho nodemailer.
- **Đã làm tốt:** lỗi GHN được bắt riêng từng người bán, không làm hỏng cả đơn; gọi API ngoài nằm ngoài transaction DB; mail lỗi không làm hỏng đăng ký; push FCM lỗi không làm hỏng việc tạo thông báo.

## 6. Error handling

- Chỉ có một filter là `@Catch(HttpException)` (`src/core/http-exception.filter.ts:4`). Lỗi DB (`QueryFailedError`) và lỗi thường rơi về handler mặc định của Nest, trả **một kiểu JSON khác** với envelope chung. Client parse lỗi theo một định dạng sẽ vỡ.
- Không có `process.on('unhandledRejection' | 'uncaughtException')`: một promise quên `.catch` là sập tiến trình API (chỉ có 1 bản).
- Không có `app.enableShutdownHooks()`: mỗi lần deploy, request đang chạy bị cắt ngang.
- Admin không có `error.tsx`, `global-error.tsx`, `not-found.tsx`: trang duyệt rút tiền lỗi render là trắng trang, không có nút thử lại.
- Sửa: thêm filter bắt mọi lỗi (map `QueryFailedError` duplicate thành 409, `ER_DATA_TOO_LONG` thành 400); thêm handler cấp tiến trình có log; bật shutdown hooks; thêm 3 file lỗi cho Admin.
- **Đã làm tốt:** Frontend có đủ `error.tsx`, `global-error.tsx`, `not-found.tsx`; trang `payment/return` xử lý đủ các trạng thái; mobile có ErrorBoundary, mutation không tự retry (tránh đặt đơn 2 lần).

## 7. Observability

- **Không có công cụ bắt lỗi nào** ở cả 4 app: không Sentry, không Crashlytics, không analytics. Lỗi production chỉ được biết khi người dùng than phiền. Mobile phát APK tay, không có OTA, nên crash ngoài thực tế hoàn toàn vô hình.
- Backend dùng Nest `Logger` nhất quán (không có `console.log` rải rác), nhưng log là text thường, không có request-id, khó tra cứu.
- `docker-compose.yml` không có khối `logging:`. Driver `json-file` mặc định không giới hạn dung lượng nên **log sẽ đầy ổ đĩa VPS** theo thời gian.
- Health check `GET /` không chạm DB: MySQL chết mà Docker vẫn báo healthy.
- Không có cảnh báo khi cron lỗi (ví dụ token GHN hết hạn).
- Sửa theo thứ tự: (1) giới hạn log Docker (`max-size: 10m`, `max-file: 5`); (2) route `/health` có ping DB, dùng `@nestjs/terminus`; (3) Sentry cho backend, web, admin và Crashlytics/Sentry cho mobile; (4) uptime monitor ngoài (UptimeRobot, Better Stack) gọi `/health` và báo qua Telegram; (5) log JSON kèm request-id (`nestjs-pino`).

## 8. Database ops

- **B-20. Không có backup.** Không script, không cron, không snapshot. Toàn bộ dữ liệu (đơn, tiền, sổ cái) nằm trong một volume `mysql-data` trên một VPS. Hỏng đĩa hoặc gõ nhầm một lệnh là mất hết.
  - Sửa: cron `mysqldump --single-transaction` hằng ngày, nén, đẩy ra ngoài VPS (R2/S3), giữ 7 bản ngày + 4 bản tuần. **Thử restore thật một lần** vào DB tạm rồi ghi lại quy trình.
- Ảnh sản phẩm nằm trên volume Docker `product-images` của cùng VPS, cũng không có backup, và đây là lý do không chạy được 2 bản API.
- Migration: cả 14 file đều có `down()`. Hai migration index bọc `.catch(() => {})` nên chạy lại được, nhưng cũng nuốt luôn lỗi thật.
- Index khớp với các truy vấn nóng (products, orders, notifications, ledger, messages, có FULLTEXT cho tìm kiếm).
- Pool 50 kết nối, không đặt `acquireTimeout`: khi pool đầy, request treo thay vì báo lỗi nhanh.
- Không dùng soft delete ở phần lớn bảng.

## 9. Performance & caching

- `CacheModule` khai báo 2 lần nhưng **chỉ dùng để lưu OTP**, không có `CacheInterceptor` nào. Trang chủ, danh sách sản phẩm, sitemap đều truy vấn MySQL mỗi request.
- Ảnh người bán tải lên được phục vụ nguyên kích thước, không có thumbnail. Frontend dùng 24 thẻ `<img>` thường và chỉ 1 chỗ dùng `next/image`.
- Tìm kiếm dưới 4 ký tự rơi về `LIKE '%term%'` (`products.service.ts:150-174`), quét toàn bảng khi dữ liệu lớn.
- **Đã làm tốt:** payload sản phẩm chỉ `select` trường cần (có đo đạc ghi trong comment); bật gzip; file tĩnh cache 7 ngày; GHN master data cache 24h; `view_count` cố ý tắt, có ghi lý do.
- Sửa: cache 30-60s cho danh sách sản phẩm và trang chủ; resize ảnh khi upload (sharp: 3 cỡ); chuyển ảnh sang R2 + CDN (code đã có sẵn `storage.service.ts`), việc này cũng gỡ được nút chặn chạy nhiều bản API.

## 10. Testing

- Backend có 8 file spec. Phần tiền được test nghiêm túc: ledger, escrow, withdrawals, webhook PayOS, cron, state machine đơn hàng, kiểm tra guard mọi route.
- **Nhưng các test này cần MySQL thật và không chạy trong CI** (`deploy.yml` không có service MySQL, không có bước `npm test`). Test có đó mà không ai chạy.
- **Không có test** cho `orders.service.ts` (đặt hàng, trừ kho, tạo vận đơn) và `auth.service.ts` (đăng nhập, OTP, Firebase), đúng là hai luồng dễ vỡ nhất.
- E2E chỉ có một test kiểm tra `GET /` trả "Hello World!".
- Frontend, Admin, Mobile: 0 test.
- Sửa: (1) thêm job CI có `services: mysql:8` chạy `npm test`, bắt buộc xanh mới deploy; (2) viết test song song cho các lỗi A-02 đến A-05 (hai request cùng lúc); (3) test auth, đặc biệt B-01, B-04, B-05; (4) web: vài test Playwright cho luồng mua hàng.

## 11. CI/CD & config

| Mã | Vấn đề | Vị trí |
|---|---|---|
| B-21 | CI của Frontend và Admin chỉ chạy trên `main`, còn deploy chạy từ `deploy-prod` (Frontend) và `chore/deploy-docker` (Admin). **Lint và audit không bao giờ chặn được thứ lên production** | `Zoldify_Frontend/.github/workflows/ci.yml:4-7`, `deploy.yml:10-12`; Admin tương tự |
| B-22 | Nhánh production của backend tên là `chore/soat-cau-hinh-payos-firebase`; Admin là `chore/deploy-docker`. Tên nghe như nhánh tạm, người mới dễ push nhầm | `Zoldify_Backend/.github/workflows/deploy.yml:5,12` |
| B-23 | Lint `continue-on-error: true` ở cả 3 repo; gate chỉ có `build` | các `deploy.yml` |
| B-24 | Build trên chính VPS production, không giữ image cũ, không có cách rollback, không có smoke test sau deploy | `Zoldify_Backend/.github/workflows/deploy.yml:42-61` |
| B-25 | `ConfigModule.forRoot` không có `validationSchema`. `scripts/check-env.mjs` viết rất tốt nhưng không được gọi ở đâu. Thiếu biến môi trường thì app sập với lỗi khó hiểu | `src/app.module.ts:40-42` |
| B-26 | Staging và production chạy chung một VPS; một bên ăn hết tài nguyên thì bên kia chết theo | `docker-compose.yml` |

Sửa: đổi tên nhánh production thành `main`/`production` ở cả 3 repo và cho CI chạy đúng nhánh đó; bắt buộc lint + test; build image trong GitHub Actions, đẩy lên registry (GHCR) có tag theo commit, VPS chỉ `pull`, rollback bằng cách chạy lại tag cũ; gọi `check-env.mjs` trong `CMD` của Docker hoặc chuyển sang `validationSchema`; thêm bước gọi `/health` sau deploy.

## 12. Background jobs

- 2 cron chạy mỗi giờ (`src/ops/tasks/tasks.service.ts:37, 96`): huỷ đơn quá 48h chưa có mã vận đơn, và đồng bộ GHN + tự giải ngân. Mỗi bản ghi có try/catch riêng và gọi lại service có transaction. **Tốt.**
- Không có khoá khi chạy: nếu sau này chạy 2 bản API thì mỗi job chạy 2 lần; một lần chạy lâu hơn 1 giờ cũng sẽ chồng lên lần sau.
- Thiếu: đối soát PayOS (B-18), dọn OTP/file rác, cảnh báo khi job lỗi.
- Sửa: dùng khoá MySQL `GET_LOCK('cron_x', 0)` đầu mỗi job (không cần Redis); thêm job đối soát PayOS; báo lỗi job lên Sentry hoặc Telegram.

## 13. Compliance & audit (Nghị định 13/2023 về bảo vệ dữ liệu cá nhân)

- **Không có log thao tác admin**: đổi role, khoá, xoá user, sửa settings không để lại dấu vết. (Rút tiền có lưu admin duyệt, và sổ cái là dấu vết tiền rất tốt.)
- **Không có xoá tài khoản hay xuất dữ liệu cho người dùng.** Đây còn là **yêu cầu bắt buộc của Google Play** với app có tài khoản.
- **Không có trang Chính sách bảo mật, Điều khoản, Chính sách đổi trả** trên web lẫn app. Không có bước xin đồng ý xử lý dữ liệu khi đăng ký.
- Lộ dữ liệu cá nhân qua API công khai (B-03, B-07).
- Log sạch: không in token, OTP hay body request.
- Sửa: bảng `admin_audit_logs` (ai, làm gì, trên bản ghi nào, giá trị trước/sau), ghi qua interceptor cho mọi route admin; endpoint `DELETE /users/me` (ẩn danh hoá dữ liệu cá nhân, giữ bản ghi tiền theo luật kế toán); 3 trang chính sách + checkbox đồng ý khi đăng ký.

---

## Mobile release (Zoldify_Mobile)

| Mã | Vấn đề | Vị trí | Sửa |
|---|---|---|---|
| B-27 | **Bản release ký bằng debug keystore** (mật khẩu công khai `android`). Google Play không nhận; ai cũng ký được bản giả mạo cùng chữ ký | `android/app/build.gradle:112-115` | Tạo upload keystore thật, cất ngoài repo, nối vào `signingConfigs.release`. Nhớ thêm SHA-1 mới vào Firebase để Google Sign-In vẫn chạy |
| B-28 | APK 104MB vì gộp cả 4 kiến trúc CPU, không tách ABI, không bật R8 | `android/gradle.properties:31` | Build AAB cho Play Store, hoặc bật `splits.abi`; bật `minifyEnabled` + `shrinkResources` |
| B-29 | Không có force update, không có OTA (`expo-updates` bị tắt). Không cách nào vá hay chặn bản cũ khi API đổi | `AndroidManifest.xml:18` | Endpoint `/app/config` trả `min_version`, app so sánh và chặn; cân nhắc bật `expo-updates` cho bản vá JS |
| B-30 | File `Zoldify-v1.0.0-prod.apk` (104MB) **đang được stage** trong git, chưa có `*.apk` trong `.gitignore` | `Zoldify_Mobile` | `git rm --cached Zoldify-v1.0.0-prod.apk`, thêm `*.apk`, `*.aab`, `.env` vào `.gitignore` |
| B-31 | Xin quyền `RECORD_AUDIO`, `SYSTEM_ALERT_WINDOW` mà app không dùng | `AndroidManifest.xml` | Gỡ bằng `tools:node="remove"` hoặc khai trong `app.json` |
| B-32 | Không có màn xoá tài khoản (bắt buộc với Google Play) | `src/app/(app)/(tabs)/account.tsx` | Làm cùng mục 13 |

**Đã làm tốt:** env validate bằng zod và báo lỗi ngay; token trong SecureStore; ErrorBoundary; mutation không tự retry.

## SEO web (Zoldify_Frontend)

- Trang sản phẩm `src/app/product/[id]/page.tsx` là `"use client"`, dữ liệu tải trong `useEffect`. Google, Zalo, Facebook chỉ thấy trang rỗng. Chia sẻ link sản phẩm chỉ hiện "Zoldify" chung chung, không có ảnh, giá hay tên, trong khi ở VN người mua chủ yếu chia sẻ link qua Zalo/Facebook.
- Chỉ có một `metadata` cho toàn site (`layout.tsx`); Frontend không có `app/sitemap.ts` hay `app/robots.ts` (backend có module sitemap, cần kiểm tra đã được nối ra ngoài chưa).
- Sửa: tách trang sản phẩm thành server component có `generateMetadata` (OG image = ảnh sản phẩm), phần tương tác để trong client component con; thêm `sitemap.ts` + `robots.ts`; chuyển ảnh danh sách sang `next/image`.

---

## Lộ trình đề xuất

**Đợt 0: hotfix trong 1-2 ngày (lỗ hổng đang mở)**
1. B-01 bỏ `role` khỏi đăng ký, rà bảng `users` tìm admin lạ
2. A-01 khoá `PATCH /payments/:id`
3. B-02, B-03 khoá `POST /notifications` và `/escrows`
4. B-04 thực thi `is_locked`
5. B-20 bật backup DB hằng ngày ra ngoài VPS
6. Giới hạn dung lượng log Docker

**Đợt 1: an toàn tiền và tài khoản (tuần 1)**
- Báo cáo A đợt 1 (A-05, A-06, A-09, A-11, A-12, A-13)
- B-05, B-06 chống chiếm tài khoản; B-07 chặn lộ dữ liệu cá nhân; B-13 tắt Swagger production
- B-15 nâng dependency có lỗ hổng
- `/health` thật, Sentry cho backend, uptime monitor

**Đợt 2: đặt hàng đúng và kiểm soát chất lượng (tuần 2-3)**
- Báo cáo A đợt 2 (oversell, transaction, idempotency đơn hàng, lost update)
- Test chạy trong CI có MySQL; test song song cho đặt hàng và escrow
- B-21 đến B-25: gom nhánh, lint bắt buộc, build image có tag, validate env
- Filter bắt mọi lỗi, shutdown hooks, B-18 job đối soát PayOS

**Đợt 3: sẵn sàng phát hành (tuần 3-4)**
- Mobile: B-27 keystore thật, B-28 AAB, B-29 force update, Crashlytics, B-32 xoá tài khoản
- Pháp lý: 3 trang chính sách, checkbox đồng ý, log thao tác admin
- B-16 refresh token; SEO trang sản phẩm; cache danh sách; resize ảnh + CDN
- Báo cáo A đợt 3 và 4 (validation còn lại)
