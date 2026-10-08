# Bản đồ hoà nhánh — `origin/staging` vào nhánh vai B

**Viết:** vai B (Cường) · **Ngày:** 06/10/2026 · **Nền:** `20c632b`
**Trạng thái:** đã thử nghiệm trên bản sao, **chưa chạm repo thật**

---

## Tóm tắt: việc này nhỏ hơn tôi tưởng rất nhiều

Hôm qua tôi báo "không còn gốc chung, phải hoà tay 266 file". **Câu đó sai.**

Đo lại hôm nay:

```
10 file xung đột · 47 file git tự hoà · 21 khối phải quyết
```

Lý do: gốc chung **không mất**. Lịch sử cục bộ bị xoá, nhưng commit
`2562975` (`docs: add system design class diagram drawio file`, 21/09) — điểm
ta tách nhánh — **vẫn còn trong kho object**, vì nó là tổ tiên của
`origin/staging` mà ta đã fetch lại.

```
git cat-file -t 2562975                              → commit
git merge-base --is-ancestor 2562975 origin/staging  → CÓ
```

Thứ mất là **chuỗi commit nối** từ đó tới nay, không phải bản thân gốc.

---

## Cách nối lại: `git replace --graft`

```bash
git replace --graft 088acb9 2562975
```

Gắn `2562975` làm cha của commit phẳng `088acb9`. Lệnh này **không viết lại gì** —
nó tạo một ref thay thế, và gỡ được bằng `git replace -d`.

Đo trên bản sao:

| | Trước | Sau |
|---|---|---|
| `git merge-base HEAD origin/staging` | rỗng | `2562975` |
| `git merge origin/staging` | không làm được | 10 xung đột, 47 tự hoà |

**Nó không khôi phục lịch sử.** 22 commit từ 21/09 tới 05/10 vẫn mất. Nó chỉ
khôi phục **khả năng hoà** — và đó là thứ đang chặn đường.

**Giới hạn phải biết:** ref thay thế là **cục bộ**. Người khác clone về sẽ vẫn
thấy hai dòng lịch sử rời nhau. Nhưng commit hoà sinh ra có hai cha thật
(HEAD + origin/staging), nên **kết quả thì chia sẻ được bình thường** — chỉ
phần "nhìn lại lịch sử trước 05/10" là riêng máy này.

---

## 266 file, chia ba nhóm

| Nhóm | Số file | Xử lý |
|---|---|---|
| Chỉ **ta** đổi | 222 | giữ bản ta — Đạt không chạm |
| Chỉ **Đạt** đổi | 23 | nhận nguyên bản Đạt |
| **Cả hai** đổi | 24 | git tự hoà được 14, còn **10 file phải quyết tay** |

### 23 file chỉ Đạt đổi — ta nhận nguyên, đây là thứ ta được thêm

Đáng chú ý: 9 file spec mới (`account-lock`, `escrows-access`,
`ghn-fee-shipment` 403 dòng, `seller-orders` 222 dòng, `payments-update`,
`push-token-owner`, `address-is-default`, `profile-has-password`,
`register-role`), 2 migration (`AddGhnIdsToAddresses`, `CreatePushTokens`),
2 script sao lưu (`backup-db.sh`, `offsite-backup.sh`), và `push-token.entity.ts`.

Nghĩa là sau khi hoà, **số bài kiểm tăng đáng kể** mà ta không phải viết dòng nào.

---

## 10 file xung đột — 21 khối

| File | Khối | Ai soát |
|---|---|---|
| `docker-compose.yml` | 5 | vai B |
| `src/money/escrows/escrows.service.ts` | 4 | **Đạt** |
| `src/money/payments/payments.service.ts` | 3 | **Đạt** |
| `src/money/escrows/escrows.controller.ts` | 2 | **Đạt** |
| `src/ordering/orders/orders.service.ts` | 2 | **Đạt** |
| `src/catalog/products/products.service.ts` | 1 | vai B |
| `src/identity/addresses/entities/address.entity.ts` | 1 | vai B |
| `src/identity/auth/dto/auth.entity.ts` | 1 | vai B |
| `src/identity/users/users.service.ts` | 1 | vai B |
| `src/messaging/chat/chat.gateway.ts` | 1 | vai B |

**11 khối thuộc vai A**, 10 khối thuộc vai B.

---

## Đặc điểm quan trọng nhất: hai bên cùng vá MỘT lỗ, theo hai cách

Đọc các khối trong mã tiền thì thấy rõ. Ví dụ `escrows.service.ts` khối 1:

```
<<<<<<< HEAD (ta)
import { User } from '@identity/users/entities/user.entity';
import { normalizePagination } from '@common/dto/pagination.dto';
=======  (Đạt)
import { User, UserRole } from '@identity/users/entities/user.entity';
const SAFE_PARTY = { id: true, full_name: true, avatar: true } as const;
   // "trước 28/09 ba route này lộ email, số điện thoại của mọi người mua
   //  lẫn người bán (audit B-03)"
>>>>>>>
```

Cùng một lỗ lộ dữ liệu ký quỹ. **Ta** thêm kiểm quyền ở service
(`chiAdmin`, `adminHoacChinhChu`). **Đạt** giới hạn cột trả ra (`SAFE_PARTY`).

Hai thứ đó **bổ sung cho nhau**, không thay thế nhau:
- chỉ có của ta → đúng người xem, nhưng xem được cả email/điện thoại của bên kia
- chỉ có của Đạt → cột an toàn, nhưng ai đăng nhập cũng xem được của người khác

> **Luật cho 21 khối này: GỘP, đừng chọn bên.** Chỉ chọn bên khi hai bên sửa
> đúng cùng một dòng theo hai cách loại trừ nhau — và lúc đó phải **đọc hàm**,
> không đếm dòng.
>
> Tôi đã sai đúng chỗ này một lần: khuyên "payments ưu tiên bản Đạt" vì đếm
> +13 so với +78, trong khi Đạt sửa `update()` còn tôi sửa `create()`. Lấy bản
> của anh ấy là xoá mất bản vá, người bán không nhận được tiền từ đơn trả bằng ví.

---

## Hai cái bẫy đã biết

**1. `openapi.json` bị git tự hoà — bản đó là rác.**
Nó nằm trong 47 file "tự hoà", nhưng đây là file **sinh ra**. Một bản hoà dòng
của hai lược đồ JSON không tương ứng với bất kỳ mã nào. Sau khi hoà xong phải
`npm run openapi:gen && git add openapi.json`, đừng tin bản git ghép.

**2. `docker-compose.yml` có 5 khối, nhiều nhất.**
Ta thêm caddy + api×3 + `mem_limit` (task #6), Đạt thêm phần sao lưu R2. Cũng là
dạng bổ sung nhau. Sau khi gộp phải chạy `npm run check:compose` — cổng đó gác
đúng hình dạng cụm.

---

## Quy trình thực thi, khi OpenCode xong

```bash
# 0. Cây phải sạch, và đẩy nhánh an toàn trước
git status --short
git push origin master:feat/vai-b-20261006

# 1. Nối tổ tiên
git replace --graft 088acb9 2562975
git merge-base HEAD origin/staging        # phải ra 2562975

# 2. Hoà, KHÔNG commit vội
git merge --no-commit --no-ff origin/staging

# 3. Gỡ 10 khối vai B trước (10 khối), rồi gửi Đạt 11 khối mã tiền
git diff --name-only --diff-filter=U

# 4. Sinh lại thứ không được hoà bằng tay
npm run openapi:gen && git add openapi.json

# 5. Nghiệm thu bằng máy
npm run nghiem-thu                        # phải ra ĐẠT
```

**Chỉ commit bản hoà khi `nghiem-thu.md` ghi `ĐẠT`.** Trước đó dừng được bằng
`git merge --abort`, không mất gì.

---

## Điều tôi CHƯA biết, nói rõ để không ai tưởng đã xong

- **Bản hoà chưa build thử.** Thử nghiệm chạy trên bản sao không có
  `node_modules`, nên tôi mới chứng minh được "git hoà được", chưa chứng minh
  "hoà xong thì chạy được". 21 khối gộp xong có thể sinh lỗi kiểu hoặc lỗi
  logic — đó là lý do bước 5 bắt buộc.
- **Chưa đọc hết 21 khối.** Mới đọc kỹ 2 khối ở `escrows.service.ts` và
  `payments.service.ts` đủ để nhận ra dạng "cùng vá một lỗ". 19 khối còn lại
  phải đọc từng cái lúc gỡ.
- **47 file "git tự hoà" chưa ai nhìn.** Git hoà được không có nghĩa là hoà
  đúng — nó chỉ có nghĩa là hai bên không sửa cùng dòng. Sau bước 5, nếu cổng
  xanh thì tạm tin; nhưng `openapi.json` là bằng chứng rằng "tự hoà" không
  đồng nghĩa với "đúng".

---

# ⚠ PHÁT HIỆN KHI ĐỌC KHỐI XUNG ĐỘT: nhánh ta đang có lỗ NÂNG QUYỀN

Đọc khối ở `src/identity/users/users.service.ts` thì thấy bản ta giữ `role`
trong destructure còn bản Đạt bỏ nó. Lần theo thì ra một lỗ thật.

## Chuỗi gọi, đã kiểm từng mắt

```
POST /api/v1/auth/register              @Public(), không guard
  → AuthController.handleRegister(@Body() RegisterUserDto)   auth.controller.ts:101
  → AuthService.register(dto)                                auth.service.ts:160
  → UsersService.register(dto)                               users.service.ts:87
      const { ..., role } = registerUserDto;                 ← lấy role từ body
      this.userRepository.create({ ..., role })              ← ghi thẳng
```

Và DTO **cho phép** trường đó qua `ValidationPipe`:

```ts
// src/identity/users/dto/create-user.dto.ts:28-30
@IsOptional()
@IsEnum(UserRole, { message: 'Email không hợp lệ' })
role?: UserRole;
```

`whitelist: true` chỉ loại trường **không có decorator**. `role` có decorator,
nên nó được giữ.

**Kết quả:** `POST /api/v1/auth/register {"email":…,"password":…,"role":"admin"}`
tạo thẳng một tài khoản admin. Không cần token, không cần gì.

Đường đăng ký qua OTP (`verifyRegisterOtp`, `auth.service.ts:144`) **không**
dính — nó gọi `register()` với đúng ba trường và không truyền `role`.

## Mức độ thật

| | |
|---|---|
| `api-staging.zoldify.com` | **KHÔNG dính** — chạy từ `origin/staging`, nơi Đạt đã vá (audit B-01) |
| Nhánh `feat/vai-b-20261006` vừa đẩy | **DÍNH** |
| Sau khi hoà | **hết**, vì bản Đạt thắng ở khối này |

## Đây là ngoại lệ của luật "GỘP, đừng chọn bên"

Bản Đạt phải thắng **trọn vẹn** ở khối này, không gộp:

```ts
// Đạt — users.service.ts
const { full_name, email, password, phone_number } = registerUserDto;  // KHÔNG có role
this.userRepository.create({
  ...,
  // Gán cứng, không đọc từ tham số: lớp chặn thứ hai cho B-01
  role: UserRole.BUYER,
});
```

Và `create-user.dto.ts` phải **bỏ** trường `role` khỏi `RegisterUserDto`.
Đạt có sẵn `register-role.spec.ts` gác cả hai lớp: DTO từ chối `role` (400 ở
ValidationPipe), và service luôn lưu `BUYER` kể cả bị gọi kèm `role` khác.

> **Đây là khối nguy hiểm nhất trong cả 21 khối.** Bản ta "nhiều dòng hơn" và
> trông như bản mới hơn, nên người gỡ xung đột rất dễ chọn "keep ours" — và
> chọn thế là mở lại lỗ. Khi gỡ tới `users.service.ts` và `create-user.dto.ts`,
> **lấy bản Đạt, đừng đọc số dòng.**

## Bốn khối vai B còn lại — đã quyết trước

| File | Quyết |
|---|---|
| `products.service.ts` | **gộp** — ta lọc `status = ACTIVE` ở nhánh tìm kiếm, Đạt thêm lọc `condition`. Hai việc khác nhau, giữ cả hai |
| `address.entity.ts` | **lấy Đạt** — bản anh ấy có 3 cột GHN *và* transformer tinyint cho `is_default` (vá H-04: không ai sửa được địa chỉ). Bản ta chỉ có `@Column boolean`. Ta không mất gì |
| `auth.entity.ts` | **giữ ta** — ta thêm `RefreshTokenDto`, Đạt không đụng chỗ đó |
| `chat.gateway.ts` | **lấy Đạt rồi bù phần ta** — Đạt thêm kiểm `token_version` và tài khoản bị khoá lúc nối socket (audit B-04), mạnh hơn hẳn. Giữ phần `client.data.user` của ta nếu Đạt bỏ |
