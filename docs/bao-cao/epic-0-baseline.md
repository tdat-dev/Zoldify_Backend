# Báo cáo Epic 0 — Baseline (chuẩn bị & đo hiện trạng)

**Người thực hiện:** Cường · **Ngày:** 2026-08-20 · **Nhánh:** `feat/seed-bulk-data` → PR #1 (vào `staging`)
**Nhiệm vụ tổng:** Tối ưu DB để hệ thống *load 1 triệu bản ghi (tối thiểu 500k/chức năng)* và *chịu 1000 user đồng thời*.

---

## 1. Vì sao có Epic 0

Không thể tối ưu cái mình chưa đo được. Trước khi sửa bất kỳ dòng nào, cần:
1. **Dữ liệu thật ở quy mô đề bài** (1tr bản ghi) để query nào chậm/sập mới lộ ra.
2. **Công cụ đo tải 1000 user** để có *con số mốc* — Epic sau so sánh mới biết cải thiện được bao nhiêu.

Epic 0 = hai việc đó. Chưa sửa gì cả, chỉ **dựng bàn cân**.

---

## 2. Những bước đã làm

### Task 0.1 — Seed dữ liệu quy mô lớn
- Viết script mới `scripts/seed-bulk.ts` (không đụng 2 script demo cũ của đồng đội).
- **Đã seed đạt & kiểm chứng bằng SQL COUNT:**

  | Bảng | Số dòng thực tế |
  |------|-----------------|
  | orders | **1,000,003** |
  | order_items | 2,000,003 |
  | products | 501,015 |
  | users | 510,003 |
  | reviews / carts / follows / conversations / messages / notifications | 500,000 mỗi bảng |

- Chạy hết **~4.7 phút** trên SSD, RAM gần như phẳng (không nạp bảng cha vào bộ nhớ).
- **Cố ý KHÔNG seed nhóm bảng tiền** (ledger/wallets/escrows): sổ cái kép có bất biến
  `SUM(ledger_entries.amount) = 0`; bơm dữ liệu giả vào là phá sổ sách. Đã kiểm lại: **ledger vẫn = 0**.

### Task 0.2 — Harness đo tải 1000 user
- Viết `load-test/baseline.js` bằng **k6** + lệnh `npm run loadtest`.
- Kịch bản: tăng dần 0 → **1000 VU**, giữ 1 phút; mỗi VU gọi `GET /products` (30% kèm tìm kiếm) + `GET /orders`.

---

## 3. Đã THẤY gì — kết quả baseline (1000 VU)

> **Hệ thống SẬP ở 1000 user đồng thời.**

| Chỉ số | Giá trị |
|--------|---------|
| **Tỉ lệ request lỗi/timeout** | **99.55%** (48,093 / 48,309) |
| Request thành công | 0.44% |
| p95 của request *thành công* | **33 giây** (max ~60s) |
| Nguyên nhân | 1 tiến trình Node + pool 50 kết nối → bão hoà, gần như mọi request timeout sau 60s |

**Điểm cần lưu ý khi đọc số (đã ghi rõ trong `load-test/BASELINE.md`):**
- Từ khoá tìm kiếm `q=San pham` khớp gần như toàn bộ 500k product (do seed đặt tên giống nhau) → kéo `/products` chậm bất thường. Epic sau sẽ dùng từ khoá chọn lọc hơn.
- `/orders` **chưa lộ hết bug**: user test chỉ có 3 đơn nên chưa thấy lỗi "nạp hết bảng". Epic 1 sẽ đo lại bằng user nhiều đơn.
- Đây là máy dev 1 tiến trình — production sẽ nhiều instance + Redis. Nhưng vẫn là **mốc hợp lệ để đo mức cải thiện tương đối** qua từng Epic.

---

## 4. Những QUYẾT ĐỊNH đã đưa ra

| Quyết định | Lý do |
|-----------|-------|
| Viết **script seed mới** thay vì sửa 2 script demo cũ | Script cũ chèn từng dòng + gói 1 transaction → không mở rộng nổi tới cỡ triệu. Giữ nguyên để khỏi phá việc đồng đội. |
| Chèn **hàng loạt** (multi-row INSERT), commit theo lô 50k, tắt tạm FK/unique check | Nhanh gấp nhiều lần, không phình undo log, không nghẽn lock. |
| **Không seed bảng tiền** | Giữ bất biến sổ cái kép; đây cũng không phải đường đọc bị nghẽn khi tải. |
| Dùng **k6** cho harness | Chuẩn công nghiệp, kịch bản ramp-up + ngưỡng pass/fail rõ ràng, chạy 1 lệnh. |
| **Chưa sửa code tối ưu** ở Epic 0 | Phải có mốc đo trước, nếu không thì không chứng minh được Epic sau có tác dụng. |

---

## 5. Kết luận & việc tiếp theo

- ✅ Epic 0 hoàn tất: **có dữ liệu 1tr + có mốc đo**. Con số để đời: **99.55% lỗi @ 1000 VU**.
- 🎯 Mục tiêu các Epic tối ưu (1→3): kéo tỉ lệ lỗi **99.55% → dưới 1%**, p95 `/products` & `/orders` **về dưới ~500ms**.
- ➡️ **Epic 1 (đang bắt đầu):** sửa `orders.service.ts` `findAll` — hiện nạp *toàn bộ* đơn hàng vào RAM và đếm `total` sai (over-count qua JOIN order_items). Sẽ đo baseline riêng cho `/orders` bằng user nhiều đơn, sửa, rồi đo lại để so sánh.

**Cách chạy lại để kiểm chứng:**
```bash
npm run loadtest                                              # 1000 VU
k6 run -e VUS=200 -e RAMP=5s -e HOLD=10s load-test/baseline.js  # thử nhẹ
```
