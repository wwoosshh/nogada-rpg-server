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

[WinSW](https://github.com/winsw/winsw/releases) 로 서비스를 만든다
(`WinSW-x64.exe`). **node 를 직접 등록한다** — `pnpm` 이나 배치 파일을 등록하면
중간 프로세스가 끼어 종료 신호가 서버까지 가지 않고, 그러면 저장소
드레인(`index.ts` 의 SIGTERM 훅)이 돌지 않는다.

WinSW 는 **자기와 이름이 같은 XML** 을 읽는다. 받은 exe 를 그 이름으로 놓는다:

```powershell
New-Item -ItemType Directory -Force C:\nogada-server\logs | Out-Null
Move-Item .\WinSW-x64.exe C:\nogada-server\nogada-server.exe
```

`C:\nogada-server\nogada-server.xml` 을 이 내용으로 만든다:

```xml
<service>
  <id>nogada-server</id>
  <name>nogada-server</name>
  <description>노가다RPG 게임 서버</description>

  <executable>C:\Program Files\nodejs\node.exe</executable>
  <arguments>--env-file=.env --import tsx src/index.ts</arguments>
  <workingdirectory>C:\nogada-server\nogada-rpg-server\apps\server</workingdirectory>

  <startmode>Automatic</startmode>
  <depend>postgresql-x64-17</depend>
  <onfailure action="restart" delay="10 sec"/>

  <logpath>C:\nogada-server\logs</logpath>
  <log mode="roll-by-size">
    <sizeThreshold>10240</sizeThreshold>
    <keepFiles>5</keepFiles>
  </log>

  <env name="GIT_SHA" value=""/>
</service>
```

네 줄이 각각 컨테이너가 공짜로 해 주던 일을 대신한다:

- **`<depend>`** — `depends_on` 자리다. 없으면 재부팅 때 서버가 DB 보다 먼저 떠
  연결 실패로 죽는다. 서비스 이름은 `Get-Service postgresql*` 로 확인한다
  (주 버전이 다르면 `postgresql-x64-18` 같은 다른 이름이다).
- **`<onfailure>`** — `restart: unless-stopped` 자리다.
- **`<log mode="roll-by-size">`** — 로깅 드라이버의 `max-size: 10m` 자리다.
  `sizeThreshold` 는 **KB** 단위라 10240 이 10MB 다. 없으면 파일 하나가 무한히
  자라 SSD 를 채운다. 파일은 `logs\nogada-server.out.log`(+`.err.log`)로 나온다.
  **여기에 요청 로그가 쌓인다** — 서비스로 도는 서버는 `LOG_LEVEL` 을 안 적어도
  기본이 `info` 다(`config.ts` 의 isDevConsole: stdout 이 사람 보는 콘솔이 아니라
  이 파일로 흘러가므로 켜는 쪽이 기본이다). 자격증명은 `[가려짐]` 으로 지워져
  남지만, 누가 언제 어디를 두드렸는지의 기록이므로 이 파일은 남에게 주지
  않는다. 조용히 하고 싶으면 `.env` 에 `LOG_LEVEL=warn`.
- **`<env name="GIT_SHA" value=""/>`** — 이미지에 새기던 커밋 자리다. **빈 값으로
  두는 것이 맞다**: 배포 워크플로가 매번 이 원소의 `value` 를 그날 커밋으로
  갈아 끼우고(7장), 그래야 `/api/health` 가 자기 커밋을 말할 수 있다. 이
  원소를 빠뜨리면 배포가 "GIT_SHA env 원소가 없다"로 선다.

등록하고 띄운다 — **관리자 권한 창**이어야 한다:

```powershell
C:\nogada-server\nogada-server.exe install
C:\nogada-server\nogada-server.exe start
```

확인:

```powershell
Get-Service nogada-server
Invoke-RestMethod http://localhost:3000/api/health
```

---

## 5. 되돌리는 길

전환이 잘못되면 서비스를 멈추고 컨테이너를 다시 올린다. 이 순서면 데이터도
안전하다 — 컨테이너 DB 볼륨(`nogada-prod-db`)은 지우지 않았으므로 그대로 있다:

```powershell
C:\nogada-server\nogada-server.exe stop
cd C:\nogada-server\nogada-rpg-server
docker compose -f docker-compose.prod.yml up -d
```

서비스 등록 자체를 물리려면 `nogada-server.exe uninstall` 이다. 멈추기만 하면
재부팅 때 자동 시작이 되살아나 3000 을 두고 컨테이너와 싸운다.

**Docker Desktop 은 전환이 며칠 안정된 뒤에 지운다.** 되돌릴 길을 먼저 없애지
않는다.

---

## 6. 겪은 함정 (전환 중 실측)

전환하며 실제로 시간을 쓴 것들이다. 증상만 보고는 원인을 찾기 어려운 것들이라
적어 둔다.

- **Node.js 차단 방화벽 규칙이 허용 규칙을 이긴다.** 컨테이너 시절에는 Docker
  Desktop 이 자기 이름으로 포트를 열어 줬는데, `node.exe` 가 직접 3000 을 잡자
  예전에 눌린 "차단"이 드러났다. 증상은 **로컬은 되는데 밖에서만 안 되는 것**
  이고, `netstat` 은 `0.0.0.0:3000 LISTENING` 이라 멀쩡해 보인다. 포트 허용 규칙을
  아무리 더해도 소용없다 — **차단이 우선**이라 그것부터 지워야 한다:

  ```powershell
  Get-NetFirewallApplicationFilter -Program "*node.exe*" | Get-NetFirewallRule |
    Where-Object Action -eq Block | Remove-NetFirewallRule
  ```

- **`--env-file` 은 이미 있는 환경변수를 덮어쓰지 않는다.** 시험 실행(3장)에서
  `$env:PORT='3001'` 을 넣은 창에서 그대로 서버를 다시 띄우면 `.env` 의
  `PORT=3000` 이 아니라 3001 로 뜬다. 창을 새로 열거나 `Remove-Item Env:PORT` 로
  지운다. 서비스로 등록한 뒤에는 이 문제가 없다 — 새 프로세스라 세션 변수가 없다.

- **관리자 계정은 다른 계정 소유의 저장소에서 git 을 못 돌린다**(dubious
  ownership). 서비스 등록을 관리자 창에서 하면서 `git rev-parse HEAD` 가 조용히
  실패해 `GIT_SHA` 가 비었고, `/api/health` 가 `sha: dev` 를 돌려줬다. 예외를
  등록한다:

  ```powershell
  git config --global --add safe.directory C:/nogada-server/nogada-rpg-server
  ```

- **nssm.cc 다운로드가 자주 막힌다**(`winget install NSSM.NSSM` 이
  `0x80072ee2` 로 실패). 그래서 GitHub 릴리스에서 받는 WinSW 로 갈아탔다 —
  4장이 그 절차다. 서비스 래퍼로서 하는 일은 같고, 설정이 명령 나열 대신
  XML 한 장이라 배포가 기계적으로 고쳐 쓸 수 있다(`GIT_SHA`).

## 7. 배포 자동화

`.github/workflows/deploy.yml` 의 미니PC job 이 컨테이너 대신 서비스를 다룬다.
단계는 이렇다:

1. 배포 폴더·`.env`·서비스 존재 확인
2. `git reset --hard origin/main`
3. `pnpm install --frozen-lockfile --filter "@nogada/server..."` — **옛 서버가
   아직 도는 동안** 그 `node_modules` 를 갈아 치운다. 이미 적재된 모듈은 무해
   하지만, 그 창에서 지연 `import()` 나 네이티브 바인딩(`@node-rs/argon2`)을
   처음 부르는 요청이 있으면 터질 수 있다. 인플레이스 배포에 딸린 노출이고,
   지금 규모(동시 접속 한 자리)에서는 받아들인다 — 무중단이 필요해지면 그때
   폴더 두 개를 번갈아 쓰는 방식으로 바꾼다.
4. `pnpm data:build` — CSV·TMX 에서 gamedata.json 을 굽는다(없으면 서버가 부팅 중 죽는다)
5. `pnpm --filter @nogada/server migrate up` — 스키마부터, **서비스를 건드리기
   전에**. 실패하면 여기서 멈춰 옛 서버가 계속 돈다
6. WinSW XML 의 `GIT_SHA` 를 이번 커밋으로 갈고 `nogada-server.exe restart`
7. `/api/health` 가 `ok:true` **와 그 커밋의 sha** 를 함께 줄 때까지 90초 대기

**7번이 컨테이너 시절과 다른 점이다.** 네이티브에서는 재시작이 조용히 실패해도
옛 프로세스가 계속 3000 을 쥔 채 `ok:true` 를 준다 — 커밋까지 대조해야 이 배포가
실제로 올라간 것이 된다.

### 게임 화면(dist)은 이 자동화에 없다

**이 워크플로는 서버만 올린다.** 클라이언트를 빌드하지도 복사하지도 않으므로,
화면을 바꾼 릴리스는 배포가 초록이어도 **옛 화면이 그대로 뜬다.** 이 단계를 여기에
못 넣는 이유는 라이선스 에셋이다 — 이 PC 에도 GitHub 러너에도 그림이 없어서
(6장의 "미니PC 는 그림을 모른다") 여기서 빌드하면 그림 없는 사이트가 올라간다.

그래서 화면은 **그림을 가진 개발 PC 에서 사람이 밀어 넣는다.** 개발 PC 에서:

```powershell
pwsh -File scripts/ship-client.ps1 -Destination '\\100.125.30.85\c$\nogada-server\nogada-rpg-server\apps\client\dist'
```

받는 자리가 `apps\client\dist` 인 것은 우연이 아니다: 그 폴더는 gitignore 대상이라
2번의 `git reset --hard` 가 안 건드리고, `git clean` 은 이 워크플로가 일부러 안
돌린다(`.env` 와 node_modules 가 거기 있다). 서버는 그 자리를 기본값으로 읽으므로
(`CLIENT_DIST`) `.env` 에 한 줄도 안 적어도 된다.

**서비스를 재시작할 필요는 없다** — 다음 요청부터 새 화면이 나간다. 사이트가
404 이거나 화면이 안 바뀌면 먼저 볼 곳은 `logs\nogada-server.out.log` 의 기동 줄:
dist 를 못 찾았으면 "클라이언트 dist 가 없어 정적 서빙을 붙이지 않는다" 와 함께
서버가 찾아본 경로가 적혀 있다. 자세한 것은 `docs/deploy-public.md` 6단계.

### 러너 권한

서비스 제어(`restart`)에는 권한이 필요하다. self-hosted 러너가 일반 사용자
계정으로 돌면 6번에서 "액세스가 거부되었습니다" 로 선다. **그 편이 조용히
넘어가는 것보다 낫다** — 배포가 초록인데 옛 코드가 도는 것이 가장 나쁘다.

첫 배포에서 그 오류가 나면 둘 중 하나를 고른다:

- 러너 서비스의 로그온 계정을 관리자 권한이 있는 것으로 바꾼다(`services.msc`).
  그 경우 `git config --system --add safe.directory` 로 그 계정의 예외도 함께 건다.
- 또는 `sc.exe sdset` 으로 러너 계정에 이 서비스만 제어 권한을 준다(범위가
  좁은 대신 명령이 길고, 잘못 쓰면 서비스를 아무도 못 만지게 되므로 먼저
  `sc.exe sdshow nogada-server` 로 현재 값을 적어 둔다).
