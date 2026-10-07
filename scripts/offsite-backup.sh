#!/bin/sh
# Chép các bản sao lưu MySQL trong ./backups lên Cloudflare R2. Chạy trong
# service `offsite` của docker-compose.yml (ảnh rclone/rclone).
#
# Vì sao cần: service `backup` chỉ dump vào ./backups trên CHÍNH VPS. Mất cả
# máy (VPS bị xoá, ổ hỏng, nhà cung cấp khoá tài khoản) là mất luôn mọi bản sao
# lưu cùng database. Bản trên R2 nằm ngoài VPS.
#
# Token R2 dùng ở đây KHÁC token của ứng dụng (R2_ACCESS_KEY_ID). Token ứng dụng
# chỉ vào được bucket ảnh zoldify-images (thử 30/09: đọc zoldify-backups bị 403);
# giữ hai token tách nhau thì một lỗ hổng ở api không đọc hay xoá được bản sao
# lưu. Token này chỉ có quyền Object Read & Write trên bucket zoldify-backups, và
# chỉ dùng được từ IP của VPS.
#
# Mỗi vòng: `rclone copy` (chỉ thêm file mới, không bao giờ xoá theo nguồn: bản
# local bị xoá nhầm thì bản trên R2 vẫn còn), rồi xoá trên R2 các bản cũ hơn
# OFFSITE_KEEP_DAYS ngày. Chỉ chép *.sql.gz: file .part là dump đang ghi dở.
#
# Biến môi trường:
#   BACKUP_R2_ACCESS_KEY_ID, BACKUP_R2_SECRET_ACCESS_KEY   token riêng (bắt buộc)
#   R2_ACCOUNT_ID       account Cloudflare, dựng endpoint (bắt buộc)
#   BACKUP_R2_BUCKET    mặc định zoldify-backups
#   BACKUP_R2_PREFIX    thư mục trong bucket: prod / staging (bắt buộc, để hai
#                       môi trường không ghi đè hay xoá bản của nhau)
#   OFFSITE_KEEP_DAYS   mặc định 30
#   OFFSITE_INTERVAL    số giây giữa hai lần, mặc định 21600 (6 giờ). Dump chạy
#                       24 giờ một lần, nên bản mới lên R2 chậm nhất 6 giờ.
#   OFFSITE_ONCE=1      chạy một lần rồi thoát (dùng khi chạy tay)
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
BACKUP_R2_BUCKET="${BACKUP_R2_BUCKET:-zoldify-backups}"
OFFSITE_KEEP_DAYS="${OFFSITE_KEEP_DAYS:-30}"
OFFSITE_INTERVAL="${OFFSITE_INTERVAL:-21600}"

missing=''
for v in BACKUP_R2_ACCESS_KEY_ID BACKUP_R2_SECRET_ACCESS_KEY R2_ACCOUNT_ID BACKUP_R2_PREFIX; do
  eval "val=\${$v:-}"
  [ -n "$val" ] || missing="$missing $v"
done

# Thiếu cấu hình thì KHÔNG thoát: thoát là container khởi động lại liên tục mà
# không ai để ý. Nằm chờ và kêu trong log mỗi vòng, `docker compose logs offsite`
# nhìn là thấy.
if [ -n "$missing" ]; then
  while true; do
    echo "[offsite] CHƯA chép ra R2: thiếu biến$missing trong .env" >&2
    [ "${OFFSITE_ONCE:-0}" = "1" ] && exit 1
    sleep "$OFFSITE_INTERVAL"
  done
fi

# Cấu hình rclone qua biến môi trường, không ghi file: secret không nằm trên đĩa.
# File cấu hình rỗng chỉ để rclone thôi báo "Config file not found" mỗi lệnh.
RCLONE_CONFIG="$(mktemp)"
export RCLONE_CONFIG
export RCLONE_CONFIG_R2_TYPE=s3
export RCLONE_CONFIG_R2_PROVIDER=Cloudflare
export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$BACKUP_R2_ACCESS_KEY_ID"
export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$BACKUP_R2_SECRET_ACCESS_KEY"
export RCLONE_CONFIG_R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
# Token chỉ có quyền object, không được tạo bucket: bỏ bước kiểm/tạo bucket.
export RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true

DEST="r2:${BACKUP_R2_BUCKET}/${BACKUP_R2_PREFIX}"

offsite_once() {
  if ! rclone copy "$BACKUP_DIR" "$DEST" --include '*.sql.gz' --log-level NOTICE; then
    echo "[offsite] LỖI: chép lên $DEST thất bại" >&2
    return 1
  fi
  rclone delete "$DEST" --include '*.sql.gz' --min-age "${OFFSITE_KEEP_DAYS}d" --log-level NOTICE || true
  count="$(rclone lsf "$DEST" --include '*.sql.gz' | wc -l)"
  newest="$(rclone lsf "$DEST" --include '*.sql.gz' | sort | tail -n 1)"
  echo "[offsite] OK $DEST: $count bản, mới nhất $newest"
}

if [ "${OFFSITE_ONCE:-0}" = "1" ]; then
  offsite_once
  exit $?
fi

while true; do
  # Lỗi một vòng (mạng, R2 chập chờn) không được giết vòng lặp: thử lại vòng sau.
  offsite_once || true
  sleep "$OFFSITE_INTERVAL"
done
