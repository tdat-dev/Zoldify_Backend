# Báo cáo Epic 3 (phần 2) — Audit index toàn hệ + Bộ tự kiểm

**Người thực hiện:** Cường · **Ngày:** 2026-08-21 · **Nhánh:** `feat/epic-3-index-audit` → PR vào `staging`

## 1. Bối cảnh
Epic 3 phần 1 đã chặn `limit` cho mọi list. Còn nợ: **audit index** cho các list nặng.
Thay vì "đọc bằng mắt", tôi viết **bài test chạy được** (`red → green`): test đỏ ở đúng
chỗ thiếu index = kết quả audit; thêm migration cho xanh; chạy lại chứng minh đã sửa.

## 2. Cách audit (test trước, không tin cảm tính)
`scripts/selfcheck-indexes.ts` — với mỗi mẫu truy cập `WHERE khoá + ORDER BY created_at`:
- **Chốt phán xét = cấu trúc index**, KHÔNG phải EXPLAIN. Lý do: seed hiện rải ~1 dòng/khoá
  nên filesort chỉ sắp 1 dòng → **EXPLAIN cho "xanh giả"**. Câu hỏi đúng là *"có index ghép
  `(khoá, created_at)` để ORDER BY khỏi filesort dù khoá có bao nhiêu dòng không?"* — trả lời
  từ `information_schema`, độc lập phân bố dữ liệu.
- Kèm 2 **control** kỳ vọng xanh sẵn (orders keyset + orders theo user) để chứng minh test
  biết phân biệt, không phải lúc nào cũng đỏ.

## 3. Kết quả audit (lần chạy ĐỎ)
| List (nơi trong code) | Index cần | EXPLAIN trước |
|---|---|---|
| `notifications.findAll` | (user_id, created_at) | `type=ref` + **Using filesort** |
| `interactions.findByProduct` (reviews) | (product_id, created_at) | `type=ref` + **Using filesort** |
| `chat.getMessages` (messages) | (conversation_id, created_at) | `type=ref` + **Using filesort** |
| `interactions.findAll` (reviews, admin) | (created_at) | **`type=ALL` quét 496.906 dòng** + filesort |

## 4. Sửa — migration `1787100000000-AddListOrderingIndexes`
Thêm 4 index ghép (phong cách `CREATE INDEX` thô + `.catch` idempotent như
`AddPerformanceIndexes`). Chạy trên DB 1M mất ~33s.

## 5. Kết quả sau migration (lần chạy XANH — bằng chứng)
| List | EXPLAIN sau |
|---|---|
| notifications | `type=ref key=idx_user_created` — **hết filesort** |
| reviews theo product | `type=ref key=idx_product_created` — **hết filesort** |
| messages | `type=ref key=idx_conversation_created` — **hết filesort** |
| reviews admin | `type=index key=idx_created_at rows=20` — **hết quét toàn bảng** |

`selfcheck-indexes.ts` → **TẤT CẢ PASS**. `tsc --noEmit` → 0 lỗi.

## 6. Bộ tự kiểm kèm theo (để nhóm tự tin, không tin lời)
- `scripts/selfcheck.ts` — Epic 0/1/2: 0 mồ côi/34 FK, ledger cân, chặn limit, keyset
  đi không sót/không trùng (so OFFSET trên 1M). Chạy: `node -r ts-node/register -r tsconfig-paths/register scripts/selfcheck.ts`
- `scripts/selfcheck-indexes.ts` — Epic 3 phần 2 (file này). Cùng cách chạy.
- Cả hai **chỉ đọc DB**, in PASS/FAIL, thoát mã ≠0 nếu có FAIL (cắm CI được).

## 7. Còn nợ (ngoài phạm vi PR này)
- Index 1-cột cũ (`idx_product_id` reviews, `idx_conversation_id` messages) nay là prefix con
  của index ghép mới → **có thể dọn** để tiết kiệm ghi/dung lượng. Giữ lại trong PR này cho an
  toàn; đề xuất dọn ở PR riêng sau khi rà không luồng nào phụ thuộc.
- Lớp 2 smoke test API (HTTP thật) cho chặn limit — cần server + token.
- Epic 4 (1000 user: pool + cache) — đo lại 1000 VU sau tối ưu.
