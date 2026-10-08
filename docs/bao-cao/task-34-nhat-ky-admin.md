# Task #34 — Nhật ký hành động admin

**Vai:** B — Platform · DevOps · Backend nghiệp vụ
**Hạn theo bảng phân công:** 31/08 → 02/09 · **Làm ngày:** 29/09 (trễ 27 ngày)
**Nhánh:** `feat/task-34-nhat-ky-admin` (tách từ `staging`)
**Bài kiểm:** `npm test` (10 ca) + `npm run check:audit` (đầu-cuối)

---

## 0. Một đính chính về phân vai

Trong bản đánh giá tiến độ hôm 28/09 tôi ghi *"#34 rà bảo mật — vai A (Đạt)"*.
**Sai.** Bảng phân công dòng 230 ghi rõ:

> | 34 | Rà bảo mật + đóng băng `openapi.json` v1 | CORS websocket, rate limit, thang lỗi | 31/08 | 02/09 | **B** |

Vai A giữ `src/money/` và phần nghiệp vụ tiền (task #31–33). Rà bảo mật là vai
B. Đã kiểm lại bảng trước khi gõ dòng mã đầu tiên, đúng như `CLAUDE.md` dặn.

---

## 1. Vì sao task này tồn tại, nói bằng route thật

Trước hôm nay, admin có thể:

| Route | Hậu quả |
|---|---|
| `PATCH /admin/users/:id/toggle-lock` | khoá một tài khoản |
| `PATCH /admin/users/:id/role` | nâng một người lên `admin` |
| `DELETE /admin/users/:id` | xoá một người dùng |
| `PATCH /admin/settings` | đổi cấu hình hệ thống |
| `PATCH /admin/withdrawals/:id/approve` | duyệt một lệnh rút tiền |

…và **không để lại một dòng nào ở đâu cả**. Grep toàn bộ `src/` với
`audit_log|admin_log|activity_log`: không có gì.

Nghĩa là khi có chuyện, không ai trả lời được câu đầu tiên mà người ta sẽ hỏi:
**ai làm, lúc nào**. Sổ cái che được phần tiền — `withdrawals.approve` đi qua
`idempotency_key` nên có vết — nhưng `toggleUserLock` và `changeUserRole` thì
không đi qua sổ cái nào.

---

## 2. Pre-mortem (viết trước khi gõ dòng mã đầu tiên)

| # | Rủi ro | Vì sao có thật | Đã chặn bằng |
|---|---|---|---|
| 1 | Rải lời gọi ghi log trong từng service → quên một chỗ | 19 route admin nằm ở **5 controller**, không phải một | interceptor bám theo `AdminGuard`: gắn guard là có nhật ký |
| 2 | Ghi nguyên `body` → bảng nhật ký thành kho rò rỉ | `PATCH /admin/users/:id` nhận `dto: any`, tức nhận mọi field | lọc khoá nhạy cảm ở mọi độ sâu, có ca kiểm riêng |
| 3 | Ghi log hỏng làm **chết luôn** request của admin | bảng mới, máy nào đó chưa chạy migration | fail-open, lỗi ra log máy chủ |
| 4 | Ghi cả `GET` → hành động thật bị chìm | 6/19 route admin là đọc | chỉ ghi POST/PATCH/PUT/DELETE |
| 5 | **Test xanh mà interceptor không được đấu dây** | đúng cái bẫy sinh ra `check:boot` | xem mục 5 |
| 6 | Xoá admin làm mất vết | — | không khoá ngoại; `admin_id` để trần |
| 7 | Sau Caddy, IP ghi vào log là IP proxy | task #6 vừa đặt caddy trước api | `req.ip` + `trust proxy`, giống `swagger-guard.ts:90` |

---

## 3. Đã làm gì

| Thành phần | Vai trò |
|---|---|
| `admin-action-log.entity.ts` | bảng chỉ-ghi-thêm: không `updated_at`, không `deleted_at` |
| `admin-audit.interceptor.ts` | ghi, lọc khoá nhạy cảm, fail-open |
| `admin-audit.service.ts` | đọc, phân trang có trần, lọc theo đúng hai index |
| `GET /admin/audit-logs` | tra từ trang quản trị |
| migration `1788100000000` | tạo bảng + 2 index ghép; `down()` tự chặn khi còn dòng |
| `npm run check:audit` | bài kiểm đầu-cuối, đã nối CI |

### Ba quyết định đáng nói

**Không khoá ngoại tới `users`.** Vết phải sống lâu hơn tài khoản gây ra nó.
`ON DELETE CASCADE` sẽ xoá sạch nhật ký của đúng người vừa bị xoá — mất bằng
chứng đúng lúc cần nhất. `RESTRICT` thì chặn cả thao tác xoá hợp lệ.

**Ghi bằng `tap` SAU khi handler xong, không ghi trước.** Ghi trước thì mọi
request bị 404 hay xung đột cũng để lại một dòng *"admin đã xoá người dùng"* —
nhật ký nói dối theo hướng **buộc tội người vô can**.

**Fail-open, và nói thẳng đánh đổi.** Lỗi ghi log không được ném ra ngoài: admin
phải khoá được một tài khoản lừa đảo kể cả khi bảng nhật ký chưa tồn tại. Mất
vết còn hơn mất quyền quản trị — nhưng lỗi phải hiện trong log máy chủ để không
ai tưởng nhật ký vẫn đang chạy.

---

## 4. Đọc metadata guard ở **cả hai** chỗ

`AdminController` gắn guard ở **cấp lớp**:

```ts
@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
```

còn `users`, `wallets`, `withdrawals.admin`, `settings` gắn trên **đúng một
phương thức**. Chỉ đọc `context.getHandler()` là bỏ lọt cả nhóm đầu; chỉ đọc
`context.getClass()` là bỏ lọt cả nhóm sau. Nên kiểm cả hai.

---

## 5. Bài kiểm chuyển được đỏ → xanh

| Lúc | Kết quả |
|---|---|
| trước khi có entity + interceptor | **ĐỎ** (không nạp được module) |
| sau khi cài đặt, **chưa** đấu dây vào `AppModule` | 5 ca xanh, **ca 5 đỏ** |
| sau khi đấu dây | **6/6 xanh** |
| bài kiểm phần đọc, trước khi có service | **ĐỎ** → sau: **4/4 xanh** |

### Vì sao có thêm `check:audit` khi đã có spec

Spec jest dựng `ExecutionContext` **giả** rồi gọi thẳng interceptor. Nó chứng
minh interceptor làm đúng việc của nó, nhưng **không** chứng minh một request
admin thật đi qua nó. Ca số 5 chỉ đọc chuỗi `AdminAuditInterceptor` trong
`app.module.ts` — đủ bắt lỗi *"quên đấu dây"*, không đủ bắt lỗi *"đấu dây rồi
nhưng đọc metadata guard sai nên không route nào khớp"*.

`check:audit` không có chỗ nào giả: dựng app thật, tạo user `role=admin` thật,
ký token thật, gọi route thật qua HTTP, rồi đếm dòng trong database.

```
GET  /api/v1/admin/stats     -> 200 · KHÔNG sinh dòng nào     ✓
PATCH /api/v1/admin/settings -> 200 · đúng 1 dòng             ✓
  admin_id đúng · method PATCH · path /api/v1/admin/settings
  action admin.settings · ip ::ffff:127.0.0.1
```

Đây đúng khoảng trống mà `docs/BAN-GIAO.md` mục 7 kể về `check:boot`.

---

## 6. Nghiệm thu

| Cổng | Kết quả |
|---|---|
| `npm test` | **117/117 xanh, 18 suite** (thêm 10 ca so với 107) |
| `npm run check:audit` | TẤT CẢ PASS ✓ |
| `npm run check:boot` | TẤT CẢ PASS ✓ |
| `npm run check:ci` | TẤT CẢ PASS ✓ |
| `npm run build` | xanh |
| `npm run lint:check` | **965** / mốc 965 — giảm 1, đã hạ bánh cóc |
| `npm run boundaries:check` | 28 / mốc 28 |
| `npm run openapi:check` | 99 route · 63 schema (thêm `/admin/audit-logs`) |
| migration `up` trên lược đồ thật | xanh, bảng 12 cột + 2 index |

### Một chuyện suýt báo cáo nhầm

Lần chạy `npm test` đầu tiên ra **48 đỏ**, và tôi suýt ghi *"staging có 48 test
đỏ"* thành một phát hiện. Đo kỹ thì nguyên nhân là:

```
Cannot drop index 'idx_seller_status_created': needed in a foreign key constraint
```

`idx_seller_status_created` do `bd156de` thêm ở nhánh `fix/luong-mua-ban`. Lúc
tôi chạy test trên nhánh đó, `synchronize: true` đã tạo index ấy trong
`zoldify_test`; sang `staging` (không có index đó trong entity) synchronize đòi
xoá, MySQL từ chối vì khoá ngoại đang cần. **Database test bị nhiễm từ chính
lần chạy trước của tôi**, không phải lỗi của `staging`.

Dựng lại `zoldify_test` → **113/113 xanh**. Bài học cho cả nhóm: một
`zoldify_test` dùng chung giữa các nhánh có lược đồ khác nhau sẽ nói dối, và nó
nói dối theo hướng làm mình nghi oan nhánh chung.

---

## 7. Còn lại

1. **Chưa có trang admin để xem nhật ký.** API đã có (`GET /admin/audit-logs`,
   lọc theo `admin_id` / `target_type` / `target_id`); phần giao diện thuộc
   `Zoldify_Admin`, vai C/D.
2. **Chưa có chính sách giữ bao lâu.** Bảng này chỉ ghi thêm nên sẽ lớn dần.
   Chưa cần lo ở quy mô đồ án, nhưng nên có một dòng trong báo cáo nói rõ đây là
   nợ đã biết, kèm điều kiện gỡ: khi bảng vượt ~1 triệu dòng thì cắt theo tháng.
3. **Hai mục còn lại của task #34 đã xong từ trước**: Swagger `/api/docs` nay có
   guard (`src/core/swagger-guard.ts`, production trả 404 với request ở xa), và
   `openapi.json` được `openapi:check` gác trong CI.
