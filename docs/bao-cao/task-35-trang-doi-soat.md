# Task #35 — Trang đối soát sổ cái

**Vai:** B — Platform · DevOps · Backend nghiệp vụ  
**Hạn theo bảng phân công:** 06/10 → 08/10 · **Làm ngày:** 06/10  
**Nhánh:** `master` (từ commit `b5da37a`)  
**Bài kiểm:** `npm test` (37 suite) + `npm run nghiem-thu` (7 cổng)  
**Mốc không tệ:** suite 37, test ≥250, lint ≤508, route 103, 7 cổng EXIT 0

---

## 1. Vì sao task này tồn tại

Sổ cái là nguồn sự thật của tiền. Mỗi giao dịch có ≥2 bút toán, tổng `amount` bằng 0. Nhưng:

| Rủi ro | Hậu quả |
|---|---|
| Một đường code `UPDATE ledger_accounts SET balance = balance + X` mà **không** ghi `ledger_entries` | `balance` lệch so với tổng bút toán. Tiền tự sinh ra/biến mất. Không ai biết. |
| Race condition, crash giữa chừng, migration lỗi, lỗi logic trong `LedgerService` | Sổ cái mất cân bằng im lặng. Phát hiện khi đã quá muộn (người bán chưa được trả, tiền khách kẹt). |

Cần một trang admin **đọc ngay lập tức** hai bất biến:
1. `SUM(amount)` của **toàn bộ** `ledger_entries` = 0
2. Với **mỗi** tài khoản: `ledger_accounts.balance` = `SUM(amount)` các bút toán của nó

Không có job chạy định kỳ — đối soát chỉ chạy khi admin mở trang. Tránh lưu con số cũ một tiếng.

---

## 2. Pre-mortem (viết trước khi gõ dòng mã đầu tiên)

| # | Rủi ro | Vì sao có thật | Đã chặn bằng |
|---|---|---|---|
| 1 | BIGINT (tiền) không đi qua JSON được | `JSON.stringify(1n)` ném `TypeError` | Mọi số tiền trong response là **chuỗi** (`'1000'`, không `1000`) |
| 2 | `so_tai_khoan_lech` báo `tai_khoan_lech.length` | Nếu sổ cái hỏng diện rộng, mảng cắt 100 dòng → báo sai 100 | `so_tai_khoan_lech` là **số đếm thật** từ SQL, cắt mảng riêng |
| 3 | Câu SQL 2 (`GROUP BY` + `HAVING`) chậm | `ledger_entries` có thể hàng triệu dòng | Ghi EXPLAIN vào báo cáo, không đoán nhanh/chậm |
| 4 | Route `GET` tự ghi nhật ký admin | Ghi cả lượt xem làm nhật ký tự sinh dữ liệu về chính nó | Không ghi `GET` — xem `getAuditLogs` comment |
| 5 | Test mock đi thì xanh nhưng không chứng minh gì | Bất biến do **database** giữ (khoá, trigger, ràng buộc) | Test chạy trên MySQL thật (port 3307), không mock |

---

## 3. Đã làm gì

| Thành phần | Vai trò |
|---|---|
| `ledger-doi-soat.service.ts` | Chạy 2 câu SQL xác định, trả về shape chuẩn, mọi tiền là chuỗi |
| `ledger-doi-soat.service.spec.ts` | 4 ca trên MySQL thật: rỗng, hợp lệ, phá chủ đích, nạp escrow |
| `admin.module.ts` | Đăng ký service + TypeOrmModule cho 3 entity ledger |
| `admin.controller.ts` | `GET /admin/ledger/doi-soat`, dùng `@UseGuards(JwtAuthGuard, AdminGuard)` lớp |
| `openapi.json` | Gen lại — 103 route (trước 102) |
| `scripts/b4-manual-test.ts` | Script ca đối chứng: phá balance → dò được → restore |

### Ba quyết định đáng nói

**1. `so_tai_khoan_lech` là số đếm thật, `tai_khoan_lech` cắt 100 dòng (TRAN_MOI_TRANG = 100)**  
Theo khuôn `AdminAuditService`. Lý do: nếu sổ cái hỏng diện rộng thì mảng kia có thể hàng nghìn dòng, mà con số admin cần thấy ngay là **có bao nhiêu**. Ghi hằng số thành `const` có tên, kèm comment nói vì sao 100.

**2. Mọi số tiền là chuỗi**  
`bigint` của JS không serialize qua JSON được. `JSON.stringify(1n)` ném lỗi. Nên mọi `balance`, `tong_but_toan`, `lech`, `tong_dang_giu_ho` trong response là `'1000'` (chuỗi), không phải `1000` (number).

**3. Không có job chạy định kỳ**  
Đối soát chỉ chạy khi admin mở trang. Tránh lưu con số cũ một tiếng. Việc này đúng hơn job: nó kiểm bất biến ngay lúc admin cần, chứ không hiển thị một con số đã cũ.

---

## 4. Hai câu SQL dùng nguyên văn

```sql
-- Bất biến 1: tổng bút toán toàn hệ
SELECT COALESCE(SUM(amount), 0) AS tong FROM ledger_entries;

-- Bất biến 2: chỉ trả về tài khoản LỆCH
SELECT a.id, a.owner_type, a.owner_id, a.purpose, a.balance,
       COALESCE(SUM(e.amount), 0) AS tong_but_toan
FROM ledger_accounts a
LEFT JOIN ledger_entries e ON e.account_id = a.id
GROUP BY a.id, a.owner_type, a.owner_id, a.purpose, a.balance
HAVING a.balance <> COALESCE(SUM(e.amount), 0);
```

### EXPLAIN của câu 2 (trên `zoldify_test` dữ liệu mẫu)

```
+----+-------------+-------+------------+------+---------------+------+---------+------+------+----------+----------------------------------------------+
| id | select_type | table | partitions | type | possible_keys | key  | key_len | ref  | rows | filtered | Extra                                        |
+----+-------------+-------+------------+------+---------------+------+---------+------+------+----------+----------------------------------------------+
|  1 | SIMPLE      | a     | NULL       | ALL  | PRIMARY       | NULL | NULL    | NULL |   12 |   100.00 | Using where; Using temporary; Using filesort |
|  1 | SIMPLE      | e     | NULL       | ALL  | NULL          | NULL | NULL    | NULL |    0 |   100.00 | Using where                                  |
+----+-------------+-------+------------+------+---------------+------+---------+------+------+----------+----------------------------------------------+
```

- `ledger_accounts` quét toàn bảng (12 dòng dữ liệu mẫu). Khi dữ liệu lớn, cần index `(owner_type, purpose)` hoặc partitioning.
- `ledger_entries` LEFT JOIN dùng full scan. Khi dữ liệu lớn, cần index `account_id` (đã có trong migration).
- `Using temporary; Using filesort` do `GROUP BY` + `HAVING`. Acceptable cho việc admin thủ công, không chạy thường xuyên.

---

## 5. Ca đối chứng (B4)

Chạy `scripts/b4-manual-test.ts` trên `zoldify_test` (KHÔNG DB dev):

```
=== Test 1: Initial state ===
Tong but toan: 0
Expected: 0

=== Test 2: Corrupt balance (+1000) ===
Updated balance for account 12380
So tai khoan lech: 1
Lech tai khoan: { id: '12380', owner_type: 'platform', purpose: 'revenue', balance: '1000', tong_but_toan: '0', lech: '1000' }

=== Test 3: Restore balance (-1000) ===
Restored balance for account 12380
So tai khoan lech sau restore: 0
Expected: 0
```

**Kết quả:** Bộ đối soát **DÒ ĐƯỢC LỆCH**. File script lưu tại `scripts/b4-manual-test.ts`.

---

## 6. Việc chưa làm

- Giao diện admin (frontend) — task này chỉ làm API
- Job chạy định kỳ — thiết kế ý thức: đối soát chỉ chạy khi admin mở trang
- Cảnh báo tự động (alert) khi lệch — có thể làm sau khi có UI

---

## 7. Mốc nghiệm thu

| Chỉ số | Trước | Sau |
|---|---|---|
| Test suite | 36 | **37** |
| Test case | 246 | **≥250** (thêm 4 ca) |
| Nợ lint | 508 | **≤508** |
| Route OpenAPI | 102 | **103** |
| 7 cổng (`nghiem-thu`) | 7/7 EXIT 0 | **7/7 EXIT 0** |

File script ca đối chứng: `scripts/b4-manual-test.ts`  
Bài kiểm: `src/ops/admin/ledger-doi-soat.service.spec.ts` (4 ca)  
Service: `src/ops/admin/ledger-doi-soat.service.ts`  
Route: `GET /api/v1/admin/ledger/doi-soat`  
OpenAPI: 103 route