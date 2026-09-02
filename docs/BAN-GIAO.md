# Bàn giao — cách làm việc, môi trường, và việc còn lại

*Viết 02/09/2026, ngay trước khi Cường cài lại máy sang Linux.*

Toàn bộ ngữ cảnh của phiên làm việc trước nằm ngoài repo và **sẽ mất**. File này
là thứ duy nhất mang nó theo. Đọc file này trước khi làm gì tiếp.

---

## 1. Quy trình bắt buộc — 6 bước

Áp cho **mọi** việc, kể cả việc nhỏ:

1. **Pull** `staging` mới nhất.
2. **Pre-mortem** — liệt kê rủi ro thành bảng trước khi gõ dòng mã đầu tiên.
3. **Viết bài kiểm TRƯỚC**, chạy nó, **xác nhận nó ĐỎ**. Bài kiểm không thể đỏ
   thì không dùng để nghiệm thu được.
4. Làm trên **nhánh phụ** tách từ `staging`, không commit thẳng.
5. **Nghiệm thu bằng chính bài kiểm đó.**
6. Xanh hết mới gộp.

> Chuyện đã xảy ra vì bỏ bước 3: bài kiểm đua R1/R4 lúc đầu **chép lại trình tự
> SQL** thay vì gọi `OrdersService`. Nó chứng minh được lỗi có thật, nhưng sửa mã
> xong nó vẫn đỏ y nguyên — vì đang đo bản chép. Phải viết lại nó trước khi sửa
> được task #2.

## 2. Commit nhỏ từng bước

Sửa một lỗi → một commit. Không gom khối lớn.

Chia theo bước tự nhiên: bài kiểm đỏ là một commit, mỗi script một commit, mỗi
bản vá tìm ra lúc nghiệm thu một commit riêng.

> Vì sao: `git log` phải kể được **thứ tự suy nghĩ**. Một commit 967 dòng thì
> mất đúng phần đáng giá — "test đỏ trước, script sau, rồi vá một lỗi tìm ra lúc
> đo". Commit nhỏ mới revert đúng một thứ và `git bisect` mới có nghĩa.

Nếu một commit sắp vượt ~100 dòng hoặc chạm nhiều mối quan tâm → tách trước.

## 3. Phong cách comment

Tiếng Việt, giải thích **VÌ SAO**, không phải **CÁI GÌ**. Khi một dòng tồn tại
để chặn một lỗi cụ thể, **kể lại chính cái bẫy đó** kèm số đo.

Mẫu tốt để bắt chước:
- `src/common/request-id.middleware.ts` — bảng 4 con số đo tải, và hai lần đoán sai
- `src/catalog/sitemap/sitemap.service.ts` — vì sao chia lô theo id chứ không OFFSET
- `src/catalog/products/products.service.ts` — vì sao dùng khoá "đời" cho cache
- `src/common/cache.config.ts` — dual-package hazard, kể nguyên vẹn

Nói thẳng khi có nợ kỹ thuật, kèm **điều kiện gỡ nó**.

## 4. Nhóm và phạm vi

| | Ai | Việc |
|---|---|---|
| **A** | Đặng Tiến Đạt (`tdatdev`) | Trưởng nhóm · Money · Bảo mật |
| **B** | Cường (`LMCuong2K1`) | Platform · DevOps · Backend nghiệp vụ |
| C/D | Nguyễn Huy (`nguyenhuy140923`), `anday06` | Mobile · Web · QA |

Bảng phân công: `docs/system-design/2026-08-08-phan-cong-4-nguoi.md`.
Chọn việc theo **HẠN**, không theo mức độ dễ.

## 5. Cảnh báo: review từ agent khác

Antigravity CLI để lại review ở `review_for_claude.md` (untracked, **không đẩy
lên**). Bản 25/08 **sai khoảng một nửa**: cả 3 đường dẫn file đều sai (`src/products/`
thay vì `src/catalog/products/`), giao một việc đã hoàn thành từ trước, và khẳng
định sai về một import chết.

Nó *nghe* rất đúng — thuật ngữ chuẩn, lập luận trôi chảy. Dấu hiệu: nó dựng từ
quét tên file, không phải từ đọc mã.

**Luôn mở file kiểm từng luận điểm và dẫn số dòng trước khi nhận việc.**

---

## 6. Dựng lại môi trường trên máy mới

```bash
git clone https://github.com/tdat-dev/Zoldify_Backend.git
cd Zoldify_Backend
PUPPETEER_SKIP_DOWNLOAD=true npm ci     # puppeteer hay hỏng, bỏ qua tải Chrome

# MySQL + Redis cho test (cổng 3307/6380 để không đụng dịch vụ sẵn có)
docker run -d --name zoldify-test-mysql -p 3307:3306 \
  -e MYSQL_ROOT_PASSWORD=testpw -e MYSQL_DATABASE=zoldify_test mysql:8
docker run -d --name zoldify-test-redis -p 6380:6379 redis:7

export DB_HOST=127.0.0.1 DB_PORT=3307 DB_USERNAME=root DB_PASSWORD=testpw
export TEST_DB_HOST=127.0.0.1 TEST_DB_PORT=3307 TEST_DB_USER=root \
       TEST_DB_PASSWORD=testpw TEST_DB_NAME=zoldify_test
export TEST_REDIS_URL=redis://127.0.0.1:6380
```

### Bốn database, mỗi cái một việc

| Tên | Dùng để | Dựng bằng |
|---|---|---|
| `zoldify_test` | `npm test` (jest tự dựng bảng) | tự động |
| `zoldify_schema` | `check:index`, `check:race`, `check:boot` | migration |
| `zoldify_sqlaudit` | `sql:audit`, `loadtest` | migration + `seed` + `seed:products` + `seed:orders` + `sql:audit:seed` |
| `zoldify_bulk_test` | suite **Epic 0/1/2** (đòi ≥500k đơn) | migration + `seed` + `seed:bulk` (~2 phút) |

```bash
# ví dụ dựng zoldify_schema
docker exec zoldify-test-mysql mysql -uroot -ptestpw \
  -e "CREATE DATABASE zoldify_schema CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
npm run build
DB_DATABASE=zoldify_schema node ./node_modules/typeorm/cli.js migration:run -d dist/data-source.js
```

> **Bẫy đã dính:** chạy `npm run check` mà trỏ vào DB rỗng thì suite Epic 0/1/2
> báo đỏ — **không phải lỗi mã**, nó đòi ≥500.000 đơn theo đề bài. Và `check:race`
> **xoá sạch bảng** để dựng kịch bản, nên chạy `npm run check` lần hai trên
> `zoldify_bulk_test` sẽ đỏ; phải `seed:bulk` lại.

## 7. Các cổng kiểm

```
npm test              98 bài, 15 suite, chạy trên MySQL thật
npm run check         chạy TẤT CẢ suite tự kiểm (9 suite)
npm run check:boot    app dựng được không, route đúng chỗ không   ← quan trọng
npm run check:race    20 người bấm cùng lúc; DA_BIET_HONG phải TRỐNG
npm run check:index   mọi list nặng phải có index ghép
npm run lint:check    bánh cóc 966, chỉ được giảm
npm run sql:audit     mỗi file sinh câu SQL nào, câu nào chậm
npm run loadtest      RPS · p95 · event loop lag · bài chèn ngang
npm run log:summary   đọc log JSON ra bảng p50/p95 theo route
```

**`check:boot` sinh ra vì hai lần dính cùng một lỗi:** test xanh, build sạch, mà
app không dựng nổi. Test đơn vị tự `new Service(...)` nên không đi qua bộ tiêm
phụ thuộc lẫn bộ định tuyến. `test/app.e2e-spec.ts` có dựng app thật nhưng **CI
chưa bao giờ gọi `npm run test:e2e`** — một cái chốt không chạy thì không phải
là chốt.

## 8. Tài liệu đã sinh từ đo đạc

| File | Nội dung |
|---|---|
| `docs/system-design/sql-audit.md` | 114 câu SQL, mỗi câu truy về `file:dòng`, kèm EXPLAIN |
| `docs/system-design/load-test.md` | RPS, p95, event loop lag, bài chèn ngang |
| `docs/system-design/zoldify-erd.puml` | ERD 25 bảng · 34 khoá ngoại (dán vào PlantText) |
| `docs/system-design/2026-09-02-nhanh-nhap-cua-dat.md` | số liệu cho lần promote staging → production |

---

## 9. Việc còn lại, theo thứ tự

| # | Việc | Ghi chú |
|---|---|---|
| **34** | **Rà bảo mật** — Swagger `/api/docs` đang **công khai không guard** (98 route + 62 schema); đóng băng `openapi` v1; nhật ký hành động admin | **quá hạn 02/09** |
| **6** | Nhiều tiến trình api + `caddy` + `mem_limit` | quá hạn 16/08. CPU bão hoà từ 10 người bấm cùng lúc — đây là thứ duy nhất đẩy trần lên |
| — | Idempotency ở đặt hàng — bấm hai lần tạo hai đơn | tiền thì sổ cái che, đơn thì không |
| — | **0 ràng buộc `CHECK` ở tầng database** | `stock >= 0` mới chỉ có mã bảo vệ |
| — | 7 chỗ CAO + 13 chỗ VỪA trong `sql-audit.md` | OFFSET sâu · `COUNT(*)` mọi trang · `findAndCount` hai bước |
| — | **19/31 module không có bài kiểm nào** — gồm `auth` và `admin` | 98 route / 15 file spec |
| — | `drawio:check` xanh giả — mất 19/20 sơ đồ | commit `839e3df`; khôi phục bằng `node scripts/make-drawio.mjs` **không** `--force` |
| 13 | `CDN_BASE_URL`, bỏ `req.get('host')` | |
| 15 | Gợi ý sản phẩm — **điểm Level 3** | |
| 26b | Tồn kho real-time — **điểm Level 3** | |
| 35 | Trang admin đối soát ledger | |

### Cần Đạt quyết

1. **Promote `staging` → production.** Chưa từng xảy ra — `merge-base` vẫn dừng
   ở 19/08, `staging` đi trước ~130 commit. Xung đột đúng **2 file auth**. Sẽ
   chạy **4 migration index lần đầu trên dữ liệu thật** → diễn tập trên bản sao
   trước (`scripts/restore-mysql.sh`). Chi tiết:
   `docs/system-design/2026-09-02-nhanh-nhap-cua-dat.md`.
2. **ERD thiếu bảng `push_tokens`** — chỉ có trên nhánh production.

### Phần tiền: chỗ chắc nhất, đừng lo

Đã kiểm `withdrawals.reject`, `withdrawals.complete`, `escrows.refund` — cả ba
đi qua `idempotency_key` của sổ cái nên ghi trùng bị **database** từ chối, không
phải mã từ chối. `check:race` R3 chứng minh điều đó bằng 20 lượt ghi đồng thời.
