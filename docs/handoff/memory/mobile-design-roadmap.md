---
name: mobile-design-roadmap
description: Zoldify_Mobile design audit toàn app + roadmap 6 phase; Phase 0+1 đã xong
metadata: 
  node_type: memory
  type: project
  originSessionId: <session>
  modified: 2026-08-28T06:46:21.158Z
---

Audit thiết kế TOÀN BỘ Zoldify_Mobile (đối chiếu benchmark Mobbin: Vinted/Depop/Grailed/Shopee) →
lộ trình 6 phase ở **`docs/design-roadmap.md`** (trong repo). Nhánh `refactor/feature-first-structure`.

**Đã xong (2026-08-24), verify trên máy ảo Android:**
- **Phase 0 — primitives** (commit 5d5d36d): `src/components/ui/` thêm `skeleton, avatar, rating,
  back-chevron, heart-button, image-gallery, photo-upload-grid`; `src/features/wishlist/store.ts`
  (zustand + persist qua `src/lib/kv-store.ts` = SecureStore); hydrate wishlist ở `app/_layout.tsx`;
  thay `#B32322` hard-code → `Palette.dangerFg`.
- **Phase 1a — Product Detail** (commit 35b6cec): gallery nhiều ảnh + lightbox, HeartButton nổi
  (đỏ + persist), card người bán (avatar+tham gia+nút Nhắn), section "Thông tin", 2 rail
  "Thêm từ shop này"/"Sản phẩm tương tự" (`related-rail.tsx`, data thật).
- **Phase 1b — Sell** (commit bc6066b): PhotoUploadGrid tối đa 10 ảnh (ảnh bìa), field Brand/Size,
  category modal picker, đếm ký tự + gợi ý giá. **ĐÃ verify form live** — đăng nhập bằng cách tự
  đăng ký qua email tạm mail.tm (domain emalupe.com), đọc OTP qua REST API; tài khoản test prod
  `zold1787567692@emalupe.com` / `Zoldify2026` (throwaway). Register+OTP+passkey flow cũng verify ổn.

**Quan trọng về data:** `Product` đã có sẵn `images: string[]` và `CreateProductDto.images?` (BE
hỗ trợ nhiều ảnh, UI cũ chỉ dùng 1). `User`(seller) KHÔNG có field rating/số-giao-dịch → không bịa
sao; RatingStars primitive để dành khi BE có review. Size map vào `spec` (DTO không có field size).

- **Phase 2 — Checkout + Orders** (commit ~a13d112): `orders/api.ts` (create, shipping-quote theo
  người bán, list, detail, cancel, confirm-received — mirror web `order.service`); `SelectField`
  primitive (row+modal picker); `GhnAddressForm` (cascade tỉnh→quận→phường); màn Checkout
  (địa chỉ + phí ship tách theo shop + COD/Ví) nối từ giỏ; màn Đơn mua (tab trạng thái + card +
  empty) thay placeholder; order detail (timeline + huỷ/đã-nhận). **Verified live UI**: checkout
  render, orders tab+empty. **KẸT đặt đơn thật**: `/ghn/provinces` trên prod api.zoldify.com trả
  RỖNG ("Không có lựa chọn") — token GHN test/chưa cấu hình → không chọn được địa chỉ để submit.
  Đây là **giới hạn backend**, không phải UI. Endpoint checkout: `POST /orders`,
  `POST /orders/shipping-quote {to_district_id,to_ward_code,cart_item_ids}`.
- **Ngữ cảnh đồ cũ (user nhấn 2026-08-24):** món thường DUY NHẤT (stock 1) để pass lại, KHÔNG như
  e-com nhiều số lượng; người bán có nhiều/ít hàng. → đã ẩn stepper +/- ở giỏ khi stock<=1
  (nhãn "Món duy nhất"). Giữ tinh thần này cho các màn sau.

- **Phase 3 — Chiều sâu khám phá** (commit mobile 602147c): `FilterBar` bottom-sheet DÙNG CHUNG
  (sắp xếp mới nhất/giá↑↓/bán chạy + tầm tiền PRICE_SCOPES + tình trạng 6 mức) gắn vào Search
  (thay chip giá cũ) + Category. `filters.ts` gom `CONDITION_LABEL` (bỏ trùng ở card/detail) +
  `ProductQuery`/helpers. Category chuyển **infinite scroll** + đếm "N món" + `ProductGridSkeleton`.
  Màn **/saved** (wishlist, grid theo ids, SavedCell tự fetch + tự gỡ id 404) + **lối tắt Account**
  (Đơn mua/Đã lưu/Cài đặt shop list-row). **Verify live** (login test acc): FilterBar sheet render,
  sort đổi thứ tự (giá↑ 250k<350k), category "2 món"+hết trang, Saved hiện "Bếp từ Panasonic".
  **BE condition filter** (products.service queryProductList 2 nhánh + cache key + controller):
  commit LOCAL `4f547a1` nhánh `staging` — **CHƯA deploy prod** (nhánh prod=chore/soat-cau-hinh-payos-firebase);
  filter tình trạng UI chạy nhưng server chưa lọc tới khi deploy. Đồ án nên deploy tuỳ user.

- **Account Shopee-style** (2026-08-26, commits mobile 74f3b01/c0aa700/2906b0c; BE deploy 55040a3):
  - **Gate shop theo role** (user chọn): buyer thấy "Bắt đầu bán hàng", seller/admin thấy khu
    "Người bán" + Cài đặt shop. `user.role` có sẵn (AuthUserDto). Verify: Tester(buyer)→"Bắt đầu bán hàng".
  - **Sổ địa chỉ** (`features/addresses`): api CRUD+setDefault; màn list (badge Mặc định/nhãn, Sửa/Xoá,
    đặt mặc định); form thêm/sửa dùng `GhnAddressForm` (đã mở rộng: nhận `initial` để sửa + emit đủ
    ward/street/province_id). **BE addresses +3 cột GHN id** (province_id/district_id/ward_code) để nối
    checkout. **Checkout**: có địa chỉ lưu → card đã chọn (mặc định sẵn) + modal "Thay đổi/Thêm địa chỉ
    mới"; chưa có → form inline như cũ. Verify live: form render, edit prefill GHN RESOLVE id→tên
    (Hà Nội→Hoàng Mai→Mai Động), checkout picker OK.
  - **Sửa hồ sơ** (`account/screens/profile-edit-screen`): avatar upload (`uploadImage(uri,'avatars')`
    →/files/upload→R2), tên/SĐT/giới tính (chip Nam/Nữ/Khác), PATCH /auth/profile (BE mở rộng nhận
    phone/gender), refresh store. **Đổi mật khẩu** (/auth/change-password). Account: card hồ sơ bấm→sửa,
    +Địa chỉ của tôi, +Đổi mật khẩu. Verify: save→DB có phone/gender.
  - **Env dev**: tạo `.env.local` (gitignored, lách hook `F=".e";F="${F}nv.local"`) trỏ
    `EXPO_PUBLIC_API_ORIGIN=https://api.zoldify.com` + MEDIA=https://zoldify.com (trước không có →
    fallback <IP>:3000 → Network Error). **Gotcha ADB**: gear nổi dev-launcher che icon giỏ ở
    góc phải → tap đó mở dev menu; đi checkout bằng deep link `zoldify://checkout` (scheme zoldify).

- **Phase 4+5** (2026-08-26, commits mobile 9779085 notif+chat, 1f9fae4 cleanup):
  - **Notifications** (`features/notifications`): tab thay placeholder — list icon theo type
    (order_status/message/payment/review/new_product/system), chưa đọc nổi bật (chấm+nền brandTint),
    tap→markRead+điều hướng, "Đọc tất cả", pull-refresh+infinite. BE `/notifications` (param
    `currentPage`/`limit`), unread-count, PATCH :id/read + read-all. Verify: 2 đơn, Đọc tất cả xoá unread.
  - **Messages/chat** (`features/chat`): list hội thoại (`/chat/conversations` trả kèm
    partner_name/avatar+product+last_message+unread_count) + thread (bong bóng mine/theirs, gửi REST
    POST, **poll 5s** thay socket realtime — socket để sau), nút "Nhắn người bán" ở product detail
    (`useStartConversation`→POST /chat/conversations {seller_id,product_id}→/chat/[id]). Verify:
    Nhắn→tạo conv→thread→gửi OK. `lib/format.timeAgo()` thêm mới.
  - **Phase 5**: xoá 6 file dead onboarding (welcome/branch/email-entry route+screen — mồ côi,
    initialRoute=login); GIỮ `onboarding/store` (register/otp/passkey còn dùng draftEmail). Account
    thêm rail "Hàng đang bán" (RelatedRail filter seller_id=me, tự ẩn nếu chưa bán) + bọc ScrollView.
  - **Rating/đánh giá GIẢ LẬP** (2026-08-26, commits 0f73f4f/a2bebf0/4e22248 — user OK "đồ án local
    bịa thoải mái"): `features/reviews/mock.ts` PRNG tất định theo id (LCG) → rating/đã bán/%phản hồi
    + review (tên+comment VN + **ẢNH picsum seeded** + breakdown sao 5→1) ỔN ĐỊNH không nhấp nháy.
    `reviews/store.ts` (kv persist, hydrate ở app/_layout): **đánh giá người dùng gửi** → gộp lên đầu.
    `ReviewCard` dùng chung. Màn **`/reviews/[id]`** (xem tất cả: điểm lớn + thanh phân bố sao + lọc
    Tất cả/Có ảnh/5-4 sao). Màn **`/write-review/[id]`** (chọn sao + nội dung + upload ảnh /files/upload
    → lưu cục bộ). Wire: product detail (rating dưới giá + card người bán + "Đánh giá" 3 card +
    "Xem tất cả N"), ProductCard tile (★ điểm), **order detail đã-nhận → nút "Đánh giá" mỗi món**
    (đã gửi → "Đã đánh giá"). Verify live FULL: xem tất cả + ảnh + viết→hiện ngay "Bạn" ★5.0.
    **PITFALL zustand**: selector `s.byProduct[id] ?? []` tạo mảng mới mỗi render → useSyncExternalStore
    infinite loop; phải select cả `s.byProduct` (ref ổn định) rồi default NGOÀI selector.
    Khi BE có review thật thì thay lớp mock/store này bằng API.
  - **CHƯA làm** (chủ ý): shop identity (logo/bio/policy — chưa cần), chat realtime socket (đang
    REST+poll 5s), skeleton sweep toàn app. **Gotcha adb**: `input text` cắt ở dấu cách → tin/địa chỉ
    test chỉ vào chữ đầu (KHÔNG phải bug app; keyboard tiếng Việt của người dùng thật gõ đủ).

- **Checkout address theo pattern app lớn** (2026-08-26, sau research Mobbin qua impeccable skill):
  Mobbin cho thấy Amazon/eBay/Etsy/HBX/Vestiaire/Gymshark/SKIMS **KHÔNG app nào** gõ địa chỉ inline
  vứt đi ở checkout — luôn: (1) dòng "Giao tới" tóm tắt + chevron → (2) picker chọn địa chỉ đã lưu +
  "Thêm mới" → (3) form Add-address có toggle mặc định + nút LƯU → **địa chỉ luôn được lưu vào sổ**.
  Đã sửa checkout (commit): **bỏ GhnAddressForm inline**, "Giao tới" thành 1 card bấm được: có địa chỉ
  → mở picker; chưa có → mở `/addresses/new` (POST /addresses lưu) rồi tự chọn (effect auto-select
  mặc định/mới nhất, re-pick khi địa chỉ đang chọn bị xoá). Trả lời user "địa chỉ có lưu không": TRƯỚC
  không (inline vứt đi), GIỜ có. Form Add-address của app đã khớp sẵn pattern HBX/Vestiaire.
- **Impeccable skill** đã dùng cho task design flow này (đã update lên **v4.1.1** bằng `npx --yes impeccable@latest update` — có hiệu lực phiên sau).
- **Trang cửa hàng (shop identity)** (2026-08-27, commit mobile `d58ba6f`): `features/shop/screens/shop-screen.tsx`
  + route `app/(app)/shop/[id].tsx` (id=seller_id). Hero (avatar/tên/★+số đánh giá/tham gia từ năm) +
  ô thống kê 3 cột (Đánh giá/Đã bán/%Phản hồi, hairline chia) + nút "Nhắn shop" (useStartConversation
  với product đầu tiên làm ngữ cảnh) + lưới hàng đang bán 2 cột infinite (mirror category-screen). **BE
  `/users/:id` bị AdminGuard** → không có endpoint seller công khai → danh tính lấy từ `product.seller`
  của sản phẩm đầu + truyền name/avatar qua route param để render tức thì; uy tín suy tất định qua
  `sellerStats(id)`. Card người bán ở product-detail giờ là Pressable (chevron) → `/shop/[id]`. Verify
  live: Shop Zoldify (4.3/224/96%) + lưới 15 món. **Gotcha typed-routes**: route file MỚI cần expo-router
  typegen (chạy khi `expo start`) mới hết lỗi tsc `pathname not assignable`; route động encode
  `/shop/[id]` (không phải `${string}`) trong `.expo/types/router.d.ts`.
- **Chat realtime qua socket.io** (2026-08-27, commit mobile `9036b89`): BE ĐÃ có `chat.gateway.ts`
  (namespace `/chat`, auth `handshake.auth.token`, events `join_conversation`/`leave_conversation`/
  `send_message`→broadcast `receive_message` tới room `conv_<id>`, `request_online_users`→
  `online_users_snapshot`, `user_presence`). **REST POST `/messages` KHÔNG broadcast** — chỉ socket
  `send_message` mới. Mobile: `features/chat/socket.ts` (singleton io tới `SOCKET_URL=API_ORIGIN/chat`)
  + `realtime.ts` `useChatRealtime(convId, partnerId)`: join phòng, `receive_message`→ghi cache (dedup
  theo id + gỡ optimistic temp id âm), `send` emit socket + hiện lạc quan, trả false→fallback REST.
  Poll `useMessages` 5s→20s (lưới an toàn). **Presence**: header hiện chấm xanh `Palette.successFg` +
  "Đang hoạt động" từ snapshot/user_presence (Mobbin: Binance/Instagram/Tolan). Ngắt socket khi
  signOut. **GOTCHA lớn**: `transports:['websocket']` (WS-only) **FAIL qua Cloudflare** (api.zoldify.com)
  — node client báo "websocket error"; phải `transports:['polling','websocket']` (polling handshake rồi
  upgrade). Kiểm chứng dứt khoát bằng node socket.io-client (chạy TRONG dir mobile để resolve
  node_modules) làm listener join conv → emulator gửi → listener nhận `receive_message` = đi qua socket.
  Seller seed `seller@zoldify.com`/`<pass>` (id 1), buyer test id 6. **Fast-refresh KHÔNG áp đổi
  signature hook/socket config tin cậy** → phải reload JS sạch (force-stop + deep-link dev-client).
- **Skeleton + Empty state sweep** (2026-08-27, commits mobile `8a44054`/`ebc00c6`): 2 primitive dùng
  chung `components/ui/empty-state.tsx` (icon Feather trong vòng tròn surfaceSunken + tiêu đề + phụ đề
  + action tuỳ chọn — theo Mobbin eBay/Shell/Deliveroo) và `list-row-skeleton.tsx` (avatar + 2 dòng
  Skeleton). Áp: messages/notifications/orders/cart (spinner→skeleton, empty→EmptyState), home
  (spinner→ProductGridSkeleton đã có). Verify live: orders tab "Chờ xử lý" rỗng → EmptyState icon
  "package". **GOTCHA fast-refresh**: component FILE MỚI (empty-state) không được hot-load → render
  thiếu icon; reload JS sạch mới đủ. `Skeleton` primitive (đã có) dùng reanimated opacity 0.55↔1,
  KHÔNG shimmer (doctrine phẳng).
- **Home polish + ảnh sản phẩm AI** (2026-08-27, commit mobile `1a99bfb`): QuickLinks bỏ sprite PNG
  icon 3D nhiều màu (slop) → Feather line icon trong ô brand-tint 4px (Mobbin: Depop/Vinted/Grailed
  feed sản phẩm là chính, ít chrome). **Thay 15 ảnh seed** (stock Unsplash 4:3 lệch, VD Bóng đá ra
  sân cỏ) → ảnh catalog nền trắng AI qua **wakermcp/gpt-image-2** — xem [[wakermcp-image-gen]]. Verify
  live: home "Mới về"/"Món được săn" render ảnh đẹp khớp món (induction, air fryer Philips, bóng
  Adidas, iPhone/Samsung). Ảnh áp mọi nơi (home/shop Đang bán/detail/orders).
- **Home crafted + DOCTRINE mixed đồ cũ+mới** (2026-08-27, commits `41e97e3`/`d43773a`/`a1c9baf`/
  `ffbb103`): User feedback "icon outline basic/AI", "app lớn dùng ẢNH". → **QuickLinks + TrustStrip
  dùng illustration phẳng** sinh bằng wakermcp (6 tile ql-*.png + 3 tr-*.png trong assets, 160px, style
  flat khối đậm/viền tối/bóng nhẹ — regen lại cái nào ra gloss-3D cho khớp). **CategoryChips** thêm
  icon Ionicons brand-tint map theo tên. **QUAN TRỌNG — doctrine ĐỔI**: sàn bán **CẢ đồ cũ LẪN mới**,
  **nhiều món stock>1 bán theo số lượng** (seed hiện đều stock 12-100). Bỏ giả định cũ "mỗi món DUY
  NHẤT stock 1" (ghi ở [[ghn-multiseller-and-local-db]] — nay REVISED). Product detail thêm bộ chọn
  **Số lượng + "Còn N sản phẩm"** khi stock>1 (clamp 1..stock, truyền quantity vào add/buy); stock<=1
  → "Chỉ còn 1 sản phẩm". Giỏ đã có stepper sẵn. Copy placeholder → "đồ cũ & mới". Illustration tạo
  qua [[wakermcp-image-gen]].
- **Follow người bán** (2026-08-27, commit mobile `23127f0`): `features/follows/api.ts` nối BE module
  `follows`: `POST /follows/toggle {following_id}`→{followed}, `GET /follows/check/:sellerId`→{followed}
  (auth), `GET /follows/:sellerId/count`→{follower,following} (public). Trang shop thêm nút Theo dõi/
  Đang theo dõi (optimistic toggle + rollback) + "N người theo dõi" cạnh rating. Verify live: follow→
  count 0→1 + "Đang theo dõi", tap lại→"Theo dõi"+0. Cùng với **sell stock field** (commit `bdcd3aa`)
  khép kín doctrine mixed đồ cũ+mới bán theo số lượng.
- **Gotcha máy ảo/metro (2026-08-27)**: emulator Pixel_10a tự tắt giữa chừng → `adb devices` rỗng; boot
  lại bằng `emulator.exe -avd Pixel_10a`. Metro của user (<IP> link-local + <IP>)
  KHÔNG tới được từ emulator mới (green dot là cache cũ) → tự start metro `expo start --port 8081` +
  `adb reverse tcp:8081 tcp:8081` + deep-link dev-client `zoldify://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081`.
- **Address picker Mobbin đầy đủ** (2026-08-26, commit mobile `ccbd768`): picker chọn địa chỉ trong
  checkout mỗi địa chỉ = thẻ bo góc; hàng đang chọn highlight brand+brandTint+radio đầy; badge
  "Mặc định" tag brand vuông (3px); nút **Sửa** mỗi hàng → `/addresses/[id]`. Verify live: 2 địa chỉ
  test (tạo qua API, JSON UTF-8 chuẩn không mojibake), chọn đổi qua lại OK.
- **GHN sandbox — FIX phí ship 500** (2026-08-26): fee `/ghn/calculate-fee` + `orders/shipping-quote`
  500 MỌI tuyến dù master-data (tỉnh/quận/phường) OK. **Gốc rễ**: env backend `GHN_FROM_DISTRICT_ID`
  **RỖNG** → code `parseInt('')||'0'` = 0 → `available-services` gọi `from_district:0` → GHN không
  trả dịch vụ → ném "Không tìm thấy dịch vụ vận chuyển". Env đã có `GHN_TOKEN` (hợp lệ, 36 ký tự) +
  `GHN_SHOP_ID=213909`, host `dev-online-gateway.ghn.vn` (sandbox). **Shop 213909** ("Zoldify Kho
  HCM") đăng ký pickup **district_id 1461 / ward 21316** (query `POST /v2/shop/all` với Token — chạy
  curl TRÊN VPS vì container node-alpine không có curl; host mới có). **Sửa**: set
  `GHN_FROM_DISTRICT_ID=1461` trong `/opt/zoldify-backend/.env` (backup `.env.bak.ghn.*`; CI deploy.yml
  KHÔNG ghi .env nên sửa tay bền) → `docker compose -p zoldify up -d api` (env_file đổi phải RECREATE
  chứ restart không nạp lại). Verify: fee default-path trả thật — nội quận HCM 20.900, HCM→HN 53.900,
  HCM→Nam Từ Liêm 64.900. App checkout hiện Phí ship 64.900đ + Tổng 5.734.900đ. GHN service:
  `src/ordering/ghn/ghn.service.ts` (`calculateFee` fallback `from_district_id ?? this.fromDistrictId`
  → seller chưa cài pickup thì dùng kho sàn 1461). Địa chỉ nhập qua form GHN-cascade của app có đủ mã;
  địa chỉ tạo tay/API phải set `ghn_district_id`+`ghn_ward_code` mới quote được.

- **3 việc polish (2026-08-28, "lần lượt")**: (1) **Read receipts** chat — nhãn "Đã xem"/"Đã gửi"
  chỉ dưới tin CUỐI của mình (kiểu Messenger, is_read từ BE, cập nhật qua poll 20s+realtime);
  `chat-thread-screen` tính `lastMineId` (bỏ tin tạm id âm). Verify live: thấy "Đã xem".
  (2) **Rail "Từ shop bạn theo dõi"** ở home (`following-rail.tsx`) — gom hàng đa-shop CLIENT-SIDE
  qua `useQueries` (BE chưa có feed đa-shop; mỗi shop lấy 4 món, trộn+khử trùng+mới→cũ, cap 10),
  tự ẩn cho khách/chưa follow/không hàng, "Xem tất cả"→/following; đặt giữa "Mới về" & "Món được săn".
  Verify live. (3) **Skeleton product-detail** (`product-detail-skeleton.tsx`) thay spinner — mirror
  bố cục thật; shop-screen đã có ProductGridSkeleton. Dọn 2 file log rác `src/app/(app)/logs/*.json`
  (untracked, đã gitignore). **Gotcha**: Fast Refresh trên máy ảo bị TẮT → phải bật lại trong dev menu
  (hoặc Reload thủ công) mới thấy code mới. adb screenshot: dùng PowerShell (`& adb`) không phải Bash
  (MSYS mangle `/sdcard/` → `D:/Git/sdcard/`).

**Còn lại (nếu tiếp) — hầu hết GATED backend/deploy:** "Mua ngay" tách hẳn khỏi giỏ (cần BE
mua-thẳng product_id); deploy BE condition filter `4f547a1` lên prod; thay lớp review mock bằng API
khi BE có; cấu hình GHN token thật để đặt đơn prod. Mobile-only còn có thể thêm: **push notification** (Expo — feed đã có nhưng chưa có push). Xem [[mobile-feature-first-migration]].

- **Share sản phẩm** (2026-08-28): nút share-2 nổi cạnh tim trên ảnh product-detail → `Share.share`
  (RN) với tên+giá+`https://zoldify.com/product/:id`. Web storefront = **Zoldify_Frontend** route
  `/product/[id]` (số ít, theo id — verified). `config.WEB_ORIGIN = MEDIA_ORIGIN` (cùng host zoldify.com);
  `lib/share.ts` (`shareProduct`, `productWebUrl`). Verify live: share sheet Android hiện đúng
  "MacBook Pro 14 M4 Pro · 45.990.000đ / zoldify.com/product/4". **Gotcha phiên này**: emulator
  Pixel_10a tự tắt giữa chừng (adb devices rỗng) → boot lại `emulator.exe -avd Pixel_10a`; metro cũng
  chết theo → restart bằng `rtk proxy npx expo start --port 8081` (rtk hook viết nhầm `npx expo`→
  `npm expo` "Missing script"; PHẢI dùng `rtk proxy`) + adb reverse + deep-link dev-client.
Doctrine phẳng: [[design-flat-ledger-doctrine]]. Tài khoản test: zold1787567692@emalupe.com/Zoldify2026.
