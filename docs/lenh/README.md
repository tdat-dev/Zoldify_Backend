# `docs/lenh/` — lệnh giao việc cho agent

**Agent đọc file này trước, rồi mở đúng file mà `HIEN-TAI.md` trỏ tới. Không tự chọn.**

---

## Vì sao tách riêng khỏi `docs/bao-cao/`

`docs/bao-cao/` có hơn ba mươi file, lẫn lộn báo cáo nghiệm thu, biên bản soát
xét, kế hoạch và lệnh. Agent mở vào đấy là phải **tự chọn** đọc file nào — mà
tự chọn đúng là chỗ nó hay sai nhất.

Ở đây chỉ có một loại file, và `HIEN-TAI.md` chỉ đúng một việc đang mở.

| Thư mục | Chứa gì | Ai viết |
|---|---|---|
| `docs/lenh/` | việc phải làm, từng bước, có tiêu chí nghiệm thu | người giao |
| `docs/bao-cao/` | việc đã làm, số đo, biên bản soát xét | cả hai |
| `nghiem-thu.md` (gốc repo) | kết quả bảy cổng | **máy**, không phải người |

## Đặt tên

```
NN-<slug-ngan>.md        01-xoa-e2e-va-trang-doi-soat.md
```

`NN` tăng dần, không bao giờ dùng lại. Lệnh cũ **giữ nguyên**, không xoá — chúng
là vết của việc đã giao, và vài lệnh trong đó ghi lại những cái bẫy vẫn còn
nguyên giá trị.

## Quy trình

1. Người giao viết `NN-*.md`, cập nhật `HIEN-TAI.md` trỏ vào nó.
2. Agent làm **đúng thứ tự các bước**, commit từng bước bằng thông điệp viết sẵn.
3. Xong thì chạy **`npm run nghiem-thu`** — một lệnh, nó ghi `nghiem-thu.md`.
4. Nộp: `nghiem-thu.md` + `git log --oneline`. **Không nộp văn xuôi.**

Kết luận trong `nghiem-thu.md` chỉ có ba giá trị: `ĐẠT` · `CHƯA ĐỦ` (có cổng bị
bỏ qua) · `HỎNG`. Chỉ `ĐẠT` mới là xong.

## Đọc trước khi làm lệnh đầu tiên

- `docs/bao-cao/cach-giao-viec-cho-agent.md` — cách làm việc ở repo này, rút từ
  sáu vòng thật
- `CLAUDE.md` — quy trình 6 bước, bánh cóc lint, comment tiếng Việt giải thích
  **VÌ SAO**
- `docs/lenh/huong-dan-va-viec-con-lai-M01.md` phần B — tám quy ước, mỗi quy ước
  kèm lần hỏng đã sinh ra nó
