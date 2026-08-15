# 계정·캐릭터·DB 설계 — 게임의 문

**날짜:** 2026-08-10
**상태:** 설계 승인됨(사용자: ID/비밀번호, 생성 시 외형+시작 마을 선택), 깨끗한 세션 평가 전
**전제:** `PlayerStore.get/save` 인터페이스(M4 교체 예고), `LOCAL_PLAYER_ID` 단일
교체 지점, `ConnectionGate` 부팅 관문, `VITE_API_BASE_URL`/`PORT` env 준비됨.

---

## 1. 목표

게임을 열면 입장 화면이 있고, 로그인하면 내 캐릭터로 이어서 하고, 없으면
캐릭터를 만든다 — 이름, **외형**(여럿 중 선택), **시작 마을**(넷 중 선택; 마을이
곧 첫 숙련도 정체성이다). 저장은 PostgreSQL 로, 서버는 나중에 다른 PC·클라우드로
옮겨도 그대로 돈다.

## 2. DB — PostgreSQL + JSONB

```sql
users      (id BIGSERIAL PK, username TEXT UNIQUE, pw_hash TEXT, created_at)
sessions   (token TEXT PK, user_id FK, expires_at)
characters (id BIGSERIAL PK, user_id FK UNIQUE, name TEXT, state JSONB, updated_at)
```

- **캐릭터는 계정당 하나**(v1). `state JSONB` = `PlayerState` 통째.
  **`PlayerStateSchema`(zod)가 계속 진실의 원본** — 읽을 때 `safeParse`, 기존
  세이브 호환 장치(기본값)가 그대로 작동. 정규화 분해는 실제 쿼리 필요가 생길 때.
- 마이그레이션: SQL 파일 + `node-pg-migrate`. 드라이버 `pg`(풀).
- **개발 폴백:** `DATABASE_URL` 없으면 지금처럼 JSON 파일(계정·세션·캐릭터 포함
  한 파일). 로컬 개발은 docker 없이도 돈다. 저장 계층은 인터페이스 하나
  (`Persistence`)에 구현 둘 — `PlayerStore` 전례의 확장.

## 3. 인증 — ID/비밀번호 + 서버 보관 세션 토큰

- 비밀번호: **argon2id** 해시. 규칙: 아이디 3~16자(영문·숫자·한글), 비밀번호 8자+.
- 토큰: 불투명 256-bit 랜덤, `sessions` 테이블 보관, TTL 30일(사용 시 연장).
  `Authorization: Bearer <token>` 헤더 — 쿠키가 아니라 Capacitor(모바일)에서도
  CORS 문제없음. 로그아웃 = 세션 행 삭제.
- 인증 API: `POST /api/auth/register` · `POST /api/auth/login` (→ `{token}`),
  `POST /api/auth/logout`, `GET /api/me` (→ `{ character: PlayerState | null }`),
  `POST /api/me/character` `{name, appearance, village}` (→ `PlayerState`).
- **모든 게임 라우트가 세션의 캐릭터로 판정한다** — `LOCAL_PLAYER_ID` 제거.
  인증 실패 = 401, 클라이언트는 로그인 화면으로.
- 가입·로그인에 IP당 단순 레이트리밋(메모리, 단일 인스턴스 가정).

## 4. 캐릭터 생성

- **이름**: 2~12자, 캐릭터 간 유일 강제는 하지 않음(표시용; 유일성은 계정 아이디가 담당).
- **외형**: 허용 외형 목록은 `packages/shared` 상수(`APPEARANCES` — id 목록).
  서버가 검증한다(임의 문자열 거부). 클라이언트 매니페스트가 id→시트 파일을
  연결(기존 `npcSprites.ts` 결). 시트는 Pipoya 캐릭터 팩에서 6~8종 추출
  (gitignore + `CREDITS.md` 레시피 — 기존 규칙). **지금은 순수 외형이다** —
  직업 시스템이 생기면 이 선택 위에 얹는다(훅).
- **시작 마을**: {눈의마을, 숲의마을, 항구마을, 북동쪽마을} 중 하나. 서버가
  검증하고 `location` 을 그 맵의 스폰(`GameData.maps[id].spawn`)으로 심는다.
  화면에는 마을별 대표 숙련도(얼음/나무/허브/광물)와 한 줄 소개를 보여준다 —
  "시작 마을 = 첫 숙련도" 설계가 여기서 플레이어에게 드러난다.
- `PlayerState` 에 `name: string`, `appearance: string` 추가 — 스키마 기본값
  (`'player'` 등)으로 기존 세이브 보존(기존 규칙).
- 클라이언트 `WorldScene` 이 하드코딩 `player.png` 대신 캐릭터의 외형 시트를 쓴다.

## 5. 화면 흐름 (React DOM, 기존 게이트 확장)

```
타이틀(입장) → 로그인 ⇄ 가입 → GET /api/me
   ├─ character 있음 → 상태 로드 → Phaser 부팅 (기존 흐름)
   └─ 없음 → 캐릭터 생성(이름·외형 미리보기·마을 카드) → POST → 부팅
```

- 토큰은 localStorage. 앱 재시작 시 토큰 있으면 타이틀에서 "이어서 하기".
  401 응답 일괄 처리 → 토큰 폐기 → 로그인 화면.
- 스타일은 기존 DOM 규칙(tokens.css, Neo둥근모). 외형 미리보기는 시트의 대기
  프레임 표시(캔버스 불필요, CSS 스프라이트 크롭).

## 6. 배포 준비 (이 스펙의 범위)

- 서버 env: `PORT`, `DATABASE_URL`, `CORS_ORIGIN`(허용 출처 목록), `.env.example` 제공.
- 서버 Dockerfile + docker-compose(서버+Postgres). 클라이언트는
  `VITE_API_BASE_URL` 로 원격 서버 지정(이미 있음).
- 배포 문서: **라이선스 에셋은 저장소에 없다** — 클라 빌드는 `CREDITS.md` 복원
  절차를 수행한 PC에서만 가능함을 명시(서버 배포에는 에셋 불필요).
- GitHub private 푸시와 원격 접속 리허설은 계획 단계(A5)로 — 저장소 생성은
  사용자 계정 필요.

## 7. 무엇을 안 하는가

- 소셜 로그인 / 이메일 인증·비밀번호 찾기(운영 전 도입) / 캐릭터 복수 슬롯 /
  직업 능력치(외형은 순수 외형) / 다른 플레이어 표시(presence) / Postgres 전환
  후 JSON 폴백 제거(당분간 공존).

## 8-앞. 깨끗한 세션 평가 반영 (규범 — 위 절과 충돌하면 이 절이 이긴다)

**자료 무결성**
1. **Lost update 방지는 인터페이스 계약이다.** 비동기 전환으로 get→계산→save
   사이에 다른 요청이 끼어들 수 있게 된다. Postgres: `UPDATE … WHERE user_id=$1
   AND updated_at=$3` (0행이면 재시도/409). JSON 폴백: 캐릭터별 직렬화 큐.
2. **`get` 은 없으면 null 이다.** 캐릭터 생성은 오직 `POST /api/me/character`.
   상태 파싱 실패 = 500 + 행 보존 + 로그 (지금의 "조용히 버리고 새로 만들기"를
   이 시점에 뒤집는다 — store.ts 주석이 예고한 그 순간이다).
3. 읽기 계약에 `resolvePlayerLocation`(없어진 맵 복구) 포함 — 양쪽 구현 모두.
4. `name`·`appearance` 는 state 가 원본, `characters.name` 칼럼은 저장 시 미러.
   `PlayerState.id` 는 읽기 계층이 `characters.id` 로 도장 찍는다(불일치 봉쇄).
   외형 id 는 불투명 id + 클라 매니페스트(스프라이트 금지 규칙의 명시적 탈출구)
   — `APPEARANCES` ↔ 매니페스트 전수 대조 테스트 필수.

**인증 세부**
5. 세션에는 **`sha256(토큰)`** 을 저장(DB 유출 ≠ 세션 탈취). TTL 연장은 잔여
   7일 미만일 때만(요청마다 쓰기 방지). 아이디는 NFC 정규화+trim+casefold 후
   UNIQUE 비교. 비밀번호 최대 128자(argon2 CPU DoS 방지), argon2id 파라미터
   고정, 라이브러리는 `@node-rs/argon2`(윈도 개발+리눅스 배포 양쪽 프리빌드).
6. 로그인 실패는 단일 메시지 + 없는 계정에도 더미 해시 검증(타이밍 열거 방지).
   가입의 아이디 중복 노출은 수용(명시). 레이트리밋은 IP당 + **계정당** 백오프,
   맵 크기 유계. 중복 경합은 23505 로: 가입 409, 캐릭터 생성은 기존 반환
   (이중 제출 자연 처리) — JSON 폴백은 직렬화 쓰기 안에서 같은 검사.
   비밀번호 찾기 없음 = 잊으면 계정 사망, 수용(명시). localStorage 수용.
7. `DELETE /api/me/character` (이름 타이핑 확인) 추가 — 슬롯 하나에 삭제가
   없으면 잘못 만든 선택이 영구히 갇힌다.

**배포 현실**
8. **TLS 없이는 LAN 밖 금지.** `capacitor.config.ts` 의 "M4 에 https 전환·
   allowMixedContent 제거" 약속이 이번에 이행된다. 리버스 프록시 TLS 종단,
   Fastify `trustProxy` 는 실제 토폴로지에 맞춰 고정(잘못 켜면 리미터 무력화).
9. compose: Postgres healthcheck + `depends_on: service_healthy`, 기동 시
   `migrate up` 실행 주체 명시(엔트리포인트), 네임드 볼륨 + `pg_dump` 백업 한 줄,
   SIGTERM 에 풀 드레인(onClose). CORS 허용 목록은 기존 `exposedHeaders:
   ['x-server-now']`(시계 동기화!) 유지 + `https://localhost`.
   > **되쓰기(커밋 5399ff8).** 이 줄은 오래 `capacitor://localhost`·
   > `http://localhost` 를 시켰는데 **틀렸다.** 안드로이드 WebView 의 오리진은
   > `https://localhost` 다(Capacitor 의 `androidScheme` 기본값이 `https`,
   > CapConfig.java 의 `hostname = "localhost"`). `capacitor://` 는 **iOS 스킴**
   > 이고 이 저장소에 iOS 는 없다. 실서버 preflight 실측이 정확히 뒤집혀 있어서
   > (`capacitor://localhost` 허용, `https://localhost` 차단) 그대로 APK 를
   > 만들었으면 앱만 CORS 에서 막혔다. `http://localhost` 도 마찬가지로
   > `androidScheme: 'http'` 를 적는 날에만 필요하다.

**정직한 검증**
10. §8.4 는 계약 스위트 하나를 두 구현에 매개변수화하되, Postgres 케이스는
    `describe.skipIf(!TEST_DATABASE_URL)` — **완료 관문: 실제 Postgres 로 한 번
    돌린 출력 첨부.** CI 없음을 인정하고 관문으로 대체한다.
11. **첫 태스크는 기존 서버 테스트의 인증화다** — `app.test.ts` 33건 전부가
    암묵 'local' 주입이라, 가입/로그인 헬퍼 + Bearer 를 먼저 깔아야 이후 작업이
    그 위에 앉는다.

**클라이언트 세부**
12. 401 처리는 `GameClient.request()` 한 곳에서(토큰 폐기→타이틀). 부팅 호출에
    `AbortSignal.timeout` (걸린 서버가 타이틀을 영원히 잡는 것 방지). 화면 상태
    셋 구분: 토큰 없음 / 토큰 거부 / 서버 불통.
13. 외형은 WorldScene 세 곳(preload·sprite·walk 애니메이션)에서 키가 하드코딩
    — 맵 전환마다 재시작하므로 preload 전에 외형이 결정되어야 한다. 모든 외형
    시트는 player.png 와 같은 96×128 3×4 규격임을 추출 시 검증.
14. 마을→숙련도 대응은 카드에 하드코딩하지 않는다 — `maps.csv` 칼럼 또는 빌드
    유도(transitions 로부터), 어긋나면 빌드 실패.
15. 기존 `.data/players.json` 개발 세이브는 **이관하지 않고 폐기**(명시).

## 8. 성공 기준

1. 새 기기에서: 타이틀 → 가입 → 캐릭터 생성(외형·마을 고름) → 고른 마을 스폰에서
   고른 외형으로 시작.
2. 재접속: 타이틀 → 이어서 하기 → 내 캐릭터 그대로 (진행도·가방·위치).
3. 두 계정이 같은 서버에서 서로 다른 진행도로 공존(테스트로 증명).
4. `DATABASE_URL` 을 주면 Postgres, 빼면 JSON — 동일 테스트 스위트가 양쪽에서 통과.
5. 잘못된 토큰/만료 토큰은 401 → 클라이언트가 로그인으로 안내.
6. 작업 PC 서버 + 다른 기기 클라(`VITE_API_BASE_URL`)로 원격 접속 리허설 성공.
