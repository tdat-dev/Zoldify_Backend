# Nhánh `chore/soat-cau-hinh-payos-firebase` — hai câu hỏi cho Đạt

*Cường soạn 02/09/2026. Mọi con số dưới đây đều kèm lệnh để tự kiểm lại.*

---

## Hai câu hỏi

### 1. Mười commit trên nhánh đó còn cần không?

Nhánh đang giữ **10 commit · 562 dòng · 18 file**, và chúng **chỉ tồn tại ở đúng
một chỗ này** — chưa từng có PR nào mở từ nhánh. Xoá nhánh là mất, gồm **2
migration** và **một bảng mới** (`push_tokens`).

- **Còn cần** → mình mở PR vào `staging`, gỡ 2 xung đột, chạy đủ cổng. Xong mới xoá.
- **Không cần** → xoá được, nhưng đọc câu 2 trước đã.

### 2. `deploy.yml` đang trỏ nhánh đó ra `api.zoldify.com` — có đúng ý không?

Cường nói đây là nhánh Đạt ngồi test, chưa xoá. Nhưng cấu hình đang coi nó là
nguồn của production:

```yaml
# .github/workflows/deploy.yml (trên staging), dòng 5-6 — chú thích trong file:
#   - nhánh chore/soat-cau-hinh-payos-firebase  -> PRODUCTION (api.zoldify.com)
#   - nhánh staging                             -> STAGING   (api-staging.zoldify.com)

on:
  push:
    branches:
      - chore/soat-cau-hinh-payos-firebase
      - staging
```

Và script SSH: nhánh nào **không phải** `staging` thì vào `/opt/zoldify-backend`,
project `zoldify` — tức thư mục production.

Nó **đã chạy thật**, không phải cấu hình chết:

```
2026-08-30 10:10   Deploy Backend   completed/success   5640e799
2026-08-30 10:06   Deploy Backend   completed/success   cce0964e
2026-08-30 06:53   Deploy Backend   completed/success   928ff485
```

`api.zoldify.com` hiện trả **200**.

> ⚠️ **Nếu xoá nhánh mà chưa sửa `deploy.yml`**, file sẽ trỏ vào một nhánh không
> tồn tại. Nên sửa `on.push.branches` **trước**, xoá nhánh **sau**.

---

## Số liệu

| | | Lệnh tự kiểm |
|---|---|---|
| Tách khỏi `staging` | 19/08 | `git merge-base origin/staging origin/chore/soat-cau-hinh-payos-firebase` |
| Commit cuối | 30/08, tdatdev | `git log -1 origin/chore/soat-cau-hinh-payos-firebase` |
| `staging` đi trước | **100 commit** | `git rev-list --count origin/chore/...ase..origin/staging` |
| Nhánh đó đi trước | **10 commit** | `git rev-list --count origin/staging..origin/chore/...ase` |
| Quy mô | 18 file · +562 −30 | `git diff --shortstat $(git merge-base ...) origin/chore/...ase` |
| Xung đột nếu gộp | **2 file** | `git merge-tree --write-tree origin/staging origin/chore/...ase \| grep CONFLICT` |
| PR từ nhánh | **không có** | `gh pr list --head chore/...ase --state all` |
| Workflow trên nhánh | **chỉ `deploy.yml`** | `git ls-tree -r --name-only origin/chore/...ase -- .github/workflows/` |

Hai file xung đột là `src/identity/auth/auth.controller.ts` và
`src/identity/auth/auth.service.ts`. Phía `staging` chỉ đổi **5 + 15 dòng** ở hai
file đó kể từ điểm tách, nên vùng chồng nhau rất hẹp.

Nhân tiện: **`main` không phải nhánh production.** Nó đứng im từ 18/08, sau
`staging` 105 commit, và không đi trước commit nào. Không có gì deploy từ `main`.

---

## Cái gì thật sự là duy nhất ở nhánh đó

Đã đối chiếu **từng thứ** với `staging` chứ không suy đoán:

| Việc | `staging` đã có? | Kết luận |
|---|---|---|
| `POST` + `DELETE /notifications/push-token`, đẩy FCM | không có gì | **mới hoàn toàn** |
| Bảng `push_tokens` + `push-token.entity.ts` | không | **mới hoàn toàn** |
| `ghn_province_id / district_id / ward_code` cho `addresses` | không có trong `addresses` | **mới hoàn toàn** |
| Lọc sản phẩm theo `condition` ở `findAll` | có **cột**, không có **bộ lọc** | **mới** (phần lọc) |
| `PATCH /orders/:id/sim-ghn` — giả lập GHN sandbox | không | **mới** |
| Đặt mật khẩu cho tài khoản Google + email cảnh báo + throttle 3/phút | route `change-password` có sẵn, phần này không | **mới** (đổi trong route cũ) |
| `GET /auth/profile` trả hồ sơ đầy đủ từ DB; `PATCH /auth/profile` nhận `avatar`/`phone_number`/`gender` | route có sẵn, nội dung khác | **mới** (đổi hành vi) |

Tức là **không có mục nào đã được làm lại ở `staging`**. Nếu xoá nhánh, cả bảy
mục trên biến mất.

### Không giẫm chân việc của Cường

- `PATCH /orders/:id/sim-ghn` (giả lập GHN) và `POST /orders/ghn-webhook`
  (task #26) là **hai thứ khác nhau**, nằm khác vùng trong `orders.service.ts`.
  `merge-tree` báo file đó gộp sạch.
- Migration của Đạt đánh số `1787660000000` và `1787670000000`, chạy **sau** bốn
  migration index của Cường (`1787100000000` → `1787400000000`). Không đụng thứ
  tự, và cũng khác bảng: bên Đạt là `addresses` + bảng mới `push_tokens`; bên
  Cường là `notifications`, `reviews`, `messages`, `withdrawals`, `payments`,
  `wallet_transactions`, `conversations`.

---

## Nếu Đạt nói CÒN CẦN

Các bước, theo đúng quy trình 6 bước của nhóm:

1. Mở PR từ `chore/soat-cau-hinh-payos-firebase` vào `staging`.
2. Gỡ 2 xung đột auth — giữ cả hai phía, vùng chồng nhau hẹp.
3. Chạy đủ cổng trên bản đã gộp: `lint:check` · `test` · `build` · `openapi:check`
   · `check:index` · `check:race` · `check:worker` · `check:redis`.
4. Xanh thì gộp, rồi mới xoá nhánh.

**Chi phí ước tính:** 562 dòng đó **chưa từng qua cổng lint nào** (nhánh không có
`ci.yml`). Đếm sơ bộ: **12 dòng dùng nháy đôi** (repo dùng nháy đơn), **1 chỗ**
`process["env"]["GHN_HOST"]`, **1 chỗ** `any`. Prettier tự sửa được phần lớn.
Mốc bánh cóc hiện tại là **966**, nên nếu vượt thì phải dọn trước khi gộp.

## Nếu Đạt nói KHÔNG CẦN

Sửa `on.push.branches` trong `deploy.yml` **trước**, xoá nhánh **sau** — nếu
không, đường deploy production sẽ trỏ vào nhánh không tồn tại.

---

## Một ghi chú, không phải đề xuất

Nhánh đó **không có `ci.yml`**, chỉ có `deploy.yml`. Nghĩa là 10 commit vừa rồi
lên `api.zoldify.com` mà không qua lint, test, openapi hay boundaries — `deploy.yml`
chỉ chặn ở `npm run build`, còn `npm run lint` thì `continue-on-error: true`.

Ghi lại ở đây cho đủ sự thật. Đường deploy production là chỗ Đạt quyết, không
phải chỗ Cường tự sửa.
