#!/bin/sh
# 컨테이너가 뜰 때마다 **마이그레이션을 먼저 돌리고** 서버를 띄운다(설계 규범 9).
#
# 왜 사람이 따로 돌리지 않는가: 미니PC 를 운영하는 사람은 한 명이고, 그 한 명이
# `docker compose up -d` 뒤에 마이그레이션 명령을 한 번 잊으면 서버는 없는
# 테이블을 향해 500 을 뱉는다. 없는 마이그레이션은 아무 일도 하지 않으므로
# (node-pg-migrate 가 `pgmigrations` 표를 보고 판단한다) 매 기동에 돌려도 안전하다.
#
# 왜 실패하면 서버를 띄우지 않는가: 스키마가 어긋난 채로 뜬 서버는 요청을 받아
# 자료를 반쯤 쓴다. 뜨지 않는 서버는 고칠 수 있지만, 반쯤 쓴 자료는 되돌리기
# 어렵다.
set -e

if [ -z "$DATABASE_URL" ]; then
  echo "DATABASE_URL 이 없다 — 배포 컨테이너는 PostgreSQL 로만 돈다(.env 를 확인)." >&2
  exit 1
fi

echo "마이그레이션 확인 중..."
node_modules/.bin/node-pg-migrate -m migrations up

# exec 로 바꿔치기해야 서버가 PID 1 이 되어 SIGTERM 을 직접 받는다. 이 셸이
# 중간에 남으면 신호가 서버까지 가지 않고, 그러면 풀 드레인(onClose)이 돌지
# 않은 채 10초 뒤 강제 종료된다.
#
# `tsx` 명령 대신 `node --import tsx` 인 이유도 같은 신호 이야기다: tsx 의 CLI 는
# 자식 node 를 하나 더 띄우고 신호를 건네주는 중개자라, 종료 코드가 143(신호로
# 죽었다)으로 남아 정상 종료와 강제 종료를 구분할 수 없다. 이렇게 띄우면 서버가
# 곧 PID 1 이고, 드레인을 마친 뒤의 exit 0 이 그대로 밖에 보인다.
exec node --import tsx src/index.ts
