#!/usr/bin/env bash
# Deploy cụm trên VPS mà API không trả 502: thay lần lượt từng bản api.
#
# Gọi từ .github/workflows/deploy.yml, trong thư mục repo trên VPS, sau khi đã
# checkout đúng commit:  bash scripts/deploy/lan-luot-api.sh <project compose>
#
# VÌ SAO. `docker compose up -d --build` tạo lại cả ba bản api cùng một lượt:
# không còn bản nào nghe cổng, caddy trả 502 khoảng 5 giây mỗi lần deploy, và
# trang đích web gọi API đúng lúc đó từng trả 404 giả cho Google (11/11).
#
# CÁCH LÀM, cho từng bản api đang chạy:
#   1. bật thêm MỘT bản mới (ảnh mới) bên cạnh, chờ nó trả /health;
#   2. chờ caddy hỏi lại DNS (`refresh 10s` trong Caddyfile) để thấy bản mới;
#   3. `docker stop` bản cũ: api nhận SIGTERM, trả mọi response kèm
#      `Connection: close` 10 giây cho caddy bỏ kết nối cũ, rồi đóng cổng và
#      phục vụ nốt request đang chạy (src/common/tat-em.ts). Caddy nối vào bản
#      đã đóng thì thử bản khác (`lb_try_duration`).
# Lúc nào cũng còn ít nhất N bản nghe cổng, đỉnh RAM chỉ thêm một bản api.
#
# Bản mới không lên được thì xoá nó và dừng với mã 1: các bản cũ vẫn chạy ảnh
# cũ, API không sập vì một bản build hỏng như khi tạo lại cả cụm.
set -euo pipefail

P="${1:?thiếu tên project compose (zoldify | zoldify-staging)}"
dc() { docker compose -p "$P" "$@"; }

# Bản mới phải trả /health trong chừng này giây, không thì coi như hỏng.
CHO_KHOE_GIAY="${CHO_KHOE_GIAY:-120}"
# Caddyfile `dynamic a ... refresh 10s`, cộng 2 giây dư.
CHO_DNS_GIAY="${CHO_DNS_GIAY:-12}"
# Lớn hơn 10 + 15 giây api cần để tắt êm, khớp stop_grace_period trong compose.
TAT_GIAY="${TAT_GIAY:-45}"

khoe() {
  docker exec "$1" node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
    >/dev/null 2>&1
}

cho_khoe() {
  local id="$1" giay=0
  while [ "$giay" -lt "$CHO_KHOE_GIAY" ]; do
    # Container chết rồi được `restart: unless-stopped` dựng lại thì exec vẫn
    # có lúc chạy được; đếm số lần khởi động lại để không nhận nhầm là khoẻ.
    if [ "$(docker inspect -f '{{.RestartCount}}' "$id")" != "0" ]; then
      return 1
    fi
    if khoe "$id"; then return 0; fi
    sleep 2
    giay=$((giay + 2))
  done
  return 1
}

echo "== build ảnh mới (các bản api đang chạy giữ ảnh cũ) =="
dc build

echo "== bật lại mọi dịch vụ trừ api và caddy; migrate chạy xong trước worker =="
# Đọc danh sách ra biến trước: lỗi trong `< <(...)` không làm set -e dừng, và
# danh sách rỗng thì `dc up -d` trần tạo lại CẢ cụm, đúng thứ script này tránh.
DICH_VU=$(dc config --services)
mapfile -t KHAC < <(echo "$DICH_VU" | grep -v -x -e api -e caddy)
if [ "${#KHAC[@]}" -eq 0 ] || ! echo "$DICH_VU" | grep -qx api; then
  echo "::error::đọc danh sách dịch vụ compose không ra: $DICH_VU" >&2
  exit 1
fi
dc up -d "${KHAC[@]}"

mapfile -t CU < <(dc ps -q api)
N=${#CU[@]}
if [ "$N" -eq 0 ]; then
  echo "== chưa có bản api nào chạy: bật mới =="
  dc up -d --no-deps api
else
  echo "== thay lần lượt $N bản api =="
  for cu in "${CU[@]}"; do
    truoc=$(dc ps -q api | sort)
    dc up -d --no-deps --no-recreate --scale "api=$((N + 1))" api
    moi=$(comm -13 <(echo "$truoc") <(dc ps -q api | sort) | head -n 1)
    if [ -z "$moi" ]; then
      echo "::error::không bật được bản api mới" >&2
      exit 1
    fi
    if ! cho_khoe "$moi"; then
      echo "::error::bản api mới không khoẻ sau ${CHO_KHOE_GIAY}s, giữ nguyên các bản cũ" >&2
      docker logs --tail 40 "$moi" >&2 || true
      docker rm -f "$moi" >/dev/null || true
      exit 1
    fi
    echo "bản mới ${moi:0:12} khoẻ, chờ caddy thấy nó rồi tắt bản cũ ${cu:0:12}"
    sleep "$CHO_DNS_GIAY"
    docker stop -t "$TAT_GIAY" "$cu" >/dev/null
    docker rm "$cu" >/dev/null
  done
fi

# Caddyfile gắn bằng bind mount MỘT file: git checkout ghi file mới (inode mới)
# nên container caddy vẫn đọc bản cũ, `caddy reload` không thấy gì. Có đổi thì
# phải tạo lại container, mất kết nối khoảng 1 giây, chỉ ở lần deploy đó.
echo "== caddy =="
if [ -n "$(dc ps -q caddy)" ] \
  && ! dc exec -T caddy cat /etc/caddy/Caddyfile | cmp -s - Caddyfile; then
  echo "Caddyfile đổi: tạo lại container caddy"
  dc up -d --no-deps --force-recreate caddy
else
  dc up -d --no-deps caddy
fi

dc ps api
