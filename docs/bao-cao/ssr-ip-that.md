# Web gọi API từ phía server: một IP cho mọi người? (03/11/2026)

Sau đợt "IP thật cho giới hạn tốc độ" (`ip-that-gioi-han.md`), API đếm 10 req/s
theo IP khách thật. Mối lo: web Next.js render phía server trên cùng VPS, nếu nó
gọi API cho từng khách thì mọi khách dùng chung xô của IP VPS
(103.249.117.151), có tải là chính trang web dính 429.

Kết luận ngắn: **web gần như không gọi API từ phía server**, nên không cần cơ chế
chuyển tiếp IP khách kèm khoá bí mật (`X-Zoldify-SSR-Key` + `X-Zoldify-Client-IP`).
Lỗi thật nằm ở chỗ gọi duy nhất còn lại (middleware bảo trì), đã sửa ở web.
Backend không đổi mã. Admin không đổi.

## 1. Web gọi API từ server ở đâu

Đọc mã `Zoldify_Frontend` nhánh `staging` (b7336ce):

| Chỗ | Chạy ở đâu | Gọi API? |
|---|---|---|
| `src/app/**` | 29/36 file là `'use client'`; dữ liệu tải trong `useEffect` qua axios (`src/lib/http.ts`) | Từ TRÌNH DUYỆT, IP khách thật |
| 7 file server: `layout.tsx`, `addresses/layout`, `profile/layout`, `profile/products`, `reset-password`, `maintenance`, `not-found`, cùng `AnnounceBar` | server | Không (chỉ i18n, đọc biến Firebase) |
| `next.config.mjs` | | Không có `rewrites`, không proxy API |
| `next/image` | | Chỉ dùng cho ảnh tĩnh của web (`QuickLinks`), không kéo ảnh từ API |
| **`src/middleware.ts`** | server, trước mọi trang | **Có: `GET /api/v1/settings/public`** (cờ bảo trì), nhớ 15 giây |

Lượt gọi trong middleware không thay mặt khách nào (một cờ chung cho cả site),
nên chuyển tiếp IP khách cho nó là vô nghĩa. Admin (`Zoldify_Admin`): mọi trang
là `'use client'`, không có middleware, không `rewrites` → không gọi API từ
server; nhật ký thao tác admin đã ghi IP trình duyệt thật.

## 2. Tái hiện trên staging

Bắn từ máy ngoài (IP 1.53.166.166) vào `staging.zoldify.com`, đếm dòng mới trong
`/var/log/nginx/access.log` của VPS theo IP nguồn:

| Lượt | Trang | Lượt gọi API từ IP VPS |
|---|---|---|
| 30 + 30 song song | `/product/1173`, `/` | 15 x 200 `/settings/public` |
| 100 song song, sau khi cache hết hạn | `/product/1173` | 11 x 200, **31 x 429**, 1 x 499 |
| 30 + 30 song song | `admin-staging` `/`, `/orders` | 0 (lượt duy nhất thấy là của web) |

Trang vẫn trả 200 cho khách vì middleware nuốt lỗi. Nhưng có hai lỗi thật:

1. **Dồn cửa (thundering herd)**: cache 15 giây chỉ được ghi sau khi lượt gọi
   đầu xong, nên mọi request đến trong lúc đó đều tự gọi backend.
2. **429 bị đọc thành "bảo trì tắt"**: body 429 không có `maintenance_mode`, mã
   cũ coi là `false` và nhớ 15 giây. Đang bảo trì (đang chạy migration) mà dính
   429 là cả site mở lại cho người dùng ghi vào DB.

Đo lỗi 2 bằng bản build thật của web (`next build && next start`) trỏ vào
backend giả có giới hạn 10 req/s (script ở scratchpad phiên, `check-mw.mjs`):

| Kịch bản | Trước sửa | Sau sửa |
|---|---|---|
| A. 100 trang song song, bảo trì tắt: số lượt gọi backend | 100 (90 bị 429) | **1** |
| B. bảo trì BẬT, 100 trang song song: số trang thấy bảo trì | 20/100 | **100/100** |
| B2. 30 trang ngay sau đó (trong 15 giây nhớ) | 0/30 | **30/30** |
| C. bảo trì bật, xô 10/s đã bị dùng hết, lượt làm mới dính 429 | (không chạy) | **50/50** |

## 3. Sửa

Web `fix/ssr-mot-lan-hoi-bao-tri`, commit **`1d10734`** (`src/middleware.ts`):

- Một promise `dangHoi` dùng chung: hết hạn thì chỉ MỘT lượt gọi backend, mọi
  request khác chờ chung kết quả.
- `!res.ok` (429, 5xx) thì giữ giá trị cũ; lỗi cũng nhớ 15 giây để không hỏi dồn.

Typecheck, `next lint`, `next build` xanh. Đã gộp `staging` (fast-forward
b7336ce → 1d10734), CD "Deploy Frontend" #163 xanh.

### Vì sao không làm khoá SSR + IP chuyển tiếp

Thiết kế đó đúng khi server render dữ liệu theo từng khách (server component gọi
`/products`, `generateMetadata` gọi chi tiết sản phẩm). Hiện chưa có chỗ nào
như vậy. Thêm vào bây giờ là thêm một bí mật phải quản lý ở hai nơi và một
đường tin header mới trong ThrottlerGuard, để bảo vệ đúng một lượt gọi mỗi 15
giây. **Điều kiện để làm**: trang nào chuyển sang lấy dữ liệu phía server (SEO
chi tiết sản phẩm là ứng viên đầu tiên) thì làm cơ chế đó cùng lúc, theo đúng
thiết kế: `SSR_SHARED_KEY` ở cả hai bên (không `NEXT_PUBLIC`), so sánh hằng thời
gian, chỉ tin `X-Zoldify-Client-IP` khi khoá khớp, mã gọi nằm trong file
`server-only`.

## 4. Kiểm trên staging sau deploy

| Kiểm | Kết quả |
|---|---|
| 100 trang `/product/1173` song song, cache đã hết hạn (2 lần) | 100 x 200, **1** lượt `/settings/public` từ IP VPS, 0 x 429 (cả hai lần) |
| 20 request song song thẳng vào `api-staging` từ một IP | 10 x 200, 10 x 429 (giới hạn vẫn chạy) |
| Như trên kèm `X-Forwarded-For`, `X-Real-IP`, `X-Zoldify-Client-IP` giả | 10 x 200, 10 x 429 (header giả không lách được) |

Log nginx hai ngày 02-03/11: lượt `/settings/public` từ IP VPS có 3061 x 200,
31 x 429 (đúng lượt tái hiện), 40 x 499 (quá hạn 2 giây, middleware tự bỏ).

## 5. Checklist lên production

Chỉ web đổi. Không có bí mật mới, không đổi `.env` backend, không đổi
`/opt/zoldify-web/frontend.vars`, không recreate backend.

1. Hỏi user duyệt.
2. Chọn cách lên web prod (`deploy-prod` đang ở `b2f75e2`, staging hơn 3 commit:
   `fac7b7c` mục Mới đăng tải thêm, `b7336ce` về đầu trang khi chuyển trang,
   `1d10734` bản sửa này):
   - cả ba (khuyên dùng nếu hai commit kia đã kiểm trên staging):
     `git push origin origin/staging:deploy-prod` (fast-forward);
   - chỉ bản sửa: nhánh từ `origin/deploy-prod`, `git cherry-pick 1d10734`, push
     vào `deploy-prod`.
3. Chờ CD "Deploy Frontend" trên `deploy-prod` xanh; trên VPS
   `cd /opt/zoldify-frontend && git log --oneline -1` ra đúng commit,
   `docker ps --filter name=zoldify-web-frontend` mới khởi động.
4. Kiểm (đừng bắn vào API prod từ VPS):
   - đợi 16 giây, bắn 100 lượt tải trang `https://zoldify.com/product/<id>?v=N`
     song song từ máy ngoài;
   - trên VPS đếm dòng mới của `/var/log/nginx/access.log` có IP
     `103.249.117.151` và `/api/v1/settings/public`: phải là 1 (hoặc vài, mỗi
     lượt hết hạn 15 giây một lượt), không có 429;
   - trang vẫn 200. Tuỳ chọn: bật bảo trì ở admin, mở trang thấy bảo trì, tắt lại.
5. Quay lui: nhánh từ `origin/deploy-prod`, `git revert 1d10734`, push vào
   `deploy-prod` (CD build lại). Không cần đụng backend.
