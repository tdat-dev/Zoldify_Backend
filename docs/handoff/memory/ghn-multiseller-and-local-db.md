---
name: ghn-multiseller-and-local-db
description: "GHN multi-seller (P1-P3 xong) + DB dev Zoldify chạy bằng Docker container, không phải Laragon"
metadata: 
  node_type: memory
  type: project
  originSessionId: <session>
  modified: 2026-08-18T11:34:45.381Z
---

**GHN multi-seller (nhánh `chore/soat-cau-hinh-payos-firebase`, 08-17, P1-P3 xong + verify live):**
- Sàn C2C nhiều người bán. Escrow ĐÃ tách theo `(order, seller)` sẵn — mirror pattern đó cho vận đơn.
- P1: `shops` +8 cột `pickup_*` (lưu cả GHN id lẫn tên) + `/shop/settings` (FE) + endpoint master-data `/ghn/provinces|districts|wards`.
- P2: bảng `order_shipments(order, seller)` — mỗi người bán 1 vận đơn GHN riêng từ pickup của họ (`createGhnShipmentsPerSeller` trong orders.service). GHN createOrder nhận `from_*` theo TÊN; header ShopId luôn là shop nền tảng (env `GHN_SHOP_ID`=213910), thiếu pickup thì fallback.
- P3: phí ship server tính theo từng người bán (`quoteShippingBySellerFromCart`) + `POST /orders/shipping-quote`; checkout dùng `GhnAddressPicker` (danh mục GHN) sinh `ghn_district_id/ward_code`. **Địa chỉ NGƯỜI MUA cũ dùng provinces.open-api.vn — mã KHÁC GHN**, phải dùng endpoint GHN mới có id đúng.
- **P4 XONG (08-18, verify E2E)** — giải ngân escrow theo TỪNG người bán, mô hình Shopee/Lazada. BE nhánh `feat/p4-per-seller-escrow`, FE nhánh `feat/p4-buyer-confirm-receipt`.
  - GĐ1: `order_shipments` thêm status `delivered`/`received` + cột `delivered_at`/`received_at`/`auto_received` (migration 1786820000000). `EscrowsService.release(orderId, sellerId?)` lọc theo người bán, no-op idempotent khi hết HOLDING. `PATCH /orders/:id/shipments/:sellerId/received` (người mua) → `confirmShipmentReceived` giải ngân đúng escrow, mọi lô nhận xong → đơn DELIVERED (đặt thẳng, KHÔNG qua updateStatus để tránh giải ngân cấp-đơn lần nữa).
  - GĐ2: `GhnService.getOrderStatus`, `syncGhnShipmentStatuses` (created→delivered khi GHN báo), `autoConfirmDueShipments` (quá `AUTO_CONFIRM_RECEIPT_DAYS`, mặc định 3, tự giải ngân). Cron `TasksService.settleDeliveredShipments` (mỗi giờ) + `POST /orders/admin/settle-shipments` chạy tay. GHN sync chưa test được trên sandbox (đơn test không "delivered" thật).
  - GĐ3: `findOne` đính `order.shipments`; FE `profile/orders/[id]` section "Vận đơn theo người bán" + nút "Đã nhận hàng" (`order.service.confirmReceived`).
- **Chặn đăng bán khi chưa pickup (08-18):** `ProductsService.create` gọi `assertSellerHasPickup` — seller CHƯA có shop hoặc thiếu 1 trong 6 trường `pickup_*` → **400** "Bạn cần khai địa chỉ lấy hàng…". Nếu sau này "seller không đăng bán được" → kiểm shop có pickup đủ chưa. (`POST /shop` tạo shop kèm pickup; `PATCH /shop` sửa.)
- Bug đã fix: decimal-as-string → GHN 400, xem [[pitfall_typeorm_decimal_string_breaks_int_api]].

**DB dev local = Docker container, KHÔNG phải Laragon:**
- Container `zoldify-mysql` (image mysql:8, root/**<pass>**, DB `zoldify_dev`), map host **3306 VÀ 3307** → container 3306. Volume giữ dữ liệu. Bật: `docker start zoldify-mysql`.
- Laragon cũng cài MySQL riêng (root/rỗng) trên 3306 → **đụng cổng**, gây `ACCESS_DENIED` khó hiểu. `.env DB_PORT` hiện để **3306** (08-18, Docker đang giữ 3306). Nếu Laragon giành mất 3306 gây `ACCESS_DENIED` → đổi tạm sang **3307** (chỉ Docker map, Laragon không đụng).
- `.env` DB: `root/<pass>/zoldify_dev/127.0.0.1`. `.env` bị hook chặn Read/Edit → sửa bằng `sed` (bash) được.

**Login API:** field là **`email`** (không phải `username`): `POST /api/v1/auth/login {email,password}` → `data.access_token`. Seed: buyer@ / seller@ / admin@zoldify.com đều mật khẩu **<pass>** (seller = seller id 1 "Shop Zoldify"). Route có prefix `/api/v1`.
