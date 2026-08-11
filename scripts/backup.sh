#!/bin/sh
# 백업은 한 줄이다 — pg_dump 하나가 계정·세션·캐릭터 전부를 담는다.
#
#   ./scripts/backup.sh                  # backups/nogada-YYYYmmdd-HHMMSS.sql.gz
#   ./scripts/backup.sh /mnt/usb/오늘.sql.gz
#
# 복원(서버를 내린 뒤에 한다 — 켜 둔 채로 부으면 지금 놀고 있는 사람의 상태와 섞인다):
#
#   docker compose -f docker-compose.prod.yml stop server
#   gunzip -c backups/nogada-20260811-030000.sql.gz | \
#     docker compose -f docker-compose.prod.yml exec -T db psql -U nogada -d nogada
#   docker compose -f docker-compose.prod.yml start server
#
# **볼륨은 백업이 아니다.** 네임드 볼륨은 컨테이너를 지워도 남지만 디스크가
# 죽으면 함께 죽고, `down -v` 한 번이면 사라진다. 이 파일을 다른 기계(USB·
# 다른 PC)로 옮겨 두는 것까지가 백업이다.
set -e

cd "$(dirname "$0")/.."

COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.prod.yml}
OUT=${1:-backups/nogada-$(date +%Y%m%d-%H%M%S).sql.gz}

mkdir -p "$(dirname "$OUT")"

# -T 를 붙이는 이유: cron 에는 터미널이 없다. 빼면 "the input device is not a
# TTY" 로 새벽마다 조용히 실패한다.
docker compose -f "$COMPOSE_FILE" exec -T db \
  pg_dump -U "${POSTGRES_USER:-nogada}" "${POSTGRES_DB:-nogada}" | gzip >"$OUT"

# 크기를 함께 찍는다. 0 바이트짜리 백업은 백업이 있다는 착각만 남기므로,
# cron 메일이든 로그든 사람이 훑을 때 그 자리에서 이상을 보게 한다.
echo "백업 완료: $OUT ($(wc -c <"$OUT") 바이트)"
