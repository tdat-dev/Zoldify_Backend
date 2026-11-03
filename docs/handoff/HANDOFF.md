# Zoldify: handoff phiên Windows sang macOS (03/11/2026)

Đọc file này trước khi làm gì. Đây là bản tóm tắt cuộc chat trên máy Windows (D:\Zoldify) để phiên mới trên macOS biết đang làm tới đâu. Chi tiết dài hạn nằm trong `memory/` cạnh file này (bản sao memory Claude của project).

**Repo này PUBLIC.** IP VPS, ID Cloudflare, mật khẩu dev, tài khoản Google và token đã được thay bằng `<IP>`, `<cf-id>`, `<pass>`, `<google-account>`, `<redacted>`. Giá trị thật hỏi user hoặc xem trên VPS (`ssh vps`) và dashboard Cloudflare. Đừng ghi chúng ngược vào đây.

## 1. Cài lại memory trên macOS

Memory Claude Code theo thư mục làm việc. Sau khi clone các repo vào, ví dụ `~/Zoldify`:

```bash
# slug = đường dẫn tuyệt đối, thay "/" bằng "-"
mkdir -p ~/.claude/projects/-Users-<ban>-Zoldify/memory
cp ~/Zoldify/Zoldify_Backend/docs/handoff/memory/*.md ~/.claude/projects/-Users-<ban>-Zoldify/memory/
```

Alias ssh `vps` phải tự khai lại trong `~/.ssh/config` trên mac (Host vps, HostName = IP VPS, kèm key ssh chép từ máy Windows).

Đường dẫn Windows trong memory (D:\Zoldify\..., D:\AndroidAvd, WSL docker) không còn đúng trên mac; đọc như ghi chú lịch sử.

## 2. Luật người dùng (vẫn hiệu lực)

- Trả lời bằng tiếng Việt. TUYỆT ĐỐI không dùng dấu gạch dài (em dash) ở bất cứ đâu.
- Có commit là đẩy GitHub ngay (kể cả nhỏ); kiểm (build/lint/test) xanh thì gộp vào `staging` và đẩy cho CD deploy staging. **Prod luôn phải hỏi user từng lần.** Xem memory `push-every-commit-to-staging.md`.
- Trước khi đẩy backend `staging`: trên VPS `docker tag zoldify-backend:latest zoldify-backend:prod-keep-<ngày>` vì staging CD build lại `:latest` mà prod dùng chung, image cũ bị prune mất đường lùi.
- Không dùng Claude in Chrome. Trình duyệt dùng tool `browser_*` (Maestro/bytehive).
- Không tạo Artifact cho Zoldify; giao kết quả bằng file trong repo.
- VPS dùng chung với dịch vụ khác: chỉ đụng thứ của Zoldify. Không `rm` bừa trên VPS.
- Dữ liệu giả (user/đơn) chỉ ở staging, không bao giờ trên prod.
- Máy yếu: mỗi lúc một tiến trình nặng, ưu tiên thấp. Build APK dùng GitHub Actions thay vì Gradle cục bộ.
- Hỏi trước khi mở emulator hoặc cài APK.
- Tạo sản phẩm trên prod phải theo thủ tục bảng `follows` (xem memory `deploy-vps-backend.md`): gỡ tạm row id 2 (6 theo dõi 1) và id 3 (7 theo dõi 1), chờ hàng BullMQ chạy hết, rồi trả lại; row 5 là dữ liệu QA, để yên.

## 3. Hạ tầng (tóm tắt, chi tiết trong memory)

- VPS `<IP>` (ssh alias `vps`), 2 vCPU, 3.9 GB RAM, chung dịch vụ khác. Prod `/opt/zoldify-backend` (compose `zoldify`), staging `/opt/staging/zoldify-backend` (compose `zoldify-staging`).
- Luồng: Cloudflare, nginx host, Caddy, 3 bản api. IP thật đi theo CF-Connecting-IP; throttler 10 req/s mỗi IP.
- Nhánh deploy (GitHub Actions CD):
  - Backend: `staging` lên staging, `chore/soat-cau-hinh-payos-firebase` lên prod.
  - Frontend: `staging` và `deploy-prod`.
  - Admin prod: `chore/deploy-docker`.
- Cache biên Cloudflare: backend `src/common/cache-bien.ts`, tài liệu `Zoldify_Backend/docs/bao-cao/cache-cloudflare.md`. Tắt Cache Rule trên Cloudflare là hoàn tác.
- Cả 4 repo `tdat-dev/Zoldify_*` đều PUBLIC: đừng commit thông tin hạ tầng/secret vào đó.

## 4. Trạng thái prod hiện tại (03/11)

- Backend prod = `3ec10a9`: sửa IP thật cho giới hạn tốc độ, các fix E2E (D-08, D-14, D-17, D-19), đợt tối ưu 1 triệu sản phẩm, cache Cloudflare. Buffer pool MySQL prod 256M.
- Frontend prod (`deploy-prod`) = `1d10734`, đã kiểm: 100 lượt tải trang sản phẩm song song đều 200, không có 429. Gồm:
  - `fac7b7c`: trang chủ "Mới đăng" tự tải thêm khi cuộn.
  - `b7336ce`: chuyển trang tự về đầu trang.
  - `1d10734`: middleware bảo trì gộp lượt hỏi `/settings/public`, gặp 429/5xx thì giữ cờ cũ.
- Báo cáo kèm theo (trong Zoldify_Backend/docs/bao-cao/): `ip-that-gioi-han.md`, `ssr-ip-that.md`, `cache-cloudflare.md`.
- Seed: 421 món có bộ 3 đến 5 ảnh thật đã lên prod. Món chưa có bộ ảnh giữ 1 đến 2 ảnh. Script và manifest ở máy Windows `D:\Zoldify\seed-data` (KHÔNG có trên GitHub).
- Backup trên VPS `/opt/manual-backups/`: `prod-before-1m-20261103-0558.sql.gz`, `prod-before-multiphoto2-20261103-06*.sql.gz`...

## 5. Việc vừa xong trong phiên này

- **Build APK trên GitHub Actions chạy được.** Repo Zoldify_Mobile, nhánh `ci/build-apk`, PR #5 (đang mở, vào `main`).
  - Lỗi cũ: bước "Tune Gradle memory" nối `kotlin.daemon.jvmargs` vào `android/gradle.properties`. File này không có xuống dòng cuối nên dòng mới dính vào `expo.inlineModules.watchedDirectories=[]`, và Expo đọc JSON hỏng. Đã sửa ở commit `7104ff5`.
  - Run thành công: https://github.com/tdat-dev/Zoldify_Mobile/actions/runs/41630108932, artifact `zoldify-staging-7104ff5.apk` (69 MB, API staging, cert SHA-1 đúng).
  - Hướng dẫn: `Zoldify_Mobile/docs/build-apk-ci.md`.
- PR #5 mang theo cả loạt commit E2E của nhánh `fix/e2e-chi-tiet-0211`. Chưa gộp vì đang chờ user quyết.

## 6. Việc còn mở (theo thứ tự nên hỏi user)

1. **PR #5 mobile:** gộp vào `main` không? Mobile chưa có nhánh `staging`; đề xuất tạo `staging` từ `main`.
2. **Cường mở PR backend #37 `feat/products-keyset-cursor`** (cursor cho `/products`). Khi PR này lên, sửa FE (trang chủ, tìm kiếm, danh mục) và mobile sang `cursor`/`nextCursor`, vẫn giữ `page` cho app bản cũ. Hiện `/products` còn dùng `.offset()` và `COUNT(DISTINCT)` (products.service.ts quanh dòng 993 và 1231).
3. **Đã đề xuất, user chưa trả lời:**
   - Sửa tiêu đề/mô tả của 177 món seed giữ tên cũ cho khớp ảnh mới.
   - Web/app bỏ token ở các GET công khai để người đã đăng nhập cũng được hưởng cache.
   - Hạ buffer pool MySQL staging xuống 256M.
4. **Lỗi nhỏ mobile:**
   - Đơn COD đã huỷ vẫn hiện "Trả khi nhận hàng".
   - Bấm Back khi form địa chỉ đang điền dở thì mất dữ liệu mà không hỏi.
5. **Chưa làm vì thiếu điều kiện:**
   - Ẩn sản phẩm: cần trường status ở backend.
   - Lý do huỷ đơn: API chưa có.
   - Icon app: cần logo Zoldify vuông từ user.
6. **Hàng đợi cũ:**
   - 1.000 bản ghi mỗi thực thể trên staging.
   - Tính năng tình trạng/độ bền sản phẩm (cả backend và app).
   - Câu hỏi 9router.
   - Dọn override `docker-compose.ip-that.yml` và image `ip-that` cũ trên VPS.
7. **Hỏi đáp đã trả lời:** 100k người cùng cuộn trên VPS hiện tại có thể sập. Cache biên và cursor là hai bước giảm tải.

## 7. Worktree trên máy Windows (đều đã đẩy, không còn commit chưa đẩy)

| Thư mục | Repo | Nhánh |
|---|---|---|
| wt-mobile | Mobile | `ci/build-apk` (PR #5) |
| wt-fe-newest | Frontend | `fix/ssr-mot-lan-hoi-bao-tri` (đã lên prod) |
| wt-cf-cache | Backend | `feat/cache-cloudflare-danh-sach` (PR #36, đã lên prod) |
| wt-ip | Backend | `fix/ip-that-cho-gioi-han` (đã lên prod, còn 1 file chưa commit, chưa xem là gì) |
| wt-1mall | Backend | `perf/1m-tong-hop` (đã lên prod) |
| wt-e2e-be | Backend | `fix/e2e-chi-tiet-0211` (đã lên prod) |
| Zoldify_Mobile | Mobile | `fix/e2e-ghn-orders-wishlist` (1 file chưa commit) |

Trên mac chỉ cần clone 4 repo, rồi checkout nhánh cần làm. Không cần tái tạo các worktree.

## 8. Mẹo đã học

- Lệnh ssh nhiều dòng: viết ra file `.sh` rồi pipe qua `ssh vps bash`, đừng nhét awk có `$` vào lệnh inline.
- Kiểm một deploy web: bắn song song N lượt tải trang, rồi đọc `/var/log/nginx/access.log` trên VPS (lọc `settings/public` và mã 429).
- Gradle nuốt stderr của các lệnh node mà Expo gọi lúc cấu hình. Muốn thấy lỗi thật thì chạy riêng lệnh node đó.

## 9. Skill nên dùng ở phiên sau

- `superpowers:systematic-debugging` / `claudekit-engineer:eng-fix` cho lỗi.
- `claudekit-engineer:eng-review` trước khi gộp PR #5 hoặc #37.
- `superpowers:verification-before-completion` trước khi báo xong (kiểm trên staging/prod thật).
- `agent-skills:ci-cd-and-automation` nếu sửa workflow GitHub Actions.
