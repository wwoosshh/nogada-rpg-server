# syntax=docker/dockerfile:1
#
# 서버 이미지. **빌드 문맥은 리포지토리 루트다** — pnpm 워크스페이스라
# apps/server 만으로는 아무것도 세울 수 없다:
#
#   docker build -f apps/server/Dockerfile -t nogada-server .
#
# 왜 Debian slim(bookworm)인가: `@node-rs/argon2` 는 네이티브 모듈이고 미리
# 빌드된 바이너리를 골라 받는다. glibc 판(`linux-x64-gnu`·`linux-arm64-gnu`)은
# 잠금 파일에 그대로 들어 있어서 컴파일러 없이 붙는다. musl(Alpine) 판도 있지만
# 확인하지 않은 채 고르면 "미니PC 에서만 로그인이 안 되는" 종류의 사고가 되고,
# 그 차이를 아낀 대가는 이미지 몇십 MB 뿐이다.
#
# 왜 tsx 로 실행하는가(컴파일하지 않는가): 이 워크스페이스의 패키지들은 TS
# 소스를 그대로 진입점으로 내놓는다(`@nogada/data`·`@nogada/shared` 의
# `main: ./src/index.ts`). 컴파일 산출물로 바꾸려면 세 패키지의 package.json 과
# 참조 빌드를 배포 전용으로 갈라야 하는데, 그러면 **개발에서 도는 코드와 배포에서
# 도는 코드가 다른 경로로 만들어진다.** 지금 필요한 것은 미니PC 한 대에서 도는
# 서버이지 부팅 200ms 가 아니다 — 같은 실행기로 두어 갈라질 자리를 만들지 않는다.

FROM node:22-bookworm-slim AS build
WORKDIR /app

# pnpm 은 판을 박아 둔다. 잠금 파일을 만든 것과 다른 pnpm 이 잠금 파일을 다시
# 해석하면, 개발 PC 와 미니PC 에 서로 다른 의존성이 깔릴 수 있다.
RUN npm install --global pnpm@10.11.0

# 매니페스트만 먼저 복사한다 — 소스를 한 줄 고칠 때마다 의존성을 다시 받지
# 않도록. apps/client/package.json 은 코드가 아니라 잠금 파일 검증용이다.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/data/package.json packages/data/
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/

# 서버와 그것이 기대는 워크스페이스 패키지만 깐다(`...` 이 의존 패키지를 함께
# 고른다). 클라이언트(Phaser·Vite·Capacitor)는 서버 이미지에 들어갈 이유가 없다.
# devDependencies 를 남기는 이유는 tsx 가 여기 있기 때문이다 — 실행기다.
RUN pnpm install --frozen-lockfile --filter "@nogada/server..."

COPY packages/ packages/
COPY apps/server/ apps/server/

# **이미지 안에서 데이터를 굽는다.** CSV·TMX·대사 파일에서 gamedata.json 과 맵
# JSON 이 나오고, 그것이 없으면 서버는 부팅 중에 죽는다. 호스트에서 만든 것을
# 복사해 오지 않는 이유는 그러면 이미지의 내용이 빌드한 사람의 작업 폴더 상태에
# 달리기 때문이다.
RUN pnpm data:build

# ---------------------------------------------------------------------------

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3000

# 배포된 서버가 자기 커밋을 말할 수 있어야 원격에서 배포를 검증한다.
# `.git` 은 빌드 문맥에서 빠져 있으므로(.dockerignore) 이미지가 스스로 물을 수
# 없다 — 빌드하는 쪽(docker-compose.prod.yml)이 값을 넣어 준다. 기본값
# `unknown` 은 이 인자 없이 손으로 빌드했을 때를 표시한다.
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA

# 빌드 단계에서 만든 것만 옮긴다. pnpm 자체와 전역 스토어(중복된 패키지 사본)는
# 여기 오지 않는다. `node` 사용자(uid 1000)는 base 이미지에 이미 있다 —
# 루트로 도는 서버는 컨테이너를 벗어나는 사고의 첫 단추다.
COPY --from=build --chown=node:node /app /app

WORKDIR /app/apps/server
USER node
EXPOSE 3000

# 살아 있는가를 서버 자신에게 묻는다. curl 을 깔지 않는 이유는 이미 node 가
# 있기 때문이고(fetch 는 내장이다), 이미지에 든 프로그램이 적을수록 좋다.
# /api/health 는 저장소에도 한 번 묻는다 — DB 가 끊기면 여기서 503 이 온다.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# 마이그레이션을 돌리고 서버를 띄우는 것은 엔트리포인트의 일이다(설계 규범 9).
ENTRYPOINT ["/bin/sh", "/app/apps/server/docker-entrypoint.sh"]
