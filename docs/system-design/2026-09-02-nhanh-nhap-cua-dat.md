# Nhánh `chore/soat-cau-hinh-payos-firebase` — số liệu cho lần promote staging → production

*Cường soạn 02/09/2026. Mọi con số dưới đây đều kèm lệnh để tự kiểm lại.*

> **Sửa lần 2.** Bản đầu của file này hỏi "10 commit trên nhánh đó còn cần
> không" và "`deploy.yml` trỏ nhánh đó ra production có đúng ý không". **Cả hai
> đều là câu hỏi sai**, vì Đạt đã trả lời từ trước trong tin nhắn:
>
> > *"À lên staging thì em đẩy từ staging lên production thôi"*
>
> Tức nhánh này **đúng là đường production**, được nuôi từ `staging`, và Đạt là
> người promote. 10 commit trên đó là mã đang chạy thật ở `api.zoldify.com`,
> không phải bản nháp. File này giữ lại vì số liệu vẫn dùng được — nhưng dùng
> cho việc khác: **chuẩn bị cho lần promote đó**.

---

## Việc thật sự cần làm

Lần promote `staging` → production **chưa từng xảy ra**: `git merge-base` giữa
hai nhánh vẫn dừng ở **19/08**, nghĩa là chưa một commit nào của `staging` đi
sang. Lần deploy production gần nhất (30/08) là Đạt đẩy mã của chính mình lên
nhánh đó, không phải promote.

Nên khoảng cách **100 commit** là thật. Ba thứ cần biết trước khi promote:

1. **Xung đột: đúng 2 file** — `auth.controller.ts` và `auth.service.ts`. Phía
   `staging` chỉ đổi 5 + 15 dòng ở đó kể từ điểm tách, nên vùng chồng rất hẹp.
2. **Lần promote này sẽ chạy 4 migration index lên DB production thật** —
   `1787100000000` → `1787400000000`. Đây là lần đầu tiên chúng chạm dữ liệu
   thật. Nên diễn tập trên bản sao trước.
3. **Nợ lint**: 562 dòng của nhánh production chưa từng qua cổng lint nào (nhánh
   không có `ci.yml`). Đếm sơ bộ 14 chỗ — 12 dòng nháy đôi, 1 `process["env"]`,
   1 `any`. Mốc bánh cóc là **966**, vượt thì phải dọn trước.

## Bối cảnh cấu hình

`deploy.yml` đang coi nhánh này là nguồn của production:

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

## Gợi ý trình tự khi promote

Theo đúng quy trình 6 bước của nhóm — Đạt chủ động, đây chỉ là số liệu để đỡ
phải đo lại:

1. Gộp `staging` vào `chore/soat-cau-hinh-payos-firebase`.
2. Gỡ 2 xung đột auth — giữ cả hai phía, vùng chồng nhau hẹp.
3. Chạy đủ cổng trên bản đã gộp: `lint:check` · `test` · `build` · `openapi:check`
   · `check:index` · `check:race` · `check:worker` · `check:redis`.
   Nhánh production không có `ci.yml` nên phải chạy tay, hoặc thêm nhánh đó vào
   `on.push.branches` của `ci.yml` trước.
4. **Diễn tập migration trên bản sao DB production trước khi đẩy.** Bốn migration
   index sẽ chạy lần đầu trên dữ liệu thật. `scripts/restore-mysql.sh` (task
   #24/#25) dựng lại được bản sao từ bản backup của `scripts/backup-mysql.sh`.
5. Xanh hết mới push — push là deploy ngay ra `api.zoldify.com`.

**Việc của Cường trong lần đó:** không có, trừ khi Đạt nhờ. Bốn migration index
là của Cường nên nếu bước 4 có gì lạ thì hỏi Cường.

---

## Một ghi chú, không phải đề xuất

Nhánh đó **không có `ci.yml`**, chỉ có `deploy.yml`. Nghĩa là 10 commit vừa rồi
lên `api.zoldify.com` mà không qua lint, test, openapi hay boundaries — `deploy.yml`
chỉ chặn ở `npm run build`, còn `npm run lint` thì `continue-on-error: true`.

Ghi lại ở đây cho đủ sự thật. Đường deploy production là chỗ Đạt quyết, không
phải chỗ Cường tự sửa.
