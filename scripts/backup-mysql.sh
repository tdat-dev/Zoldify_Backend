#!/usr/bin/env bash
#
# BACKUP MYSQL HẰNG NGÀY — task #24 bảng phân công.
#
#   ./scripts/backup-mysql.sh              # dump + kiểm + nén + dọn bản cũ
#   ./scripts/backup-mysql.sh --prune-only # chỉ dọn bản cũ (dùng cho bài tự kiểm)
#
# CÀI VÀO CRON TRÊN VPS (3h sáng mỗi ngày, giờ máy chủ):
#
#   crontab -e
#   0 3 * * * cd /opt/zoldify-backend && ./scripts/backup-mysql.sh >> /var/log/zoldify-backup.log 2>&1
#
# Cụm staging thì thêm biến môi trường ở đầu dòng:
#
#   0 4 * * * cd /opt/staging/zoldify-backend && COMPOSE_PROJECT=zoldify-staging ./scripts/backup-mysql.sh >> /var/log/zoldify-backup-staging.log 2>&1
#
#
# VÌ SAO SCRIPT NÀY DÀI HƠN MỘT DÒNG MYSQLDUMP.
#
# Vì `mysqldump` KHÔNG kêu khi hỏng theo cách nguy hiểm nhất. Sai mật khẩu, sai
# tên database, container chưa sẵn sàng — nó vẫn in ra vài dòng comment header
# rồi thoát, và `> file.sql` vẫn tạo ra một file. Nén lại thành .gz vẫn "thành
# công". Cron chạy đủ 14 đêm, thư mục đầy file trông y hệt backup thật, và điều
# đó chỉ lộ ra đúng vào ngày cần khôi phục — ngày duy nhất không sửa được nữa.
#
# Nên mỗi bản dump phải TỰ CHỨNG MINH nó là dump thật trước khi được giữ lại:
# đủ lớn, có `CREATE TABLE`, và có dòng `Dump completed` mà mysqldump chỉ ghi
# khi chạy trọn vẹn tới cuối. Không đạt cả ba thì file bị xoá và script thoát
# mã khác 0 — thà không có backup và biết mình không có, còn hơn có một thư mục
# đầy file vô dụng mà tưởng là an toàn.
#
#
# GIỚI HẠN — NÓI THẲNG (nợ có ý thức):
#
#   1. Bản sao nằm CÙNG ĐĨA với database. VPS hỏng đĩa là mất cả hai. Thiết kế
#      (docs/system-design/2026-08-06-zoldify-scale-mobile-design.md:593) nói
#      dump → nén → đẩy lên R2 giữ 14 ngày. Phần đẩy lên R2 chờ task #13, hiện
#      chưa có credential. Chỗ cắm đã chừa sẵn: biến BACKUP_OFFSITE_CMD dưới đây.
#   2. Ảnh sản phẩm KHÔNG nằm trong dump này. Chúng ở volume `product-images`
#      (xem docker-compose.yml). Khôi phục database xong vẫn mất sạch ảnh hàng.
#      Nằm ngoài phạm vi #24 nhưng phải nói ra, không để ai tưởng đã an toàn.

set -euo pipefail

# ── Cấu hình, tất cả ghi đè được bằng biến môi trường ────────────────────────
#
# VPS chạy HAI cụm từ cùng một file compose (xem đầu docker-compose.yml):
# `-p zoldify` là production, `-p zoldify-staging` là staging. Nhắm nhầm cụm thì
# backup nhầm database mà vẫn báo thành công, nên mặc định là production và tên
# cụm được in ra ở mỗi lần chạy.
PROJECT="${COMPOSE_PROJECT:-zoldify}"
DB_NAME="${DB_DATABASE:-zoldify}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
# Dump của một database trống cũng đã hơn 1KB chỉ tính header. Ngưỡng 10KB đủ
# thấp để không báo động giả trên database mới, đủ cao để bắt file chỉ có header.
MIN_BYTES="${MIN_BYTES:-10240}"

log() { echo "[backup $(date '+%Y-%m-%d %H:%M:%S')] $*"; }

# ── Dọn bản cũ ──────────────────────────────────────────────────────────────
#
# Hai chốt hẹp phạm vi, cả hai đều cố ý:
#   -maxdepth 1  : không đi xuống thư mục con của người khác.
#   -name 'zoldify-*.sql.gz' : chỉ xoá file do chính script này đặt tên.
# Thiếu một trong hai thì một biến BACKUP_DIR trỏ nhầm chỗ sẽ thành lệnh xoá
# hàng loạt. Không dùng `rm -rf` ở đây, và cũng không nên thêm vào.
#
# Vì sao `+$((RETENTION_DAYS - 1))` chứ không `+$RETENTION_DAYS`: cờ -mtime +N
# của find nghĩa là "cũ hơn N ngày TRỌN", nên +14 sẽ giữ lại 15 bản chứ không
# phải 14. Lệch một là lỗi kinh điển của retention, và nó im lặng.
prune() {
  mkdir -p "$BACKUP_DIR"
  log "dọn bản cũ hơn $RETENTION_DAYS ngày trong $BACKUP_DIR"
  find "$BACKUP_DIR" -maxdepth 1 -type f -name 'zoldify-*.sql.gz' \
    -mtime "+$((RETENTION_DAYS - 1))" -print -delete
}

# Chạy TRƯỚC mọi thứ liên quan tới docker: bài tự kiểm gọi nhánh này để kiểm
# phần dọn file trên một thư mục giả, không cần MySQL và không cần Docker.
if [ "${1:-}" = "--prune-only" ]; then
  prune
  log "xong (chỉ dọn)"
  exit 0
fi

# ── Chuẩn bị ────────────────────────────────────────────────────────────────
COMPOSE_DIR="${COMPOSE_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"

# Mật khẩu lấy từ .env cạnh docker-compose.yml nếu môi trường chưa có. `cut -d=
# -f2-` chứ không `-f2`: mật khẩu chứa dấu `=` là chuyện thường và cắt cụt nó
# sẽ thành "sai mật khẩu" khó hiểu.
if [ -z "${DB_PASSWORD:-}" ] && [ -f "$COMPOSE_DIR/.env" ]; then
  DB_PASSWORD="$(grep -E '^DB_PASSWORD=' "$COMPOSE_DIR/.env" | head -1 | cut -d= -f2-)"
fi
if [ -z "${DB_PASSWORD:-}" ]; then
  log "LỖI: không có DB_PASSWORD (không ở môi trường, không có trong $COMPOSE_DIR/.env)"
  exit 2
fi

mkdir -p "$BACKUP_DIR"
BACKUP_ABS="$(cd "$BACKUP_DIR" && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"
SQL="$BACKUP_ABS/zoldify-$DB_NAME-$STAMP.sql"

cd "$COMPOSE_DIR"
log "cụm=$PROJECT database=$DB_NAME đích=$SQL.gz"

# ── Dump ────────────────────────────────────────────────────────────────────
#
# --single-transaction : chụp nhất quán bằng ảnh MVCC của InnoDB, KHÔNG khoá
#                        ghi. Thiếu cờ này thì bảng bị khoá suốt lúc dump; với
#                        1 triệu bản ghi đó là vài phút sàn đứng hình giữa đêm.
# --quick              : đọc từng dòng thay vì nạp cả bảng vào RAM rồi mới ghi.
#                        Trên VPS nhỏ, thiếu nó là OOM.
# --routines/--triggers/--events : những thứ mysqldump MẶC ĐỊNH BỎ QUA. Khôi
#                        phục xong mà thiếu trigger thì database "trông đủ" mà
#                        hành vi sai — kiểu hỏng tệ hơn là mất hẳn.
# -e MYSQL_PWD         : truyền mật khẩu qua môi trường thay vì `-pMẬT_KHẨU`
#                        trên dòng lệnh, nơi mọi tiến trình khác đọc được bằng
#                        `ps aux`.
# -T                   : không cấp TTY. Chạy tay thì không có cờ này vẫn được,
#                        nhưng cron không có TTY và sẽ hỏng với "the input
#                        device is not a TTY" — đúng loại lỗi chỉ xuất hiện sau
#                        khi đã tin là xong.
log "đang dump..."
docker compose -p "$PROJECT" exec -T -e MYSQL_PWD="$DB_PASSWORD" mysql \
  mysqldump \
  --single-transaction \
  --quick \
  --routines \
  --triggers \
  --events \
  --default-character-set=utf8mb4 \
  -u root "$DB_NAME" >"$SQL"

# ── Bản dump phải tự chứng minh nó là dump thật ─────────────────────────────
loi_dump() {
  log "DUMP HỎNG: $1"
  # Xoá chứ không giữ lại. Một file hỏng nằm trong thư mục backup còn nguy hiểm
  # hơn thư mục trống, vì nó làm người ta tin là mình có bản sao.
  rm -f "$SQL"
  exit 3
}

SIZE="$(wc -c <"$SQL" | tr -d '[:space:]')"
[ "$SIZE" -ge "$MIN_BYTES" ] || loi_dump "chỉ $SIZE byte, dưới ngưỡng $MIN_BYTES"
grep -q 'CREATE TABLE' "$SQL" || loi_dump "không có dòng CREATE TABLE nào"
tail -n 5 "$SQL" | grep -q 'Dump completed' || loi_dump "thiếu marker 'Dump completed' ở cuối — dump bị cắt giữa chừng"
log "dump hợp lệ: $SIZE byte"

# ── Nén ─────────────────────────────────────────────────────────────────────
gzip -9 "$SQL"
GZ="$SQL.gz"
log "đã nén: $(wc -c <"$GZ" | tr -d '[:space:]') byte"

# ── Đẩy offsite (chỗ chừa cho task #13 — R2) ────────────────────────────────
#
# Chưa có credential R2 nên chưa bật. Khi #13 xong, đặt biến này trong crontab:
#   BACKUP_OFFSITE_CMD='aws s3 cp --endpoint-url https://<acct>.r2.cloudflarestorage.com'
# rồi script sẽ gọi:  <lệnh> <file.gz> s3://<bucket>/
# Để trống thì bỏ qua trong im lặng — không giả vờ đã đẩy.
if [ -n "${BACKUP_OFFSITE_CMD:-}" ]; then
  log "đẩy offsite..."
  sh -c "$BACKUP_OFFSITE_CMD \"$GZ\" ${BACKUP_OFFSITE_DEST:-}"
  log "đã đẩy offsite"
else
  log "BỎ QUA đẩy offsite (BACKUP_OFFSITE_CMD trống) — bản sao vẫn nằm cùng đĩa với database"
fi

# ── Dọn bản cũ ──────────────────────────────────────────────────────────────
prune

CON_LAI="$(find "$BACKUP_ABS" -maxdepth 1 -type f -name 'zoldify-*.sql.gz' | wc -l | tr -d '[:space:]')"
log "xong. Đang giữ $CON_LAI bản trong $BACKUP_ABS"
