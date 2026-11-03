# Cache biên Cloudflare cho danh sách công khai

Ngày 03/11/2026. Nhánh `feat/cache-cloudflare-danh-sach`, PR #36.

## Vì sao làm

Đường đi của một request: khách -> Cloudflare (đám mây cam) -> nginx trên VPS ->
Caddy -> một trong ba bản api. Tất cả nằm trên MỘT VPS.

Trang chủ mở ra là gọi `GET /api/v1/products` và `GET /api/v1/categories`. Redis
đã giữ sẵn kết quả danh sách, nhưng Redis chỉ bớt được câu SQL: mỗi lượt vẫn đi
trọn nginx, Caddy, Nest, guard, throttler, serialize JSON, gzip. Trước khi sửa,
Cloudflare KHÔNG cache JSON (mặc định nó chỉ cache file tĩnh theo đuôi), nên
nghìn người cùng cuộn trang chủ là nghìn lượt vào VPS cho cùng một kết quả.

## Cái gì được cache, bao lâu

Chỉ khi request **không có header `Authorization`**:

| Route | Biên giữ | Trình duyệt |
| --- | --- | --- |
| `GET /api/v1/products` (danh sách, tìm kiếm, lọc) | 30 giây | hỏi lại mỗi lần |
| `GET /api/v1/shop/:sellerId` | 30 giây | hỏi lại mỗi lần |
| `GET /api/v1/shop/:sellerId/products` | 30 giây | hỏi lại mỗi lần |
| `GET /api/v1/categories`, `/categories/slug/:slug`, `/categories/:id` | 300 giây | hỏi lại mỗi lần |

Header origin trả cho các route đó (mã: `src/common/cache-bien.ts`):

```
Cache-Control: public, max-age=0
CDN-Cache-Control: max-age=30, stale-while-revalidate=30, stale-if-error=300
Access-Control-Allow-Origin: *
```

- `CDN-Cache-Control` là header Cloudflare đọc TRƯỚC `Cache-Control`. Trình duyệt bỏ qua nó.
- Không dùng `s-maxage`: theo tài liệu Cloudflare, có `s-maxage` thì Cloudflare
  tắt cả `stale-while-revalidate` lẫn `stale-if-error`. Khi đó đúng lúc hết hạn
  mọi request dồn về origin chờ bản mới, và VPS sập thì khách nhận lỗi.
- `stale-while-revalidate=30`: hết 30 giây, Cloudflare trả bản cũ ngay và lấy
  bản mới ở nền (trạng thái `UPDATING`), không ai phải chờ origin.
- `stale-if-error=300`: VPS lỗi 5xx hoặc không với tới được, khách vẫn nhận bản
  cũ thêm tối đa 5 phút.
- `Access-Control-Allow-Origin: *` và bỏ `Access-Control-Allow-Credentials`:
  Cloudflare không tách cache theo `Origin`. Nếu giữ kiểu phản chiếu origin của
  `main.ts`, bản đầu tiên vào cache (từ app di động không gửi Origin, hoặc từ
  admin) mang ACAO sai, và trình duyệt chặn CORS cho mọi trang web khác. Ba
  client xác thực bằng Bearer, không dùng cookie, và dữ liệu này công khai.

Có `Authorization` (kể cả token hỏng), hoặc response có `Set-Cookie`:
`Cache-Control: private, no-store`. Lỗi (4xx/5xx), POST/PATCH/DELETE, và route
mà handler đã tự đặt `Cache-Control` thì không đụng.

### Cố ý KHÔNG cache

- **Chi tiết sản phẩm `GET /products/:id`**: `findOne` đếm `view_count` ở mỗi
  lượt gọi. Lượt trúng biên không tới origin thì `most_viewed` lại sắp theo số
  lần cache hết hạn (đúng lỗi đã sửa 26/10). Gỡ khi lượt xem được đếm bằng
  đường riêng (ví dụ một beacon POST nhẹ).
- `GET /settings/public` (cờ bảo trì): bật bảo trì phải có hiệu lực ngay.
- Mọi route theo người dùng (giỏ, đơn, ví, `/products/mine`, `/shop/me`...).
  Bài quét trong `src/common/cache-bien.spec.ts` duyệt MỌI controller: route
  nào mang `@CacheBien` phải nằm trong danh sách cho phép, là GET và `@Public()`.

## Rule Cloudflare (staging, đã bật)

Zone `zoldify.com` (`1b4e5f54039529e2a465c82b05042b94`, gói Free), phase
`http_request_cache_settings`.

- Ruleset: `ad30ed18347f41e3bc9be6235c168c0f`
- Rule: `ad2464b1dd3a478581c42c7e97465e17`, ref `zoldify_api_staging_cache_danh_sach`

Biểu thức:

```
(http.host eq "api-staging.zoldify.com"
 and http.request.method in {"GET" "HEAD"}
 and (http.request.uri.path eq "/api/v1/products"
      or starts_with(http.request.uri.path, "/api/v1/categories")
      or starts_with(http.request.uri.path, "/api/v1/shop/"))
 and not any(lower(http.request.headers.names[*])[*] eq "authorization"))
```

Hành động:

```json
{
  "cache": true,
  "edge_ttl": { "mode": "bypass_by_default" },
  "browser_ttl": { "mode": "respect_origin" }
}
```

Trên dashboard: Caching > Cache Rules > rule "Zoldify api-staging: cache danh
sach cong khai...": Eligible for cache; Edge TTL = "Use cache-control header if
present, bypass cache if not"; Browser TTL = "Respect origin".

`bypass_by_default` là chốt an toàn chính: Cloudflare chỉ cache response mà
origin ĐÃ gắn header cache. Lỗi, `/shop/me` không token (401), route con khác
dưới `/shop/` hay `/categories` không mang `@CacheBien` đều không có header đó,
nên đi thẳng (`BYPASS`). Muốn cache thêm route thì sửa ở backend trước, rule
chỉ là cửa vào.

Khoá cache: mặc định của Cloudflare, gồm cả query string, nên `?current=2`,
`?q=...`, `?category_id=...` là các bản riêng. API không đọc `Accept-Language`
hay header nào khác ngoài `Authorization` (đã rà `req.headers` trong `src`),
nên không cần thêm gì vào khoá.

## Kết quả đo trên staging

Đo ngày 03/11 sau khi staging chạy `6eff20b` và rule đã bật. Script đo:
200 request cùng một URL, 20 luồng song song, bắn từ chính VPS qua
`https://api-staging.zoldify.com`; mỗi lượt đo gắn `&probe=<nhãn>` riêng để đếm
chính xác trong `/var/log/nginx/access.log` (log dùng chung các host, nhãn làm
URL là duy nhất). Redis cache không bị ảnh hưởng vì API bỏ qua tham số lạ.

| | Trước (chưa có header, Cloudflare `DYNAMIC`) | Sau |
| --- | --- | --- |
| Lượt tới origin / 200 request | **200** | **3** |
| Trạng thái Cloudflare | 200 `DYNAMIC` | 197 `HIT`, 3 `MISS` (98,5% HIT) |
| Mã trả về | 13 x 200, **187 x 429** | 200 x 200, 0 x 429 |

Trước khi sửa, 187/200 request bị chính throttler của mình chặn (10 req/giây
mỗi IP), vì mọi lượt đều tới origin. Sau khi sửa lượt HIT không tới origin nên
cũng không bị đếm vào giới hạn. Ba lượt MISS là do VPS đi ra hai điểm biên
(cf-ray đuôi `SIN` và `MRS`): mỗi điểm biên có cache riêng, gói Free không có
Tiered Cache.

Kiểm từng route qua Cloudflare (lượt 1, 2, 3 cùng URL):

- `/products`, `/shop/1`, `/shop/1/products`: `MISS` rồi `HIT`, `age` tăng 1, 2, 3...
- `/categories`: `max-age=300`, `HIT` sau lượt đầu ở mỗi điểm biên.
- `/products/1` (chi tiết): `DYNAMIC` cả ba lượt, đúng thiết kế.
- Có `Authorization`: `DYNAMIC` cả hai lượt, `cache-control: private, no-store`,
  ACAO phản chiếu origin như cũ.
- Origin trực tiếp (`127.0.0.1:3100`) với `Origin: https://staging.zoldify.com`:
  `Access-Control-Allow-Origin: *`, `Vary: Accept-Encoding` (đã bỏ `Origin`),
  không có `Access-Control-Allow-Credentials`.
- `fetch` ẩn danh từ `https://staging.zoldify.com` và
  `https://admin-staging.zoldify.com` tới `/products`, `/categories`, `/shop/1`:
  đều 200, không lỗi CORS.

Hàng mới hiện bao lâu (seller@zoldify.com tạo một sản phẩm, rồi xoá ngay):

```
moi: MISS age= ; HIT age=1 ; HIT age=2        (đã vào cache)
tao xong id=1174
co token ngay sau khi tao: DYNAMIC, thay=True  (người bán thấy ngay)
t+0s  an danh: HIT age=4   thay=False
...
t+23s an danh: HIT age=27  thay=False
t+26s an danh: UPDATING age=30 thay=False      (stale-while-revalidate chạy)
t+29s an danh: HIT age=3   thay=True           => khách thấy sau 29 giây
```

`UPDATING` xác nhận Cloudflare dùng `stale-while-revalidate` từ
`CDN-Cache-Control`: hết 30 giây khách vẫn nhận bản cũ ngay, bản mới về ở nền.

## Purge (xoá cache biên khi cần thấy ngay)

Thường không cần: tối đa 30 giây (danh mục 5 phút) là tự mới. Cần ngay thì:

- Dashboard: Caching > Configuration > Purge Cache > Custom Purge > URL, dán
  đúng URL (kèm query string), ví dụ
  `https://api-staging.zoldify.com/api/v1/categories`.
- Gói Free không purge theo prefix hay tag; "Purge Everything" xoá cả zone
  (cả web), chỉ dùng khi thật sự cần.
- API (token có quyền Cache Purge):

```
curl -X POST "https://api.cloudflare.com/client/v4/zones/1b4e5f54039529e2a465c82b05042b94/purge_cache" \
  -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
  --data '{"files":["https://api-staging.zoldify.com/api/v1/categories"]}'
```

Tắt hẳn (sự cố): Caching > Cache Rules > tắt rule. Không cần deploy lại backend:
không có rule thì Cloudflare không cache JSON, header của origin vô hại.

## Rủi ro và đánh đổi

| Rủi ro | Mức | Xử lý |
| --- | --- | --- |
| Khách thấy danh sách cũ tối đa ~30 giây (+ tối đa 30 giây `UPDATING`), danh mục ~5 phút | chấp nhận | Người bán và admin gửi token nên luôn thấy bản mới. Cần ngay thì purge. |
| Tồn kho, giá trên thẻ danh sách cũ trong TTL | thấp | Giỏ và đặt hàng luôn kiểm lại ở origin, socket kho vẫn đẩy realtime. |
| VPS sập: khách vẫn thấy danh sách cũ tới 5 phút | có lợi | Có chủ đích (`stale-if-error=300`). |
| Response được cache mang `X-Request-Id`, header giới hạn tốc độ của lượt vào origin | thấp | Chỉ để chẩn đoán; lượt HIT không qua origin nên không có mã request riêng. |
| Người đã đăng nhập không hưởng cache (client gửi token ở mọi request) | nợ | Gỡ: web/app bỏ `Authorization` ở các GET công khai này (kết quả không phụ thuộc người xem). |
| Ai đó dán `@CacheBien` lên route theo người dùng | đã chặn | Bài quét mọi controller trong `cache-bien.spec.ts` đỏ. |
| Bật bảo trì: danh sách cũ còn phục vụ tới hết TTL | thấp | Purge hoặc tắt rule nếu cần dừng hẳn. |

## Đưa lên production (CHƯA làm, cần anh Đạt đồng ý)

1. Fast-forward nhánh prod `chore/soat-cau-hinh-payos-firebase` (đang là
   `944dfac`) lên `origin/staging` (chứa `6eff20b` và commit tài liệu này), chờ
   Deploy Backend xanh. Là fast-forward thuần: staging tách từ `944dfac`.
2. Kiểm header ở origin prod (từ VPS, bỏ qua Cloudflare):
   `curl -s -D - -o /dev/null -H 'Host: api.zoldify.com' 'http://127.0.0.1:3000/api/v1/products?pageSize=8'`
   phải có `CDN-Cache-Control: max-age=30, ...` và `Access-Control-Allow-Origin: *`.
3. Cloudflare: Caching > Cache Rules: thêm rule giống hệt, đổi host thành
   `api.zoldify.com` (hoặc sửa biểu thức rule staging thành
   `http.host in {"api-staging.zoldify.com" "api.zoldify.com"}`).
4. Kiểm trên prod: hai lượt GET ẩn danh cùng URL -> `MISS` rồi `HIT`, `age` tăng;
   lượt có `Authorization` -> `DYNAMIC`/`BYPASS` và `cache-control: private, no-store`;
   mở web zoldify.com và admin, kiểm tab Network không có lỗi CORS.
5. Theo dõi 15 phút: `npm run log:summary` trên log api, số lượt `/api/v1/products`
   tới origin phải giảm rõ; không có báo lỗi CORS từ web/admin.
6. Hoàn tác nếu cần: tắt rule prod (tức thì), không cần revert mã.
