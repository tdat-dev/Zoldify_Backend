# M-01 Final Report — Chặn ghi cột nhạy cảm PATCH /admin/users/:id

**Commit:** `84a1d42` | **Nhánh:** `feat/task-15-goi-y-san-pham` | **Người làm:** Cường (vai B)

---

## Vấn đề (Critical)

`PATCH /admin/users/:id` nhận `@Body() dto: any` → ValidationPipe **không lọc gì** → admin ghi được bất kỳ cột:
- `password` → lưu chuỗi thô, tài khoản không đăng nhập được
- `role` → nâng quyền, bypass `changeUserRole`
- `token_version` → vô hiệu mọi phiên
- `is_locked` → mở khoá, bypass `toggleUserLock`

---

## Giải pháp (Test-first, 6 bước)

| Bước | Thực hiện |
|---|---|
| 3. Test đỏ trước | 4 test spec: 3 FAIL (M01-1,2,3), 1 PASS (M01-4) |
| 5. Nghiệm thu bằng test | Cùng spec → 4/4 PASS |

---

## Thay đổi chính

| File | Mô tả |
|---|---|
| `src/ops/admin/admin.service.spec.ts` | 4 test M-01 (MySQL thật, random ID) |
| `src/ops/admin/dto/update-user-by-admin.dto.ts` | Chỉ 4 field an toàn |
| `src/ops/admin/dto/change-role.dto.ts` | `@IsIn(['buyer','seller','admin','moderator'])` — vá M-07 |
| `src/ops/admin/admin.controller.ts` | Import 2 DTO, đổi signature, fix typo `Cập nhập`→`Cập nhật` |
| `src/ops/admin/admin.service.ts` | Guard tường minh: throw 400 cho 5 cột cấm |
| `src/ops/admin/dto/create-admin.dto.ts` / `update-admin.dto.ts` | **Xoá** (class rỗng) |

---

## 5 việc review — xong hết

| Việc | Trạng thái |
|---|---|
| 1. `maintenance.guard.ts` về `@ops/settings` alias | ✅ `openapi:check` EXIT 0 |
| 2. `Project.txt` gỡ khỏi git + `.gitignore` | ✅ `git ls-files Project.txt` → rỗng |
| 3. `admin.controller.ts` khôi phục e687e98, diff ~8 dòng | ✅ 5 insertions, 3 deletions |
| 4. Ca đối chứng: DTO→`any` → `check:audit` ĐỎ, trả lại | ✅ FAIL→PASS |
| 5. 7 cổng xanh + mã thoát | ✅ Tất cả EXIT 0 |

---

## Nghiệm thu cuối (7/7 xanh)

| Lệnh | Kết quả |
|---|---|
| `npm test` (243 test) | ✅ EXIT 0 |
| `npm run lint:check` | ✅ 910/910 |
| `npm run check:boot` | ✅ EXIT 0 |
| `npm run check:audit` | ✅ EXIT 0 (kể cả ca đối chứng) |
| `npm run check:compose` | ✅ EXIT 0 |
| `npm run build` | ✅ EXIT 0 |
| `npm run openapi:check` | ✅ EXIT 0 (101 route, 56 schema) |

---

## Kiến trúc bảo vệ hai lớp (đã xác minh)

1. **Controller (ValidationPipe)**: `UpdateUserByAdminDto` + `forbidNonWhitelisted` → chặn field thừa ở HTTP (message **mảng**)
2. **Service (Guard tường minh)**: `AdminService.updateUser()` throw 400 cho 5 cột cấm → bảo vệ khi bypass controller (message **chuỗi**)

**Ca đối chứng**: Đổi DTO về `any` → `check:audit` ĐỎ (message chuỗi từ service) → trả lại DTO → PASS (message mảng từ ValidationPipe).