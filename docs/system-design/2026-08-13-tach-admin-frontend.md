# Tách khu quản trị thành `Zoldify_Admin`

> **Trạng thái:** đã chốt hướng, **chưa thực hiện.** Tài liệu này để giao việc.
> **Ngày:** 13/08/2026 · **Quyết định bởi:** chủ dự án
>
> Đọc mục 6 nếu bạn là người được giao việc. Mục 1-5 giải thích vì sao.

---

## 1. Hiện trạng, và cái gì thật sự sai

Khu quản trị hôm nay là bảy trang trong repo `Zoldify_Frontend`:

```
src/app/admin/          page.tsx · orders · products · categories · users · settings · withdrawals
src/app/admin/layout.tsx
src/components/admin/AdminNav.tsx
```

`admin/layout.tsx` chỉ làm hai việc: chặn người không phải admin, và chèn thêm
`<AdminNav />`. Nó **nằm lồng bên trong root layout**, nên toàn bộ vỏ của trang
bán hàng vẫn còn nguyên phía trên.

Hậu quả nhìn thấy được: một admin đang duyệt lệnh rút 14 triệu đồng vẫn thấy ô
tìm kiếm *"Tìm đồ cũ: máy tính, xe đạp…"*, nút **Đăng bán**, và một **giỏ hàng**
trên đầu màn hình. Không sai chức năng, nhưng không ra dáng một khu quản trị,
và mục *UI Design* ở Chương III sẽ bị hỏi đúng chỗ đó.

Hậu quả không nhìn thấy được, và nặng hơn: **mã quản trị đang được gửi tới trình
duyệt của khách.** Next.js chia bundle theo route nên khách không tải trang admin
về, nhưng toàn bộ mã đó vẫn nằm trong cùng một bản build, cùng một deploy, cùng
một tên miền. Bề mặt tấn công và bề mặt sự cố lớn hơn mức cần thiết.

## 2. Quyết định

Tách thành một **repo riêng: `Zoldify_Admin`** — một ứng dụng Next.js độc lập,
build riêng, deploy riêng, tên miền riêng.

Khớp đúng lệ sẵn có của dự án: `Zoldify_Backend`, `Zoldify_Frontend`,
`Zoldify_Mobile` đều là repo tách. Thêm cái thứ tư không phá vỡ mô hình nào, và
dấu vết Git của người làm khu quản trị trở nên rõ ràng — điều này được chấm.

**Đã cân nhắc và loại:**

| Phương án | Vì sao loại |
|---|---|
| Route group `(shop)` / `(admin)` trong cùng repo | Sửa được cái vỏ, nhưng vẫn một bản build, một deploy, một tên miền. Không giải quyết chuyện mã quản trị nằm chung với mã khách |
| Monorepo `apps/shop` + `apps/admin` + `packages/shared` | Không nhân bản code, sạch nhất về kỹ thuật. Nhưng phải dựng hạ tầng monorepo giữa lúc còn 5 tuần, và hai người làm hai app sẽ đụng nhau khi merge |
| Repo riêng **cộng** một gói `shared` phát hành riêng | Thêm một thứ phải đánh version và phát hành. Chi phí không đáng với quy mô này |

## 3. Ba hệ quả phải biết trước, không phải phát hiện lúc deploy

### 3.1. Admin sẽ phải đăng nhập riêng

Token đăng nhập lưu trong `localStorage`/`sessionStorage`, mà hai kho này **tách
theo origin**. `admin.zoldify.com` và `zoldify.com` là hai origin khác nhau, nên
phiên đăng nhập **không dùng chung được**.

Một người vừa bán hàng vừa làm admin sẽ phải đăng nhập hai lần, ở hai nơi.

Đây không phải lỗi, và cũng không nên "sửa": chia sẻ token qua cookie
`.zoldify.com` sẽ kéo cả hai app vào chung một phạm vi cookie, tức là bỏ đi phần
lớn lý do tách. Chấp nhận đăng nhập hai lần, và ghi vào tài liệu hướng dẫn.

### 3.2. Thêm một thứ phải deploy, có tên miền và SSL

Hiện đang có: web bán hàng, API, app di động. Thêm app quản trị là **cái thứ tư**.

Đề xuất: **`admin.zoldify.com`**, cùng chứng chỉ wildcard hoặc một chứng chỉ
riêng do Caddy tự xin. Caddy đã được chọn chính vì việc này rẻ.

**Rủi ro thật, nói thẳng:** deploy hiện đang ở 0%, iOS chưa khởi động, và hạn
bảo vệ là 15/09. Tách admin làm tăng số thứ phải lên sóng từ ba thành bốn. Nếu
tới tuần cuối mà chưa kịp, **phương án lùi** là deploy `Zoldify_Admin` dưới
đường dẫn phụ của cùng một máy chủ thay vì tên miền riêng — vẫn tách repo, tách
build, chỉ không tách tên miền. Ghi sẵn ở đây để lúc đó không phải nghĩ.

### 3.3. Một số mã sẽ tồn tại hai bản

Đây là cái giá của repo riêng. Xử lý ở mục 5.

## 4. Cái gì chuyển đi, cái gì ở lại

Quét từ mã thật ngày 13/08/2026.

### Chuyển hẳn sang `Zoldify_Admin` (xoá khỏi `Zoldify_Frontend`)

| Thứ | Ghi chú |
|---|---|
| `src/app/admin/**` | Bảy trang, thành `src/app/**` của repo mới |
| `src/app/admin/layout.tsx` | Thành root layout, **bỏ hẳn Header/Footer của trang bán hàng** |
| `src/components/admin/AdminNav.tsx` | Thành điều hướng chính |
| `src/components/StockControl.tsx` | Kiểm lại: nếu trang bán hàng cũng dùng thì để lại cả hai |
| Khoá i18n `admin.*` | ~120 khoá, chỉ khu quản trị dùng |
| Khoá i18n `adminWithdrawals.*` | 41 khoá |

### Phải có ở cả hai repo

Đây là danh sách chính xác, quét từ `import` của khu quản trị:

| Thứ | Vì sao cả hai cần |
|---|---|
| `lib/http.ts` | Cả hai gọi cùng một API |
| `lib/session.ts` | Đọc/ghi token |
| `lib/config.ts` | `API_URL` |
| `lib/format.ts` | `formatPrice`, `imageUrl` |
| `lib/status-tone.ts` | Bảng màu trạng thái dùng chung |
| `lib/order-status.ts` | Trang bán hàng dùng cho đơn của người mua, admin dùng cho bảng đơn |
| `lib/withdrawal-status.ts` | Trang ví dùng, admin dùng |
| `lib/product-status.ts` | Cả hai |
| `context/AuthContext.tsx` | Cả hai cần biết ai đang đăng nhập |
| `components/Toast.tsx` · `BackButton.tsx` · `EmptyState.tsx` | Nguyên thuỷ, cả hai dùng |
| `services/*.service.ts` | admin dùng 6 cái: category, order, product, setting, upload, withdrawal |
| `api/schema.d.ts` | **Sinh tự động, không phải nhân bản** — xem 5.1 |
| `tailwind.config.ts` · `globals.css` | Token màu, chữ, bo góc, z-index |
| Khoá i18n `common.*` · `orderStatus.*` · `withdrawalStatus.*` · `productStatus.*` | Cả hai |

### Ở lại `Zoldify_Frontend`, không đụng tới

Toàn bộ 28 trang còn lại: trang chủ, tìm kiếm, danh mục, chi tiết tin, giỏ,
thanh toán, ví, đơn mua, đơn bán, chat, thông báo, hồ sơ, địa chỉ, đăng bán.

## 5. Chống hai bản trôi khỏi nhau

Repo này đã bị đúng lỗi đó nhiều lần: bộ trạng thái đơn từng có **bốn bản**, và
bản ở trang quản trị thiếu hai giá trị nên admin không chuyển đơn sang hai trạng
thái đó được. Tách repo mà không có biện pháp thì lỗi đó quay lại, chắc chắn.

### 5.1. Thứ sinh tự động thì không nhân bản

`api/schema.d.ts` sinh từ `openapi.json` của backend. Repo mới chạy `gen:api`
của chính nó, trỏ vào cùng file nguồn. Không có bản sao nào để trôi.

### 5.2. Thứ còn lại: một script đồng bộ, cộng một cổng kiểm trong CI

Trong `Zoldify_Admin`:

```
scripts/sync-shared.mjs      # chép danh sách file cố định từ ../Zoldify_Frontend
scripts/check-shared.mjs     # so sánh, khác nhau thì thoát khác 0
```

CI của cả hai repo chạy `check-shared`. Sửa `status-tone.ts` ở một bên mà quên
bên kia thì **CI đỏ ngay**, chứ không phải ba tuần sau mới phát hiện ra hai bảng
màu khác nhau.

Đây là thứ rẻ nhất trong toàn bộ kế hoạch này và cũng là thứ dễ bỏ qua nhất.
**Không được bỏ.**

## 6. Chia việc

Bảy phần, xếp theo thứ tự phụ thuộc. Ước lượng cho một người đã quen repo.

| # | Việc | Phụ thuộc | Ngày công |
|---|---|---|---|
| 1 | Tạo repo `Zoldify_Admin`, dựng khung Next.js, chép `tailwind.config.ts` + `globals.css`, dựng `gen:api` | — | 0,5 |
| 2 | Chép nhóm dùng chung ở mục 4, viết `sync-shared.mjs` và `check-shared.mjs` | 1 | 1 |
| 3 | Chuyển bảy trang admin sang, dựng root layout **không có** Header/Footer bán hàng | 2 | 1 |
| 4 | Tách khoá i18n: chuyển `admin.*` và `adminWithdrawals.*` sang repo mới, chép nhóm dùng chung | 3 | 0,5 |
| 5 | Xoá `src/app/admin/**` và `components/admin/**` khỏi `Zoldify_Frontend`, gỡ khoá i18n đã chuyển, kiểm không còn link chết trỏ vào `/admin` | 3 | 0,5 |
| 6 | CI cho repo mới: lint, build, `check-shared` | 2 | 0,5 |
| 7 | Deploy `admin.zoldify.com`: DNS, Caddy, biến môi trường | 1 · và VPS phải có sẵn | 0,5 |

**Tổng ≈ 4,5 ngày công.**

Việc 1-4 nên **một người làm hết**: chúng chạm cùng một tập file và chia ra chỉ
tạo xung đột merge. Việc 6 và 7 tách được cho người lo hạ tầng.

**Việc 5 phải làm sau cùng và làm dứt điểm.** Để lại `src/app/admin` trong repo
cũ "cho chắc" nghĩa là có hai bản khu quản trị cùng chạy được, và người ta sẽ sửa
nhầm bản chết. Xoá thật, tin vào Git.

### Nghiệm thu

Xong khi tất cả những điều sau đúng:

1. `admin.zoldify.com` mở được, đăng nhập bằng tài khoản admin, làm trọn một
   lệnh rút: duyệt → hoàn tất.
2. Trang quản trị **không còn** ô tìm kiếm, nút Đăng bán, hay giỏ hàng.
3. `zoldify.com/admin` trả 404. Không còn đường nào tới khu quản trị từ trang
   bán hàng.
4. Sửa một giá trị trong `status-tone.ts` ở một repo và không sửa repo kia thì
   CI đỏ.
5. Cả hai app build xanh, `npm run gen:api` ở hai nơi cho ra cùng một file.

## 7. Ảnh hưởng tới tài liệu và sơ đồ

Phải cập nhật khi việc này xong (một số đã cập nhật trước, đánh dấu ✅):

| Nơi | Đổi gì |
|---|---|
| `drawio/r2-container.drawio` | Thêm container thứ tư |
| `drawio/11-deployment-diagram.drawio` | Thêm node app quản trị và tên miền phụ |
| `drawio/r8-cicd-pipeline.drawio` | Thêm nhánh thứ tư |
| `drawio/r7-screen-navigation.drawio` | Tách hai cụm màn hình |
| `docs/product/…-user-flows.md` §1, §8 | Kiểm kê màn hình và ma trận độ phủ |
| `docs/product/…-prd.md` §5 | Bảng phạm vi |
| Báo cáo I — *Deployment Environment* | Bốn thứ triển khai, không phải ba |
| Báo cáo I — *Development Tools* | Thêm `package.json` của repo thứ tư |
| Báo cáo VI — *Install Application* | Thêm bước dựng app quản trị |
| Báo cáo V — *Task Assignment* | Bảy dòng ở mục 6 |

---

## Tóm tắt cho người quyết

Tách được, khoảng **4,5 ngày công**, và nó sửa một thứ đang thật sự sai chứ
không phải làm đẹp. Cái giá là **thêm một thứ thứ tư phải lên sóng** trong lúc
chưa thứ nào lên sóng cả, cộng với việc admin phải đăng nhập riêng.

Nếu lịch căng, phương án lùi ở mục 3.2 giữ lại toàn bộ lợi ích về mã nguồn và
chỉ bỏ phần tên miền riêng.
