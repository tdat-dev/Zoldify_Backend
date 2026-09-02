# Zoldify Backend — đọc trước khi làm gì

> **Đọc `docs/BAN-GIAO.md` trước tiên.** File này chỉ nêu những điều bắt buộc;
> ngữ cảnh đầy đủ (dựng lại môi trường, bốn database, việc còn lại, các bẫy đã
> dính) nằm ở đó.

Dự án capstone. Cường (`LMCuong2K1`) là **vai B — Platform · DevOps · Backend
nghiệp vụ**. Trưởng nhóm là **Đặng Tiến Đạt** (`tdatdev`), phụ trách Money và
Bảo mật. Bảng phân công: `docs/system-design/2026-08-08-phan-cong-4-nguoi.md`.

## Quy trình 6 bước — bắt buộc, kể cả việc nhỏ

1. Pull `staging` mới nhất.
2. **Pre-mortem** — liệt kê rủi ro thành bảng trước khi gõ dòng mã đầu tiên.
3. **Viết bài kiểm TRƯỚC, chạy nó, xác nhận nó ĐỎ.**
4. Làm trên **nhánh phụ** tách từ `staging`. Không commit thẳng vào `staging`.
5. Nghiệm thu bằng **chính bài kiểm đó**.
6. Xanh hết mới gộp.

Bước 3 là bước hay bị làm hình thức nhất. Một bài kiểm **không thể chuyển từ đỏ
sang xanh** thì không dùng để nghiệm thu được — chuyện đã xảy ra thật: bài kiểm
đua R1/R4 chép lại trình tự SQL thay vì gọi `OrdersService`, nên sửa mã xong nó
vẫn đỏ y nguyên.

## Commit nhỏ từng bước

Sửa một lỗi → một commit. Bài kiểm đỏ là một commit riêng. Mỗi bản vá tìm ra lúc
nghiệm thu là một commit riêng.

`git log` phải kể được **thứ tự suy nghĩ**. Sắp vượt ~100 dòng hoặc chạm nhiều
mối quan tâm → tách trước khi commit.

## Comment: tiếng Việt, giải thích VÌ SAO

Không phải "cái gì". Khi một dòng tồn tại để chặn một lỗi cụ thể, **kể lại chính
cái bẫy đó kèm số đo**. Nói thẳng khi có nợ kỹ thuật, kèm điều kiện gỡ nó.

Mẫu đáng bắt chước: `src/common/request-id.middleware.ts`,
`src/catalog/sitemap/sitemap.service.ts`, `src/common/cache.config.ts`.

## Đo, đừng đoán

Repo có sẵn công cụ. Dùng chúng trước khi kết luận:

```
npm run check         chạy tất cả suite tự kiểm (9 suite)
npm run check:boot    app dựng được không, route đúng chỗ không
npm run check:race    20 người bấm cùng lúc — DA_BIET_HONG phải TRỐNG
npm run sql:audit     mỗi file sinh câu SQL nào, câu nào chậm
npm run loadtest      RPS · p95 · event loop lag · bài chèn ngang
npm run log:summary   đọc log JSON ra bảng p50/p95 theo route
npm run lint:check    bánh cóc 966, chỉ được giảm
```

Ba lần đã đoán sai và phải đo mới biết — cả ba đều ghi trong mã: chi phí thật
của `AsyncLocalStorage`, thứ đắt nhất trong ghi log, và cache "trượt" mà hoá ra
vẫn trúng. **Đo đúng môi trường**: với Redis khác hẳn không Redis.

## Cẩn thận với review từ agent khác

`review_for_claude.md` (untracked, **không đẩy lên**) do Antigravity CLI để lại.
Bản 25/08 sai khoảng một nửa — sai đường dẫn file, giao việc đã xong, khẳng định
sai về một import chết — nhưng *nghe* rất đúng.

**Mở file kiểm từng luận điểm và dẫn số dòng trước khi nhận việc.**

## Việc thuộc về ai

Chọn việc theo **HẠN**, không theo mức độ dễ. Trước khi đề xuất, kiểm xem nó
thuộc vai B hay vai A — phần tiền (`src/money/`) và bảo mật là của Đạt.
