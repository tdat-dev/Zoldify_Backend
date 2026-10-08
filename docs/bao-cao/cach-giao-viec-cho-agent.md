# Cách giao việc cho agent khác

**Viết:** vai B (Cường) · **Ngày:** 06/10/2026

Tài liệu này rút ra từ sáu vòng giao việc thật — ba vòng M-01 và ba vòng B5 —
cho một agent chạy model miễn phí. Nó không phải lý thuyết điều phối; mỗi mục
dưới đây sinh ra từ một lần hỏng có số đo.

---

## 1. Sản phẩm giao là `nghiem-thu.md`, không phải văn xuôi

```bash
npm run nghiem-thu
```

Lệnh này chạy bảy cổng, rồi **ghi ra `nghiem-thu.md`**. Người làm không phải là
người viết file đó.

Lý do có nó: cả sáu vòng đều hỏng ở cùng một khâu — chạy lệnh trong cây chưa
commit rồi viết báo cáo theo ý định chứ không theo mã thoát.

| Vòng | Báo cáo ghi | Số thật |
|---|---|---|
| M-01 ×3 | `openapi:check` ✅ EXIT 0 | EXIT 1 cả ba lần |
| B5 vòng 1 | lint ✅ 910/910 | 934, mốc 910 |
| B5 vòng 2 | "243 test, 8/8 suite xanh" | tiến trình jest bị giết; repo có 36 suite |

**Cách đọc file:** đối chiếu dòng `HEAD: <sha>` trong file với `git log -1`. Lệch
nghĩa là file cũ hoặc chép tay.

**Ba trạng thái, không phải hai.** `BỎ QUA` (thiếu Docker/Redis) tách khỏi
`HỎNG`. "Bỏ qua" không phải "đạt" — chỉ khi mọi cổng PASS thì kết luận mới là
`ĐẠT` và mã thoát mới là 0.

---

## 2. Mỗi bước trong lệnh có đúng 5 phần

```
Bước N — <một câu, động từ>
1. Vấn đề        — số đo tôi tự chạy được, không phải nhận xét
2. Mã hiện tại   — dán nguyên văn + số dòng
3. Mã đích       — dán nguyên văn
4. Nghiệm thu    — một lệnh npm, kèm kết quả mong đợi (EXIT=0)
5. Commit        — thông điệp viết sẵn để sao chép
```

Phần 5 là thứ tạo khác biệt lớn nhất: vòng 2 (không có nó) ra **0 commit**, mọi
thứ nằm trong cây làm việc. Vòng 3 (có nó) ra **10 commit** riêng, đúng mẫu.
Cùng model, cùng người.

**Cấm trong lệnh:** "hãy thiết kế", "tự chọn chỗ đặt", "làm cho tốt", "cân
nhắc". Mỗi câu như vậy là một vòng đi-về.

**Và phải cấm tường minh, không chỉ liệt kê.** Bước 9 vòng 3 viết "chạy
`eslint --fix` trên chín file này" — nó chạy toàn repo, định dạng lại 73 file,
trong đó 11 file thuộc `src/money/`. Liệt kê không phải là cấm.

---

## 3. Chia việc theo **loại**, không theo độ khó

Model yếu không phải "làm được ít hơn" — nó **làm tốt việc cơ học, hỏng việc
phán đoán**.

| Giao agent | Giữ lại |
|---|---|
| Chỗ sửa đã biết, cách sửa đã biết | Chẩn đoán: cổng đỏ vì sao |
| Thiếu `import`, đổi `user?` → `user`, xoá file | Biết `cache-manager` v7 bỏ `.store` |
| `eslint --fix`, `openapi:gen`, `git add`, commit | Quyết fail-open hay fail-closed |
| Viết test theo mẫu đã có | `src/money/`, auth, migration |
| Chạy lệnh và dán mã thoát | Comment giải thích **VÌ SAO** |

Ba lỗi nặng nhất của sáu vòng đều ở cột phải, và không spec nào chữa được vì
chúng cần **biết trước** một chuyện về thư viện:

- `cacheManager.store` không còn tồn tại từ cache-manager v5 → `GET /products/:id`
  trả 500 mỗi lần cache miss
- `throw new Error('REDIS_URL is required')` trong constructor → app không dựng nổi
- `on('error')` chỉ bắt sự kiện kết nối, không bắt lệnh bị từ chối → `await incr`
  vẫn ném khi Redis mất

---

## 4. Luôn ra lệnh bằng npm script

Agent hay tự ghép `node node_modules/typescript/bin/tsc --build ...` và
`node ... jest.js`. Chạy tay thì **bỏ qua bánh cóc lint**, bỏ qua cấu hình, và
cho ra con số không so được với cổng. Đó là gốc của "903 errors, threshold 966"
trong một báo cáo — mốc thật là 910, và cổng đếm lỗi **cộng** cảnh báo.

Trong lệnh phải ghi **đúng chuỗi ký tự để sao chép**, và nghiệm thu cuối là
**một lệnh duy nhất**, không phải tám lệnh để nó tự ghép.

---

## 5. Hai vòng, và ngưỡng 10 dòng

- **Vòng 1** agent làm. **Vòng 2** sửa theo lệnh. Còn sai thì việc chuyển về
  tôi, không có vòng 3.
- Việc dưới **~10 dòng** thì làm thẳng, đừng viết lệnh.
  `lenh-sua-B5-vong-3.md` dài 482 dòng để chỉ đạo chừng 15 dòng mã — lúc đó điều
  phối là phí, không phải đòn bẩy.
- Việc **trên 50 dòng, cơ học, lặp lại** (viết test theo mẫu, đổi tên, dọn lint)
  thì agent rẻ hơn nhiều. Đó là chỗ nó có giá trị thật — nó hạ nợ lint từ 934
  xuống 507 trong một lượt.

---

## 6. Bảng "không tự quyết" đặt cuối mỗi lệnh

| Không | Vì sao |
|---|---|
| Nâng `BASELINE` lint | bánh cóc chỉ đi xuống; hạ thì hạ xuống **đúng số đo được** |
| Sửa `.env` | cấu hình máy thật |
| Sửa mã trong `src/money/` hay `src/ordering/` | vai A (Đạt) giữ. Viết bài kiểm thì được |
| `git push` | push `staging` là deploy ngay ra `api-staging.zoldify.com` |
| `rm -rf .git`, `git init` lại, `reset --hard`, `gc --prune` | lịch sử cục bộ đã mất một lần hôm 05/10 và **không phục hồi được** — cả hai bản chụp VSS đều hỏng, và không nhánh nào của ta từng được push |
| Xoá tài liệu cũ | giữ vết, đánh dấu lỗi thời thay vì xoá |
