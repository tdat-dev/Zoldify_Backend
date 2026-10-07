#!/usr/bin/env bash
#
# KHÔI PHỤC MYSQL TỪ BẢN BACKUP — task #25 bảng phân công.
#
#   ./scripts/restore-mysql.sh backups/zoldify-zoldify-20260827-030000.sql.gz
#       → khôi phục vào database DIỄN TẬP `zoldify_restore_drill`, KHÔNG đụng
#         database đang chạy, rồi đếm số dòng từng bảng làm bằng chứng.
#
#   SOURCE_DB=zoldify ./scripts/restore-mysql.sh <file.gz>
#       → làm như trên, và SO SÁNH số dòng từng bảng với database gốc. Đây là
#         cuộc diễn tập đầy đủ: chứng minh bản sao khôi phục ra ĐÚNG dữ liệu,
#         chứ không chỉ chứng minh câu lệnh chạy không báo lỗi.
#
#   ./scripts/restore-mysql.sh <file.gz> zoldify --force
#       → đè lên database thật. Phải gõ --force, không có đường tắt.
#
#
# VÌ SAO CẦN CẢ SCRIPT NÀY, TRONG KHI `gunzip | mysql` LÀ MỘT DÒNG.
#
# Bảng phân công viết thẳng ở task #25: "Backup chưa từng restore thử thì không
# phải backup." Nhưng một cuộc diễn tập làm ẩu còn tệ hơn không diễn tập: cách
# nhanh nhất để "thử khôi phục" là đổ bản dump đè lên chính database đang chạy,
# và nếu bản dump ấy hỏng thì cuộc diễn tập vừa phá mất dữ liệu thật. Sự cố tự
# gây ra, đúng vào lúc đang cố chứng minh mình an toàn.
#
# Nên mặc định của script này là khôi phục vào một database TÁCH RIÊNG
# (`zoldify_restore_drill`), và muốn đè lên database thật thì phải nói rõ bằng
# --force. Mặc định an toàn, đường nguy hiểm phải gõ thêm chữ.
#
# Và diễn tập chỉ có giá trị khi có SỐ để đối chiếu. `mysql < dump.sql` chạy
# xong không báo lỗi KHÔNG chứng minh dữ liệu về đủ — một dump bị cắt giữa
# chừng vẫn nạp được phần đầu rồi kết thúc êm. Nên bước cuối là đếm COUNT(*)
# từng bảng và so với bản gốc.

set -euo pipefail

FILE=""
TARGET=""
FORCE="no"
for arg in "$@"; do
  case "$arg" in
    --force) FORCE="yes" ;;
    -*) echo "cờ lạ: $arg" >&2; exit 2 ;;
    *) if [ -z "$FILE" ]; then FILE="$arg"; else TARGET="$arg"; fi ;;
  esac
done

PROJECT="${COMPOSE_PROJECT:-zoldify}"
PROD_DB="${DB_DATABASE:-zoldify}"
DRILL_DB="${DRILL_DB:-zoldify_restore_drill}"
TARGET="${TARGET:-$DRILL_DB}"

if [ -z "$FILE" ]; then
  echo "dùng: $0 <file.sql.gz> [database_đích] [--force]" >&2
  exit 2
fi

log() { echo "[restore $(date '+%Y-%m-%d %H:%M:%S')] $*"; }

# ── Chốt an toàn ────────────────────────────────────────────────────────────
#
# Đây là lý do chính script này tồn tại. Không có nó thì một lần gõ nhầm tên
# database trong lúc diễn tập sẽ ghi đè dữ liệu production, và mọi thứ ở trên
# đều thành vô nghĩa.
if [ "$TARGET" = "$PROD_DB" ] && [ "$FORCE" != "yes" ]; then
  log "TỪ CHỐI: '$TARGET' là database đang chạy."
  log "Diễn tập thì để mặc định ('$DRILL_DB'). Thật sự muốn đè thì thêm --force."
  exit 4
fi
[ "$FORCE" = "yes" ] && log "CẢNH BÁO: --force — sẽ ghi đè '$TARGET'"

COMPOSE_DIR="${COMPOSE_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
[ -f "$FILE" ] || { log "LỖI: không thấy file $FILE"; exit 2; }
FILE_ABS="$(cd "$(dirname "$FILE")" && pwd)/$(basename "$FILE")"

if [ -z "${DB_PASSWORD:-}" ] && [ -f "$COMPOSE_DIR/.env" ]; then
  DB_PASSWORD="$(grep -E '^DB_PASSWORD=' "$COMPOSE_DIR/.env" | head -1 | cut -d= -f2-)"
fi
[ -n "${DB_PASSWORD:-}" ] || { log "LỖI: không có DB_PASSWORD"; exit 2; }

cd "$COMPOSE_DIR"

# Chạy một câu lệnh SQL trong container mysql của cụm. Gộp thành hàm vì đoạn
# `docker compose ... exec -T -e MYSQL_PWD` lặp lại năm lần bên dưới, và cờ -T
# là thứ không được quên (không có TTY khi chạy từ script/cron).
sql() {
  docker compose -p "$PROJECT" exec -T -e MYSQL_PWD="$DB_PASSWORD" mysql \
    mysql --default-character-set=utf8mb4 -u root -N -B -e "$1" ${2:+"$2"}
}

# ── Bản dump phải còn nguyên vẹn TRƯỚC khi đụng vào database nào ────────────
#
# `gzip -t` đọc hết luồng và kiểm CRC. Một file .gz bị cắt (đĩa đầy giữa lúc
# ghi, sao chép dở dang) sẽ trượt ở đây — trước khi kịp tạo ra một database nửa
# vời mà người đọc log tưởng là khôi phục thành công.
log "kiểm toàn vẹn $FILE_ABS"
gzip -t "$FILE_ABS" || { log "LỖI: file .gz hỏng"; exit 3; }
gzip -dc "$FILE_ABS" | tail -n 5 | grep -q 'Dump completed' \
  || { log "LỖI: thiếu marker 'Dump completed' — dump bị cắt giữa chừng"; exit 3; }
log "file nguyên vẹn"

# ── Khôi phục ───────────────────────────────────────────────────────────────
log "cụm=$PROJECT đích=$TARGET"
sql "DROP DATABASE IF EXISTS \`$TARGET\`; CREATE DATABASE \`$TARGET\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
log "đang nạp..."
gzip -dc "$FILE_ABS" | docker compose -p "$PROJECT" exec -T \
  -e MYSQL_PWD="$DB_PASSWORD" mysql \
  mysql --default-character-set=utf8mb4 -u root "$TARGET"
log "nạp xong"

# ── Bằng chứng: đếm số dòng từng bảng ───────────────────────────────────────
#
# KHÔNG dùng information_schema.TABLE_ROWS: với InnoDB đó là số ƯỚC LƯỢNG, lệch
# vài chục phần trăm là bình thường. Diễn tập khôi phục mà đối chiếu bằng số
# ước lượng thì không chứng minh được gì. COUNT(*) chậm hơn nhưng đúng.
dem_bang() {
  db="$1"
  for t in $(sql "SHOW TABLES" "$db"); do
    n="$(sql "SELECT COUNT(*) FROM \`$t\`" "$db" | tr -d '[:space:]')"
    echo "$t=$n"
  done
}

echo ""
log "── số dòng sau khôi phục ($TARGET) ──"
SAU="$(dem_bang "$TARGET")"
echo "$SAU" | sed 's/^/  /'

if [ -n "${SOURCE_DB:-}" ]; then
  echo ""
  log "── đối chiếu với database gốc ($SOURCE_DB) ──"
  TRUOC="$(dem_bang "$SOURCE_DB")"
  if [ "$TRUOC" = "$SAU" ]; then
    log "KHỚP TUYỆT ĐỐI — mọi bảng cùng số dòng. Bản backup khôi phục được thật."
  else
    log "LỆCH — chênh lệch bên dưới (< là gốc, > là bản khôi phục):"
    diff <(echo "$TRUOC") <(echo "$SAU") || true
    log "Lưu ý: lệch là BÌNH THƯỜNG nếu database gốc vẫn đang nhận ghi lúc dump."
    log "Đọc con số, đừng đọc mỗi chữ PASS/FAIL."
  fi
fi

echo ""
log "xong. Dọn database diễn tập khi đã xem xong:"
log "  docker compose -p $PROJECT exec -T mysql mysql -u root -p -e 'DROP DATABASE \`$TARGET\`'"
