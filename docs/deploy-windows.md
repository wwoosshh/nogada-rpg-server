# 윈도 미니PC 네이티브 배포

**Docker 없이** 윈도에서 서버를 직접 돌리는 절차다. 서버 PC 가 Windows 11 Pro
한 대이므로, 리눅스 컨테이너를 돌리려고 WSL2 VM 을 얹는 계층을 없앤다 —
실측으로 그 계층이 2.5~2.9GB 를 물고 있었다(VmmemWSL 2,489MB + Docker Desktop
프로세스 387MB).

기존 `docs/deploy.md` 는 컨테이너 배포 절차다. 그쪽 구성(Dockerfile·compose)은
저장소에 남겨 둔다 — 언젠가 리눅스 서버로 옮길 때 되살릴 자산이고, 지우는 것이
이 전환의 목적이 아니다.

**전환은 두 단계다.** 1단계에서 네이티브 서버를 **다른 포트(3001)로 세워 확인**
하고, 그 동안 게임은 컨테이너(3000)에서 계속 돈다. 2단계에서만 자리를 바꾼다 —
실패하면 컨테이너를 그대로 두고 물러설 수 있다.

---

## 0. 준비 확인

```powershell
node -v      # v22.x 여야 한다
pnpm -v      # 10.11.0 (Dockerfile 이 박아 둔 판과 같게)
git --version
```

없으면 설치한다:

```powershell
winget install OpenJS.NodeJS.LTS
npm install --global pnpm@10.11.0
```

**왜 판을 맞추는가:** 잠금 파일을 만든 것과 다른 pnpm 이 그것을 다시 해석하면
개발 PC 와 서버에 서로 다른 의존성이 깔릴 수 있다(Dockerfile 이 pnpm 을 박아 둔
것과 같은 이유).

---

## 1. PostgreSQL 설치

[EDB 인스톨러](https://www.postgresql.org/download/windows/)로 **17.x** 를 받는다.
컨테이너가 쓰던 `postgres:17-alpine` 과 주 버전을 맞춘다 — 주 버전이 다르면
`pg_dump` 로 뜬 파일을 되돌릴 때 걸린다.

설치 중 정할 것:

- **비밀번호**: `apps/server/.env` 의 `POSTGRES_PASSWORD` 와 같게 두면 `.env` 를
  고칠 자리가 하나 줄어든다.
- **포트 5432**: 기본값 그대로. 컨테이너 DB 는 호스트로 포트를 열지 않으므로
  (prod compose) 지금 도는 것과 충돌하지 않는다.
- **서비스 자동 시작**: 인스톨러가 `postgresql-x64-17` 서비스로 등록한다 —
  재부팅 뒤 자동 시작이 여기서 무료로 딸려 온다(컨테이너의 `restart:
  unless-stopped` 자리).

설치 뒤 확인:

```powershell
Get-Service postgresql*
```

---

## 2. 데이터 옮기기

**컨테이너가 아직 도는 동안** 뜬다. 먼저 백업:

```powershell
cd C:\nogada-server\nogada-rpg-server
docker compose -f docker-compose.prod.yml exec -T db pg_dump -U nogada -d nogada --clean --if-exists > backup-migrate.sql
```

`-U`·`-d` 값은 `apps/server/.env` 의 `POSTGRES_USER`·`POSTGRES_DB` 다. 파일이
비어 있지 않은지 반드시 본다:

```powershell
(Get-Item backup-migrate.sql).Length
```

새 Postgres 에 DB 와 계정을 만들고 되돌린다(`psql` 은 설치 폴더의
`bin` 에 있다 — PATH 에 없으면 전체 경로로 부른다):

```powershell
$env:PGPASSWORD = '.env 의 POSTGRES_PASSWORD'
psql -U postgres -c "CREATE USER nogada WITH PASSWORD '같은 비밀번호';"
psql -U postgres -c "CREATE DATABASE nogada OWNER nogada;"
psql -U nogada -d nogada -f backup-migrate.sql
```

확인 — 캐릭터 수가 컨테이너 쪽과 같아야 한다:

```powershell
psql -U nogada -d nogada -c "SELECT count(*) FROM characters;"
```

---

## 3. 시험 실행 (포트 3001)

게임을 멈추지 않고 확인하는 단계다. `.env` 는 그대로 두고 이번 실행에만
포트와 DB 주소를 덮어쓴다:

```powershell
cd C:\nogada-server\nogada-rpg-server
pnpm install --frozen-lockfile --filter "@nogada/server..."
pnpm data:build
cd apps\server
$env:PORT = '3001'
$env:DATABASE_URL = 'postgresql://nogada:비밀번호@localhost:5432/nogada'
node --env-file=.env --import tsx src/index.ts
```

다른 창에서:

```powershell
Invoke-RestMethod http://localhost:3001/api/health
```

`ok:true` 가 나오면 **네이티브 서버가 새 DB 를 보고 살아 있다**는 뜻이다
(health 는 저장소에 한 번 묻고 온다). 확인했으면 `Ctrl+C` 로 멈춘다.

> `.env` 안의 `DATABASE_URL` 은 컨테이너 이름(`db`)을 가리키고 있다. 위에서
> 환경변수로 덮어쓴 이유가 그것이고, 3단계 전환 때 `.env` 자체를 `localhost` 로
> 고친다.

---

## 4. 전환 (서비스 등록 → 컨테이너 정지)

`.env` 의 `DATABASE_URL` 을 새 DB 로 고친다:

```
DATABASE_URL=postgresql://nogada:비밀번호@localhost:5432/nogada
```

**컨테이너를 먼저 내린다** — 3000 을 비워야 한다:

```powershell
cd C:\nogada-server\nogada-rpg-server
docker compose -f docker-compose.prod.yml down
```

[nssm](https://nssm.cc/download) 으로 서비스를 만든다. **node 를 직접 등록한다**
— `pnpm` 이나 배치 파일을 등록하면 중간 프로세스가 끼어 종료 신호가 서버까지
가지 않고, 그러면 저장소 드레인(`index.ts` 의 SIGTERM 훅)이 돌지 않는다:

```powershell
nssm install nogada-server "C:\Program Files\nodejs\node.exe"
nssm set nogada-server AppParameters "--env-file=.env --import tsx src/index.ts"
nssm set nogada-server AppDirectory "C:\nogada-server\nogada-rpg-server\apps\server"
nssm set nogada-server AppStdout "C:\nogada-server\logs\server.log"
nssm set nogada-server AppStderr "C:\nogada-server\logs\server.log"
nssm set nogada-server AppRotateFiles 1
nssm set nogada-server AppRotateBytes 10485760
nssm set nogada-server Start SERVICE_AUTO_START
nssm start nogada-server
```

`AppRotateFiles` 가 컨테이너의 로그 회전(`max-size: 10m`) 자리다 — 없으면 파일
하나가 무한히 자라 SSD 를 채운다.

확인:

```powershell
Invoke-RestMethod http://localhost:3000/api/health
```

---

## 5. 되돌리는 길

전환이 잘못되면 서비스를 멈추고 컨테이너를 다시 올린다. 이 순서면 데이터도
안전하다 — 컨테이너 DB 볼륨(`nogada-prod-db`)은 지우지 않았으므로 그대로 있다:

```powershell
nssm stop nogada-server
cd C:\nogada-server\nogada-rpg-server
docker compose -f docker-compose.prod.yml up -d
```

**Docker Desktop 은 전환이 며칠 안정된 뒤에 지운다.** 되돌릴 길을 먼저 없애지
않는다.

---

## 6. 배포 자동화

`.github/workflows/deploy.yml` 의 미니PC job 이 컨테이너 대신 서비스를 다룬다.
4단계까지 끝난 뒤에 그 파일을 바꾼다 — 먼저 바꾸면 준비가 안 된 서버로 배포가
가서 실패한다. 새 job 이 하는 일:

1. `git reset --hard origin/main`
2. `pnpm install --frozen-lockfile --filter "@nogada/server..."`
3. `pnpm data:build` — CSV·TMX 에서 gamedata.json 을 굽는다(없으면 서버가 부팅 중 죽는다)
4. `pnpm --filter @nogada/server migrate up` — 스키마부터. 실패하면 여기서 멈춰
   옛 서버가 계속 돈다
5. `nssm set nogada-server AppEnvironmentExtra GIT_SHA=<커밋>` → `nssm restart`
6. `/api/health` 의 `sha` 가 그 커밋인지 확인
