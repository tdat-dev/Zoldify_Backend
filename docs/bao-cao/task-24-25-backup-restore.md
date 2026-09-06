# Báo cáo Task #24 (backup) + #25 (diễn tập khôi phục)

**Người thực hiện:** Cường · **Ngày:** 2026-08-27 · **Nhánh:** `feat/task-24-25-backup-restore` → PR vào `staging`
**Trạng thái:** XONG — đã diễn tập khôi phục **thật** trên MySQL 8 với schema thật và 5.053 dòng dữ liệu. Số liệu ở mục 6.

## 1. Mục tiêu & bối cảnh

Bảng phân công (`docs/system-design/2026-08-08-phan-cong-4-nguoi.md`) giao vai B hai việc nối nhau:

| # | Nội dung | Hạn |
|---|---|---|
| 24 | Deploy production + SSL + CD, **backup mysqldump hằng ngày** | 27/08 |
| 25 | **Diễn tập khôi phục backup** — *"Backup chưa từng restore thử thì không phải backup"* | 28/08 |

Phần deploy/SSL/CD của #24 đã xong từ trước bằng `.github/workflows/deploy.yml`. Phần
còn thiếu là backup — và nó **chưa từng tồn tại dưới dạng mã**. Chuỗi `mysqldump` trong
repo trước hôm nay xuất hiện đúng **một lần**, ở `scripts/make-drawio.mjs:1562`, bên trong
nhãn của một ô trong sơ đồ deployment:

```
cron on host
daily mysqldump, 14-day retention
```

Tức là sơ đồ đang mô tả một thứ không có thật. Đó cũng là lý do #25 không thể bắt đầu:
chưa có bản backup nào để khôi phục thử.

## 2. Pre-mortem — Rủi ro & lỗi ẩn dự đoán (TRƯỚC khi sửa)

| # | Mức | Rủi ro | Cách chặn | Kết cục |
|---|---|---|---|---|
| R1 | **CAO** | Bản sao nằm **cùng đĩa** với database. VPS hỏng đĩa là mất cả hai. Thiết kế nói đẩy lên R2, nhưng R2 là task #13 **chưa làm**. | Làm backup cục bộ + retention ngay; chừa `BACKUP_OFFSITE_CMD` làm chỗ cắm duy nhất cho #13. | **Vẫn còn nợ** — xem mục 7 |
| R2 | **CAO** | `mysqldump` sai mật khẩu **vẫn tạo file** chỉ có header. Cron chạy 14 đêm, thư mục đầy file trông giống backup, không cái nào dùng được. | Mỗi dump phải tự chứng minh: đủ lớn · có `CREATE TABLE` · có marker `Dump completed`. Không đạt thì **xoá** và thoát ≠0. | Đã chặn; đo được ở mục 6 |
| R3 | **CAO** | **CRLF.** Repo chưa có `.gitattributes`, `core.autocrlf=true`, và **chưa từng có file `.sh` nào**. Script viết từ Windows lên VPS chết với `bad interpreter: /bin/sh^M`. | `.gitattributes` ép `*.sh text eol=lf`; bài test đọc thẳng **blob trong git**, không đọc bản trên đĩa. | Đã chặn; blob thuần LF |
| R4 | **CAO** | **Thiếu bit thực thi.** Git trên Windows không đặt `+x`. Cron gọi `./backup-mysql.sh` → `Permission denied`, nuốt vào log cron. | `git update-index --chmod=+x`; bài test đọc mode trong chỉ mục git, đòi `100755`. | Đã chặn |
| R5 | TB | **Retention xoá nhầm.** Một `find -delete` viết rộng tay, hoặc `BACKUP_DIR` trỏ nhầm, thành lệnh xoá hàng loạt. | `-maxdepth 1` + `-name 'zoldify-*.sql.gz'`; không dùng `rm -rf`. Bài test **chạy thật** trên 20 file giả. | Đã chặn; giữ đúng 14/20 |
| R6 | TB | **Sai cụm.** VPS chạy `-p zoldify` (prod) và `-p zoldify-staging`. Nhắm nhầm thì backup nhầm database mà vẫn báo thành công. | `COMPOSE_PROJECT` qua env, mặc định prod, in tên cụm mỗi lần chạy. | Đã làm |
| R7 | TB | **Dump khoá bảng.** Mặc định `mysqldump` khoá đọc; 1 triệu bản ghi là vài phút sàn đứng hình giữa đêm. | `--single-transaction --quick`. | Đã làm |
| R8 | TB | **Ảnh sản phẩm không nằm trong dump.** Chúng ở volume `product-images`. Khôi phục database xong vẫn mất sạch ảnh hàng. | Ngoài phạm vi #24, nhưng phải **nói ra** thay vì để người đọc tưởng đã an toàn. | Ghi ở mục 7 |
| R9 | THẤP | **Diễn tập giả.** Restore đè lên chính database đang chạy để "thử" là tự gây sự cố, đúng lúc đang cố chứng minh mình an toàn. | Mặc định restore vào `zoldify_restore_drill`; đè database thật phải gõ `--force`. | Đã chặn; đo ở mục 6 |
| **R10** | **CAO** | **Phát hiện thêm trong lúc viết bài test.** Một bản dump production chứa email thật, hash mật khẩu và toàn bộ sổ cái tiền. `.gitignore` **không nhắc gì tới backup** — một lần `git add .` là nó nằm vĩnh viễn trong lịch sử repo. | `.gitignore` chặn `/backups/` **và** `*.sql.gz` (hai hàng rào); bài test kiểm không có dump nào đang bị git theo dõi. | Đã chặn |

## 3. Test viết TRƯỚC (đỏ → xanh)

`scripts/selfcheck-backup.ts` · `npm run check:backup` · 23 mục kiểm, **không cần MySQL,
không cần Docker**.

Chạy lần đầu khi chưa có script nào — **đỏ**, đúng như phải thế:

```
✗ FAIL  scripts/backup-mysql.sh CHƯA tồn tại
✗ FAIL  scripts/restore-mysql.sh CHƯA tồn tại
═══ ĐỎ — chưa có script backup/khôi phục. Đây là trạng thái ĐÚNG trước khi làm. ═══
```

Bài test chia làm hai loại kiểm, và ranh giới giữa chúng là chỗ đáng nói nhất:

- **Đọc file** cho những gì đọc được: cờ `--single-transaction`, cờ `-T`, chốt `--force`.
- **Chạy thật** cho phần dọn file cũ. Xoá nhầm là loại rủi ro không được phép suy ra từ
  việc đọc mã. Bài test dựng 20 file giả tuổi 0–19 ngày, thêm một file **không phải**
  backup, chạy `backup-mysql.sh --prune-only` trên thư mục đó, rồi đếm lại.

### Ba lần bài test tự sai — và vì sao không sửa script cho vừa bài test

Lần chạy sau khi viết xong script báo **3 FAIL**. Kiểm lại thì cả ba đều là lỗi của
**bài test**:

1. **"CÓ file dump nằm trong git"** — nó liệt kê 30 file `.sql` dưới `docs/php/database/`.
   Đó là schema và seed thời PHP, commit có chủ đích, không phải dump production. Kiểm
   quét `*.sql` là **quá rộng**; thu về đúng thứ script này sinh ra (`backups/`,
   `*.sql.gz`). Một cổng kêu vào ngày bình thường sẽ bị bỏ qua vào ngày bất thường.
2. **"script có `rm -rf` trần"** — script **không** có. Chuỗi ấy nằm trong chính câu
   comment *"Không dùng `rm -rf` ở đây"*. Bài test đọc lời cảnh báo rồi tưởng là hành vi.
   Sửa: kiểm **hành vi** thì đọc bản đã bỏ hết comment, kiểm **tài liệu** (hướng dẫn cron)
   thì đọc bản đầy đủ. Chiều ngược lại nguy hiểm hơn — một comment nhắc
   `--single-transaction` sẽ làm bài test **xanh giả** dù lệnh thật không có cờ ấy.
3. **"giữ SAI: còn 4, đáng lẽ 14"** — tên file giả đặt theo `i % 10`, nên 20 vòng lặp chỉ
   tạo ra **10 tên trùng nhau**, cái sau ghi đè cái trước và mang theo mtime cũ hơn. Phần
   prune thực ra chạy **đúng**. Suýt nữa thì đi sửa một thứ không hỏng: dữ liệu dựng sai
   thì kết luận sai, dù phép đo có đúng.

## 4. Đã làm

| File | Việc |
|---|---|
| `scripts/backup-mysql.sh` | **mới** — dump → tự kiểm → nén → dọn bản cũ. Mode `100755`, LF thuần |
| `scripts/restore-mysql.sh` | **mới** — kiểm toàn vẹn → restore vào DB diễn tập → **đếm `COUNT(*)` từng bảng** và đối chiếu bản gốc |
| `scripts/selfcheck-backup.ts` | **mới** — 23 mục, bài test ở mục 3 |
| `.gitattributes` | **mới** — `*.sh text eol=lf` (R3) |
| `.gitignore` | thêm `/backups/` và `*.sql.gz` (R10) |
| `package.json` | thêm `check:backup` |
| `scripts/selfcheck-all.ts` | thêm suite backup vào `npm run check` |

**Không đụng:** `deploy.yml`, `docker-compose.yml`, `eslint.config.mjs`, và bất kỳ file nào
trong `src/`.

### Vì sao đối chiếu bằng `COUNT(*)` chứ không bằng `information_schema`

Cách nhanh là đọc `information_schema.TABLE_ROWS`. Với InnoDB đó là số **ước lượng**, lệch
vài chục phần trăm là bình thường. Một cuộc diễn tập khôi phục đối chiếu bằng số ước lượng
thì không chứng minh được gì — nó chỉ chứng minh câu lệnh chạy xong mà không báo lỗi, mà
đó chính là kiểu bằng chứng task #25 sinh ra để bác bỏ. `COUNT(*)` chậm hơn nhưng đúng.

## 5. Kết quả 6 cổng CI (chạy cục bộ)

| Cổng | Kết quả |
|---|---|
| `lint:check` | ✅ nợ lint không tăng (mốc 980) |
| `boundaries:check` | ✅ 28/28 |
| `build` | ✅ |
| `openapi:check` | ✅ 95 route · 62 schema, không lệch |
| `npm test` | ✅ **8 suite / 52 test** trên MySQL 8 |
| `drawio:check` | ✅ |
| `check:ci` · `check:backup` | ✅ · ✅ **23/23** |

## 6. Nghiệm thu thật — cuộc diễn tập khôi phục (#25)

Không dựng container "cho giống". Dùng **chính `docker-compose.yml` của dự án**, cụm
`zoldify-drill`, chỉ thêm một file override cục bộ mở cổng 3310 để chạy migration từ host.

**Dựng:** 14 migration TypeORM thật → schema thật, 26 bảng. Đổ dữ liệu bằng chính bộ seed
của dự án: 1.003 đơn · 2.015 sản phẩm · 1.988 dòng đơn hàng · sổ cái tiền có ký quỹ và
giải ngân. Tổng **5.053 dòng**.

**Backup:**

```
[backup] cụm=zoldify-drill database=zoldify
[backup] dump hợp lệ: 1.523.806 byte
[backup] đã nén: 132.743 byte
[backup] BỎ QUA đẩy offsite (BACKUP_OFFSITE_CMD trống) — bản sao vẫn nằm cùng đĩa với database
[backup] xong. Đang giữ 1 bản
```

**Khôi phục và đối chiếu:**

```
[restore] kiểm toàn vẹn ... file nguyên vẹn
[restore] cụm=zoldify-drill đích=zoldify_restore_drill
[restore] nạp xong
[restore] ── đối chiếu với database gốc (zoldify) ──
[restore] KHỚP TUYỆT ĐỐI — mọi bảng cùng số dòng. Bản backup khôi phục được thật.
```

Cả 26 bảng khớp từng con số. Đây là câu trả lời cho task #25.

### Bốn đường hỏng, đo bằng mã thoát

Một chốt an toàn chưa từng thấy nó chặn thì chưa phải chốt an toàn. Cron dựa vào **mã
thoát**, nên đo mã thoát chứ không đọc dòng log:

| Tình huống | Mã thoát | Kết quả |
|---|---|---|
| Restore đè database đang chạy, không `--force` | **4** | Từ chối |
| File `.gz` bị cắt giữa chừng | **3** | Bắt được bằng CRC |
| `.gz` hợp lệ nhưng nội dung không phải dump | **3** | Bắt được bằng marker `Dump completed` |
| Backup trỏ vào cụm không tồn tại | **1** | Báo lỗi |

### Bước đo ấy tìm ra một lỗi thật trong script

Trường hợp cuối thoát mã 1 đúng như mong đợi — **nhưng thư mục backup mọc thêm một file
`.sql` 0 byte.** Đúng thứ script này sinh ra để chống.

Nguyên nhân: `>"$SQL"` tạo file ngay lúc shell dựng chuyển hướng, **trước khi** `mysqldump`
chạy một byte nào. Dump hỏng thì `set -e` giết script ngay tại dòng đó — chưa bao giờ tới
được đoạn kiểm-và-xoá bên dưới. Sửa bằng `trap don_dep EXIT`, thứ dọn được **mọi** đường
thoát. Sau khi sửa, đường hỏng để lại thư mục sạch, đường thành công vẫn ra file `.gz`.

Kiểm `trap EXIT` đã được **thêm vào bài test sau khi lỗi xảy ra**, để nó không quay lại.

Đáng ghi lại: bài test đọc-file 23 mục **không** bắt được lỗi này. Chỉ có chạy thật và đo
mã thoát mới bắt được. Nếu dừng ở "bài test xanh là xong" thì lỗi đã lên VPS.

## 7. Giới hạn (nói thẳng)

- **Bản sao vẫn nằm cùng đĩa với database.** Đây là giới hạn lớn nhất và chưa gỡ được:
  đẩy offsite lên R2 cần credential của task #13, chưa làm. Chỗ cắm đã chừa sẵn
  (`BACKUP_OFFSITE_CMD`), và mỗi lần chạy script **in ra một dòng nói rõ** là chưa đẩy —
  không để ai đọc log rồi tưởng đã an toàn. **VPS hỏng đĩa lúc này là mất cả hai bản.**
- **Ảnh sản phẩm không có trong backup.** Chúng nằm ở volume `product-images`, không nằm
  trong MySQL. Khôi phục database xong, mọi ảnh hàng của người bán vẫn mất. Nằm ngoài
  phạm vi #24 nhưng cần một việc riêng.
- **Cuộc diễn tập chạy trên máy cá nhân, chưa chạy trên VPS.** Schema thật, dữ liệu thật,
  Docker thật — nhưng chưa ai gắn cron lên VPS và chưa ai xem nó tự chạy qua một đêm.
  Việc còn lại là hai dòng `crontab -e` ghi sẵn ở đầu `backup-mysql.sh`, và **phải có
  người có quyền SSH làm**.
- **Chưa có giám sát.** Cron hỏng thì im lặng. Nên có một cảnh báo khi thư mục backup
  không có file mới quá 24 giờ — chưa làm.
- Bài test không cần Docker, nên nó **không** kiểm được `mysqldump` chạy đúng. Phần đó chỉ
  cuộc diễn tập ở mục 6 trả lời được, và nó phải được chạy lại thủ công sau này.

## 8. Ghi chú cho trưởng nhóm

- **Sơ đồ deployment đang mô tả nhiều thứ chưa có thật.** Ô `cron on host / daily mysqldump`
  giờ đã đúng. Nhưng cùng sơ đồ đó (`make-drawio.mjs`) còn ghi `caddy:2`,
  `zoldify-worker x1 BullMQ + cron`, `zoldify-api x3`, `mem_limit` — trong khi
  `docker-compose.yml` hiện chỉ có `mysql · redis · migrate · api`, **không có** caddy,
  worker, hay `mem_limit` nào. Đó là task #6 và #14, chưa làm.
- **`npm run seed` đang hỏng.** Script là `ts-node src/seed.ts`, thiếu
  `-r tsconfig-paths/register`, nên chết với `MODULE_NOT_FOUND` ở dòng import đầu tiên.
  Mọi script seed khác trong `package.json` đều có cờ đó. Chạy được bằng:
  `node -r ts-node/register -r tsconfig-paths/register src/seed.ts`. Sửa một dòng, nhưng
  không trộn vào PR hạ tầng này.
- **Nhánh production đang chạy trước `staging` 5 commit** (`chore/soat-cau-hinh-payos-firebase`),
  và 5 commit đó sửa controller/DTO mà **không cập nhật `openapi.json`**. Khi chúng merge
  vào `staging`, cổng `openapi:check` của CI sẽ đỏ — đúng như nó phải thế.
