#!/bin/sh
# Sao lưu MySQL định kỳ. Chạy trong service `backup` của docker-compose.yml
# (ảnh mysql:8, có sẵn mysqldump, gzip, find).
#
# Mỗi vòng: dump ra file tạm, kiểm file (gzip hợp lệ + có dòng "Dump completed"
# mà mysqldump chỉ ghi khi chạy hết), rồi mới đổi tên thành file thật. Dump hỏng
# giữa chừng không bao giờ nằm lẫn với bản tốt. Sau đó xoá bản cũ hơn
# BACKUP_KEEP_DAYS ngày.
#
# Biến môi trường:
#   DB_PASSWORD        mật khẩu root (bắt buộc)
#   DB_DATABASE        tên database (mặc định zoldify)
#   DB_HOST            mặc định mysql (tên service trong compose)
#   BACKUP_DIR         mặc định /backups
#   BACKUP_KEEP_DAYS   mặc định 14
#   BACKUP_INTERVAL    số giây giữa hai lần, mặc định 86400 (1 ngày)
#   BACKUP_ONCE=1      chạy một lần rồi thoát (dùng khi chạy tay)
set -eu

: "${DB_PASSWORD:?DB_PASSWORD đang trống}"
DB_DATABASE="${DB_DATABASE:-zoldify}"
DB_HOST="${DB_HOST:-mysql}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
BACKUP_INTERVAL="${BACKUP_INTERVAL:-86400}"

mkdir -p "$BACKUP_DIR"

# Mật khẩu qua file cấu hình quyền 600, không qua tham số dòng lệnh: tham số thì
# ai `ps` trên máy cũng đọc được. Đặt trong ngoặc kép (thoát \ và ") vì trong
# file cấu hình MySQL, dấu # giữa dòng bị hiểu là bắt đầu chú thích.
CNF="$(mktemp)"
trap 'rm -f "$CNF"' EXIT
chmod 600 "$CNF"
PW_QUOTED="$(printf '%s' "$DB_PASSWORD" | sed 's/\\/\\\\/g; s/"/\\"/g')"
printf '[client]\nuser=root\npassword="%s"\nhost=%s\n' "$PW_QUOTED" "$DB_HOST" > "$CNF"

backup_once() {
  stamp="$(date -u +%Y%m%d-%H%M%S)"
  final="$BACKUP_DIR/${DB_DATABASE}-${stamp}.sql.gz"
  tmp="$final.part"

  # --single-transaction: ảnh chụp nhất quán của InnoDB mà không khoá bảng,
  # API vẫn ghi bình thường trong lúc dump. Không dùng `set -o pipefail` (sh
  # thuần không có), nên lỗi của mysqldump được bắt bằng bước kiểm file bên dưới.
  mysqldump --defaults-extra-file="$CNF" \
    --single-transaction --quick --routines --triggers --events \
    --set-gtid-purged=OFF --no-tablespaces \
    "$DB_DATABASE" | gzip > "$tmp" || true

  if ! gzip -t "$tmp" 2>/dev/null || ! gzip -cd "$tmp" | tail -n 1 | grep -q 'Dump completed'; then
    echo "[backup] LỖI: dump thất bại hoặc không hoàn chỉnh, bỏ file tạm" >&2
    rm -f "$tmp"
    return 1
  fi

  mv "$tmp" "$final"
  echo "[backup] OK $final ($(du -h "$final" | cut -f1))"

  find "$BACKUP_DIR" -name "${DB_DATABASE}-*.sql.gz" -type f -mtime +"$BACKUP_KEEP_DAYS" -print -delete |
    sed 's/^/[backup] xoá bản cũ /'
}

if [ "${BACKUP_ONCE:-0}" = "1" ]; then
  backup_once
  exit $?
fi

while true; do
  # Lỗi một vòng không được giết vòng lặp: thử lại ở vòng sau.
  backup_once || true
  sleep "$BACKUP_INTERVAL"
done
