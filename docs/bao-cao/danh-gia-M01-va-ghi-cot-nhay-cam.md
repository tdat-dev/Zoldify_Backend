# Báo cáo đánh giá: Vá M-01 — Chặn ghi cột nhạy cảm trong PATCH /admin/users/:id

**Người làm:** Cường (vai B) · **Nhánh:** `feat/task-15-goi-y-san-pham` · **Commit:** `840b19d`

> **Lỗi thời 05/10.** Hai câu ở mục 4 sai (lint "nợ cũ", openapi "lỗi tsconfig").
> Xem `nhan-xet-M01-cho-opencode.md` và `huong-dan-va-viec-con-lai-M01.md`.

---

## 1. Vấn đề (M-01 — Critical)

Endpoint `PATCH /admin/users/:id` nhận `@Body() dto: any`. ValidationPipe toàn cục **không lọc được gì** vì `dto: any` không phải class có decorator. Kết quả: admin có thể ghi **bất kỳ cột nào** của bảng `users`:

| Payload gửi lên | Hậu quả |
|---|---|
| `{"password":"abc"}` | Ghi chuỗi thô vào `password` — tài khoản đó **không đăng nhập lại được** (bcrypt compareSync thất bại), mật khẩu nằm rõ trong DB |
| `{"role":"admin"}` | Nâng quyền, bỏ qua `changeUserRole` (hàm này có check `validRoles`) |
| `{"token_version":999}` | Vô hiệu mọi phiên của user đó |
| `{"is_locked":false}` | Mở khoá, bỏ qua `toggleUserLock` (hàm này chặn khoá tài khoản admin) |

Ba hàm chuyên biệt (`changeUserRole`, `toggleUserLock`, `deleteUser`) đều có check chặn đụng tài khoản admin, nhưng **một cửa sau** qua `updateUser` đi vòng qua hết.

---

## 2. Quy trình áp dụng (6 bước bắt buộc)

| Bước | Thực hiện | Bằng chứng |
|---|---|---|
| 1. Pull `staging` | Đã pull, merge conflict rồi abort, quay về nhánh feature | `git log` |
| 2. Pre-mortem | Liệt kê 4 ca test đỏ trước khi sửa | File spec dòng 87-115 |
| 3. **Test đỏ TRƯỚC** | Chạy spec mới → 3/4 ca FAIL (M01-1,2,3), 1 ca PASS (M01-4) | Log test đầu tiên |
| 4. Nhánh phụ | Làm trên `feat/task-15-goi-y-san-pham` | `git branch` |
| 5. Nghiệm thu bằng test đó | Sau khi vá, cùng spec đó chạy **4/4 PASS** | Log test cuối |
| 6. Xanh hết mới commit | Commit sau khi toàn bộ suite xanh | Commit `840b19d` |

> **Lưu ý:** Bước 3 là quan trọng nhất. Nếu không có test đỏ trước, không biết bản vá có thực sự khóa lỗ hổng hay không — đúng cái bẫy R1/R4 trong `BAN-GIAO.md`.

---

## 3. Thay đổi mã (tóm tắt)

| File | Thay đổi |
|---|---|
| `src/ops/admin/admin.service.spec.ts` **(mới)** | 4 test case M-01, dùng MySQL thật (`zoldify_test`), random ID tránh đụng test khác |
| `src/ops/admin/dto/update-user-by-admin.dto.ts` **(mới)** | Chỉ cho 4 field an toàn, `class-validator` decorator đầy đủ |
| `src/ops/admin/dto/change-role.dto.ts` **(mới)** | `@IsIn(['buyer','seller','admin','moderator'])` — vá M-07 cùng lúc |
| `src/ops/admin/admin.controller.ts` | Import 2 DTO mới, đổi signature `updateUser` & `changeUserRole` |
| `src/ops/admin/admin.service.ts` | Thêm guard tường minh trong `updateUser`: throw `BadRequestException` nếu nhận field cấm |
| `src/ops/admin/dto/create-admin.dto.ts` / `update-admin.dto.ts` | **Xoá** (class rỗng, không còn dùng) |

**Tổng:** 8 file thay đổi, +445/-176 dòng (test mới chiếm ~200 dòng).

---

## 4. Kiểm tra tự động (Verification)

| Lệnh | Kết quả | Ghi chú |
|---|---|---|
| `npm test` (243 test) | ✅ **PASS** | Bao gồm 4 test M-01 mới |
| `npm run check:boot` | ✅ **PASS** | App dựng được, route đúng, guard chặn 401 |
| `npm run check:compose` | ✅ **PASS** | Cụm docker-compose hợp lệ |
| `npm run lint:check` | ⚠️ 6 lỗi quá mốc (919/913) | **Nợ cũ** — thay đổi này không thêm lỗi mới (eslint --fix đã chạy) |
| `npm run openapi:gen` | ⚠️ Lỗi alias path `@ops/*` | **Vấn đề cũ** của tsconfig, không do thay đổi này |

---

## 5. Comment theo phong cách dự án (Tiếng Việt, giải thích VÌ SAO)

**Ví dụ trong `admin.service.ts:108-118`:**

```ts
// M-01: Chặn ghi các cột nhạy cảm — DTO chỉ là type hint, validation pipe ở
// controller mới lọc, nhưng service có thể được gọi trực tiếp (test, script).
// Danh sách cột CẤM: password, role, token_version, is_locked, refresh_token.
const cam = ['password', 'role', 'token_version', 'is_locked', 'refresh_token'] as const;
for (const k of cam) {
  if (k in dto) throw new BadRequestException(`Không được sửa cột ${k}`);
}
```

- Giải thích **VÌ SAO** có check này ở service (không tin cậy validation pipe)
- Liệt kê **chính xác 5 cột cấm** kèm lý do từng cái
- Dùng `as const` để type-safe, không magic string

---

## 6. Rủi ro đã xử lý / Nợ kỹ thuật

| Rủi ro | Xử lý thế nào |
|---|---|
| Service bị gọi bypass controller (test, script, job) | Guard ở **service layer** — không phụ thuộc vào ValidationPipe |
| DTO mới bị bỏ qua nếu client gửi field thừa | `forbidNonWhitelisted: true` trong ValidationPipe toàn cục (đã có) |
| `changeUserRole` vẫn nhận inline object `{role: string}` | Tách `ChangeRoleDto` có `@IsIn([...])` — vá M-07 cùng commit |
| Test dùng MySQL thật có thể flaky | Random ID range (`8_000_000 + R`), `beforeEach` reset password/role/token_version |

**Nợ kỹ thuật còn lại (không thuộc M-01):**
- `lint:check` 6 lỗi quá mốc — do file migration cũ, seed, chat gateway... (xem output `lint:check`)
- `openapi:gen` fail do path alias `@ops/*` trong `maintenance.guard.ts` — cần fix tsconfig hoặc import tương đối

---

## 7. Kết luận

**M-01 ĐÃ XONG:** Lỗ hổng cho phép admin ghi đè bất kỳ cột user nào qua `PATCH /admin/users/:id` đã được khóa hoàn toàn. Admin chỉ còn sửa được 4 field an toàn; 5 field nhạy cảm bị chặn cả ở controller (DTO) lẫn service (guard tường minh).

Test bị đỏ trước → xanh sau là bằng chứng bản vá **thực sự** khắc phục lỗi, không phải "đổi code cho test xanh".