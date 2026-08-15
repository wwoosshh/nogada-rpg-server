# 공개 배포 — 남에게 게임을 주고 밖에서 접속시키기

`docs/deploy-windows.md` 는 **서버 PC 한 대를 세우는** 절차다. 이 문서는 그 서버를
**인터넷에 열고 남에게 주소를 주는** 절차다. 둘은 다른 일이고, 이 문서가 뒤에 온다.

---

## 0. 지금 상태 — 밖에서는 아무도 못 닿는다

현재 접속 주소 `http://100.125.30.85:3000` 은 **Tailscale 사설 오버레이**다.
`100.64.0.0/10` 은 공개 인터넷에 라우팅되지 않는다. 이 주소를 남에게 알려 줘도
아무 일도 일어나지 않는다 — 상대가 Tailscale 을 깔고 이 tailnet 에 초대받아야만
닿는다.

**회선은 CGNAT 가 아닌 것으로 보인다**(공인 IP `58.233.102.165`, `tracert -h 4 -d
8.8.8.8` 의 2번째 홉이 같은 /24 공인 대역, 사설 홉 1개). 즉 포트포워딩이
기술적으로는 가능하다. 다만 아래에서 권하지 않는다.

> 함정: 같은 tracert 의 3번째 홉이 `100.87.45.45` 다. 이건 SKB 백본 내부 대역이지
> CGNAT 가 아니다. `100.64/10` 을 봤다고 CGNAT 로 읽으면 안 된다.

---

## 1. 결론

**Cloudflare Tunnel + 내 도메인**으로 열고, **웹 URL 로 배포한다**(APK 아님).
그리고 **서버가 클라이언트를 같은 오리진으로 서빙**한다.

같은 오리진이 이 조합의 핵심이다 — 그 하나로 혼합 콘텐츠·CORS·안드로이드 평문
차단·주소 재빌드가 **통째로 사라진다.** 각각을 따로 고치는 것보다 싸다.

| 경로 | 비용 | 난이도 | HTTPS | 집 IP 노출 | 판정 |
|---|---|---|---|---|---|
| **Cloudflare Tunnel + 내 도메인** | 도메인 연 1~2만원 | 중 | 자동 | **없음** | **추천** |
| Tailscale 초대 (현행) | 0 | 이미 됨 | 불필요(오버레이 암호화) | 없음 | 친구 5명 이하면 이것도 정답 |
| Tailscale Funnel | 0 | 낮음 | 자동(`ts.net`) | 없음 | 주소가 내 것이 아니다 — 검증용 |
| 포트포워딩 + Caddy | 0~1.5만원 | 중~상 | 직접 | **노출** | 비권장 |
| 정적 호스팅(CF Pages 등) | 0 | 중 | 페이지만 | 없음 | API HTTPS 가 선행 — 단계 두 배 |

**포트포워딩을 거르는 이유:** 접속하는 모든 사람에게 집 공인 IP 가 노출되고 그
IP 는 지오로케이션된다. 여기에 SKB 주택 회선의 80 인바운드 차단 가능성이 붙어
Let's Encrypt HTTP-01 이 실패할 수 있다(443 만 열려 있으면 Caddy 가 TLS-ALPN-01 로
자동 전환하므로 사망은 아니다). 애초에 IP 노출을 감수할 이유가 없다.

**Funnel 을 거르는 이유:** `https://<머신>.<tailnet>.ts.net` 은 내가 소유한
이름공간이 아니다. 머신 이름을 바꾸면 URL 이 따라 바뀐다. 웹이면 새 링크를 주면
그만이지만, **APK 를 한 번이라도 뿌리면 주소가 번들에 박혀 되돌릴 수 없다**
(`apps/client/src/api/GameClient.ts:15`).

### 왜 APK 가 아니라 웹인가

- **APK 는 지금 서버에 한 바이트도 못 보낸다.** `targetSdk=36` 인데 매니페스트에
  `usesCleartextTraffic` 도 `networkSecurityConfig` 도 없다. API 28 이후 평문
  HTTP 는 플랫폼 기본 차단이라 `ERR_CLEARTEXT_NOT_PERMITTED` 로 죽고 **서버 로그엔
  아무 흔적도 안 남는다.** `capacitor.config.ts` 의 `allowMixedContent: true` 는
  이걸 안 풀어 준다 — 그건 WebView 의 혼합콘텐츠 스위치일 뿐이다.
- **실서버의 CORS 목록이 뒤집혀 있다.** preflight 실측: `capacitor://localhost`
  허용, `https://localhost` **차단**. 그런데 Capacitor 8 안드로이드 WebView 의
  실제 오리진은 `https://localhost` 다(`androidScheme` 기본값). `capacitor://`
  는 iOS 스킴이고 이 저장소에 iOS 는 없다.
  **저장소 쪽 라벨 여섯은 고쳤다**(6장 "이미 고친 것"). 남은 것은 **서버 PC 의
  `.env` 한 줄** 이다 — 그 파일은 커밋되지 않아 여기서 못 고친다. APK 를 붙이는
  날 그 줄을 손으로 갈아야 한다.
- **주소가 빌드 타임에 박힌다** → 주소가 바뀌면 친구 전원 재설치. 웹은 새로고침.
- **릴리스 서명 설정이 없다** → `app-release-unsigned.apk` 가 나오고 안드로이드가
  설치를 거부한다. 디버그 APK 는 깔리지만 `debuggable=true`·`allowBackup=true` 다.
- 웹은 HTTPS 오리진이면 홈 화면 추가로 주소창 제거 + 가로 고정까지 온다.
  **단 HTTPS 에서만** — PWA 설치는 https 또는 localhost 를 하드 요구조건으로 건다.

APK 를 버리라는 뜻은 아니다. `android/` 는 그대로 두고 **HTTPS 가 선 뒤에** 만들면
평문 차단은 저절로 사라진다. 5장.

---

## 2. 열기 전에 반드시 고칠 것

전부 실측으로 확인된 것이다.

| # | 문제 | 위치 |
|---|---|---|
| 1 | 평문 HTTP 위의 30일 베어러 토큰 (터널이 서기 전까지) | 네트워크 전 구간 |
| 2 | 인증 없는 `POST /api/auth/logout` 이 무제한 DB 왕복 | `routes/auth.ts` 의 logout |
| 3 | `CORS_ORIGIN` 에 공개 오리진 없음 | 서버 `.env` |

**3번**은 같은 오리진 서빙이 6단계에서 실제로 섰으므로 **웹에서는 CORS 자체가
발생하지 않는다**(실측: 브라우저가 프리플라이트를 한 건도 안 보냈다). 남는 것은
APK 뿐이고, 붙일 때 `https://localhost` 를 추가한다 — `capacitor://localhost` 가
아니다.

### 이미 닫힌 것 (다시 하지 마라)

위 표에 두 줄로 있던 인증 관문이 **`b44f582` 에서 닫혔다** — 한 줄이 실제로는
둘이었으므로 아래는 셋이다. 지운 자리에 이것을 남기는 이유는 같은 실측을 다시
하지 않게 하려는 것이고, 닫힌 것을 아무도 되돌리지 않게 하려는 것이다. 셋 다
회귀 검사가 있고 그중 둘은 **동시 N회**로 쓰였다 — 순차로 쓰면 이 버그가 다시
들어와도 초록이라, 그것이 이 버그가 여태 살아남은 이유였다.

- **가입 성공이 레이트리밋에 안 세지던 것.** 실측이었던 "한 IP 에서 초당 211계정"
  은 이제 성립하지 않는다. 가입은 성공해도 세고 무르지 않는다 — 계정이 하나
  생겼다는 뜻이라 무를 이유가 아니다(`auth/rateLimit.ts` 의 SIGNUP_BACKOFF).
  한 IP 가 연달아 5개까지 열고, 6번째부터 5초 대기가 배증해 5분에서 멎는다.
- **셈이 argon2 `await` 뒤에 있어 동시 버스트의 첫 라운드가 통째로 통과하던 것.**
  이제 문을 지난 요청이 그 자리에서 실패로 세어 두고(선점), 로그인이 성공하면
  지운다. 가입·로그인 둘 다 그렇다.
- **다시 안 돌아오는 사람의 세션 행.** 청소를 도는 주체를 세우지 않고 새 세션을
  여는 자리에서 그 계정의 지난 세션만 치운다(`auth/sessions.ts` 의 openSession).
- **요청 로그가 꺼져 있던 것.** 원인은 `LOG_LEVEL` 이 아니라 판정이었다:
  `NODE_ENV` 로만 갈랐는데 **WinSW XML 은 그 변수를 놓지 않아** 배포가 개발과
  구별되지 않았다. 이제 `stdout 이 콘솔에 붙어 있는가`를 함께 본다
  (`config.ts` 의 isDevConsole) — 서비스·컨테이너는 아무 설정 없이 `info` 로
  말하고, 터미널에서 띄운 개발은 그대로 조용하다(pnpm·tsx watch 를 지나도
  isTTY 가 살아남는 것을 실측했다). `.env` 의 `LOG_LEVEL` 은 이제 기본을
  **바꾸고 싶을 때만** 쓰는 줄이다.
- **500 이 내부 오류 message 를 뱉던 것.** 5xx 는 밖으로 `{"code":"internal_
  error"}` 만 나가고 자세한 것은 요청 로그로 간다(`app.ts` 의 setErrorHandler).
  4xx 는 그대로 둔다 — 보낸 쪽이 고칠 수 있는 말이다. 개발 콘솔에서는 예전처럼
  자세히 주는데, 그 판정도 위와 **같은 함수**를 쓴다: 여기서 `NODE_ENV` 로 따로
  갈랐으면 WinSW 배포는 운영에서도 그대로 뱉었을 것이다.

### 터널을 세우면 함께 걸리는 것

`TRUST_PROXY` 를 **`127.0.0.1,::1`** 로 준다. `1` 이나 `true` 로 뭉개면 안 된다 —
Fastify 5 실측: `TRUST_PROXY=1` 이면 LAN 에서 `X-Forwarded-For: 9.9.9.9` 를 지어내면
`request.ip` 가 그것으로 잡힌다. IP/CIDR 목록으로 주면 소켓 주소가 목록에 없는
요청은 XFF 를 아예 안 읽는다. (`docs/deploy.md` 10장이 오래 `TRUST_PROXY=1` 을
시켰는데 그것이 바로 그 위조되는 값이었다 — **고쳤다**, 6장 "이미 고친 것".
이 실측은 `config.test.ts` 의 `TRUST_PROXY 배선` 이 음성 대조군과 함께 고정한다.)

`::1` 은 **지금은 안 쓰이는 항목**이다 — 3단계가 `HOST=127.0.0.1` 을 시키므로
바인딩이 IPv4 전용이고, 소켓 주소가 ::1 이 될 길이 없다. 실측: IPv4 로만 바인딩한
소켓에 ::1 로 붙으면 "반쪽"이 아니라 그냥 ECONNREFUSED 다. 그래서 cloudflared
config 에도 `localhost` 가 아니라 `http://127.0.0.1:3000` 을 명시한다. 그럼에도
적어 두는 것은 `HOST` 를 `::` 나 `localhost` 로 바꾸는 날을 위한 보험이다.

안 켜면 모든 요청이 127.0.0.1 한 덩어리로 보여 IP 백오프가 붕괴한다 — 한 사람의
로그인 실패가 전원을 잠근다. 켠 뒤 **로그의 remoteAddress 가 실제 IP 인지 눈으로
확인한다.** 이건 문서로 대신할 수 없다.

---

## 3. 감수하는 것 (친구 몇 명 수준)

겁줄 항목이 아니다. 지금 안 고쳐도 된다.

- **게임 행동 API 에 레이트리밋 없음.** 요청당 0.1ms(7,700~14,000 req/s)이고
  쿨다운·난수·판정이 전부 서버라 연타로 부정 이득이 없다. 게다가 이 라우트들은
  전부 세션 뒤에 있고 계정을 찍어 내는 문은 이미 잠겼으므로(2장 "이미 닫힌 것"),
  두드릴 수 있는 것은 자기 계정 하나다.
- 비밀번호 최소 8자, 흔한 비밀번호 차단 없음(`12345678` 로 가입된다).
- 비밀번호 변경·세션 무효화·찾기 없음 — 설계에서 명시적으로 수용한 것.
- **CORS 가 넓은 것 자체.** 인증이 쿠키가 아니라 Authorization 헤더라 CSRF 도 토큰
  탈취도 성립하지 않는다. 남의 페이지가 방문자 브라우저로 가입을 두드리는 것은
  이제 그 방문자의 IP 셈에 걸리므로(2장 "이미 닫힌 것") 흩어지는 것이 아니라
  그 사람이 잠긴다 — 좁힐 값어치는 남지만 급하지 않다.
- APK 의 `debuggable=true`, `allowBackup=true` — 폰을 빌려주지 않는 한 무관.
- 아이콘·스플래시가 Capacitor 기본 로고.
- **가용성.** 가정용 윈도 PC 한 대다. 절전·업데이트 재부팅·정전에 그냥 죽는다.

**감수 목록에 넣으면 안 되는 것 하나:** 평문 HTTP 로 비밀번호를 공개 인터넷에
흘리는 것. Tailscale 안이면 WireGuard 가 암호화하지만, 공개로 나가는 순간 HTTPS 는
선택이 아니다.

---

## 4. 단계

### 0단계 — 기계를 헷갈리지 마라

개발 PC(`desktop-nv0m9im` / 100.96.41.41)와 게임 서버(`semicollon-worker` /
**100.125.30.85** / 배포 루트 `C:\nogada-server\nogada-rpg-server`)는 **다른
기계다.** 아래 서버 작업은 전부 semicollon-worker 에서 한다 — cloudflared 는
트래픽을 받을 노드 자신에서 돌아야 한다.

### 1단계 — 도메인

`nunconnect.com` 은 네임서버가 Vercel 이다. Cloudflare Tunnel 의 DNS 라우트를
만들려면 존이 Cloudflare 에 있어야 한다. **게임 전용 도메인을 새로 사서 Cloudflare
무료 플랜에 붙이는 것**을 권한다 — 살아 있는 서비스를 안 건드리고 롤백이 쉽다.

주의: 존을 안 옮긴 채 `cloudflared tunnel route dns` 를 돌리면 **명령은 성공한다.**
권한 있는 NS 가 Vercel 이라 아무도 그 레코드를 조회하지 못할 뿐이다. 검증은 명령의
성공 메시지가 아니라 이것으로 한다:

```bash
nslookup nogada.내도메인 8.8.8.8
```

### 2단계 — 서버 PC 에 cloudflared

```bash
cloudflared.exe tunnel create nogada
```

config.yml 의 ingress 는 `service: http://127.0.0.1:3000` 으로 적는다 —
**`localhost` 로 적지 않는다.** 윈도에서 그것이 ::1 로 먼저 풀리는데 서버는 IPv4
로만 듣고 있어서(3단계의 `HOST=127.0.0.1`), 터널이 ECONNREFUSED 로 아예 못 붙는다.
그 다음 Windows 서비스로 등록한다:

```bash
cloudflared.exe service install
```

기존 `nogada-server` WinSW 와 같은 운영 패턴이 된다.

### 3단계 — 서버 `.env`

```
TRUST_PROXY=127.0.0.1,::1
HOST=127.0.0.1
NODE_ENV=production
```

`CORS_ORIGIN` 은 같은 오리진 서빙이면 웹용으로 필요 없다. `CLIENT_DIST` 도 안
적는다 — 기본값이 이 저장소의 `apps/client/dist` 이고, 6단계가 dist 를 밀어 넣는
자리가 바로 거기다.

**`HOST` 를 빠뜨리면 터널을 세워도 3000 이 LAN·Tailscale 에 평문으로 계속 열려
있다** — 앞문만 잠그고 옆문을 열어 둔 셈이다. 기본값은 여전히 `0.0.0.0` 이므로
(개발과 현행 운영이 그것에 기댄다) 좁히는 것은 이 한 줄을 적는 쪽의 몫이다.

**`NODE_ENV` 는 서비스로 돌 때는 없어도 되지만 그래도 적는다.** 서비스·컨테이너는
stdout 이 파일로 흘러가 그 자체로 운영으로 잡히지만(`config.ts` 의 isDevConsole),
문제를 쫓느라 서비스를 멈추고 3장의 `node --env-file=.env --import tsx src/index.ts`
를 콘솔에서 띄우는 순간 그 서버는 개발로 잡힌다 — 500 이 `connect ECONNREFUSED
127.0.0.1:5432` 같은 내부 문장을 그대로 뱉고, 그 문장이 공개된 터널로 나간다.
이 줄이 있으면 어떻게 띄우든 운영이다(`production` 은 TTY 보다 세다).

`LOG_LEVEL` 은 **안 적어도 된다.** 서비스로 도는 서버는 기본이 `info` 다
(2장 "이미 닫힌 것"). 적는 것은 조용히 하고 싶을 때(`warn`)뿐이다 — `off` 는
고르지 마라. 500 의 자세한 사정은 응답이 아니라 로그로만 가므로, 로거를 끄면
그 원인을 어디서도 못 본다.

이 세 줄을 넣었으면 서비스를 다시 띄우고(`nogada-server.exe restart`) 로그 파일에
요청 줄이 실제로 쌓이는지 눈으로 본다 — `.env` 는 기동 때 한 번만 읽힌다.

### 4단계 — 클라이언트를 오리진 상대경로로 빌드 (끝났다)

`apps/client/.env.production` 이 저장소에 있고 값이 비어 있다. `??` 는 빈 문자열을
폴백시키지 않으므로 `BASE` 가 `''` 이 되고 모든 호출이 `/api/...` 가 된다. 주소가
바뀌어도 재빌드가 필요 없고 CORS·혼합 콘텐츠가 원천적으로 안 생긴다.
`.env.production` 인 이유는 `.env.local`(개발용)을 안 건드리기 위해서다 — Vite 는
`.env.local` 보다 `.env.[mode]` 를 나중에 읽어 덮는다(실측: 이 파일을 넣은 뒤
번들의 `localhost:3000` 이 0건이 됐고 `.env.local` 은 그대로다).

**셸 환경변수로 넘기지 마라.** PowerShell 에서 `$env:VITE_API_BASE_URL = ''` 는
값을 비우는 게 아니라 **변수를 삭제한다**(실측). 그러면 `.env.local` 의 localhost 가
그대로 번들에 박힌다.

이 파일은 커밋 대상이다. 루트 `.gitignore` 가 `.env*` 를 통째로 막으므로 그 파일에
`!apps/client/.env.production` 한 줄이 예외로 뚫려 있다. **그 줄이 사는 자리는
처음 `git add` 를 통과시키는 것**이지 체크아웃이 아니다 — 실측: 예외를 지워도
이미 추적 중인 파일은 그대로 남는다(`git ls-files`·`git ls-tree HEAD` 그대로).
위험한 것은 **누가 이 파일을 지웠다가 다시 add 할 때**다: 그때 예외가 없으면
add 가 조용히 무시되고, 그다음 사람의 빌드는 아무 경고 없이 localhost 를 박는다.

규칙이 실제로 이기는지 보려면 `--no-index` 를 붙여야 한다. 그냥 부르면 인덱스를
보므로 추적된 파일에는 늘 "무시 안 됨"(exit 1)이 나온다:

```bash
git check-ignore -v --no-index apps/client/.env.production
```

`apps/client/src/api/apiBase.test.ts` 가 그 셋(파일의 존재·값·번들)을 잰다.

```bash
pnpm data:build
```

```bash
pnpm --filter @nogada/client build
```

### 5단계 — 두 개의 관문 (건너뛰면 폰에서야 발견된다)

**둘 다 `scripts/ship-client.ps1` 안에 들어갔다** — 6단계에서 옮길 때 자동으로
돈다. 손으로 확인하고 싶으면 아래 그대로다.

그림이 실제로 들어갔는지. **라이선스 에셋은 gitignore 대상이고, 비어 있어도 빌드는
에러 없이 끝난다.** 이것만은 테스트로 못 고정한다 — CI 에도 개발 PC 밖의 어디에도
그 그림이 없어서, 검사를 세우면 저장소가 늘 빨갛다.

```bash
Get-ChildItem -Recurse apps/client/dist/tilesets, apps/client/dist/icons, apps/client/dist/sprites, apps/client/dist/nodes -File | Measure-Object
```

번들에 주소가 안 박혔는지. **0 이어야 한다.** `assets\*.js` 한 층이 아니라 dist
전체를 훑는다 — CSS·`index.html`·assets 밖으로 나오는 산출물까지 봐야 이름값을 한다.

```bash
Get-ChildItem -Recurse -File apps/client/dist | Where-Object { $_.Extension -in '.js', '.mjs', '.css', '.html', '.json' } | Select-String -Pattern "localhost:3000|100\.125\.30\.85" -AllMatches | Measure-Object
```

이쪽은 **테스트가 됐다**(`apps/client/src/api/apiBase.test.ts`). dist 가 없으면
건너뛰므로, CI 는 테스트 앞에서 클라이언트를 빌드해 이 자리가 실제로 돌게 한다
(`.github/workflows/deploy.yml` — 계약 스위트에 DB 를 대 주는 것과 같은 판단이다).

dist 를 읽는 관문이 하나 더 있다: `apps/client/src/hiddenThresholds.test.ts` 가
드랍 확률·채집 브라켓·결계 좌표·소스맵을 같은 방식으로 잰다(8장 참조). 같은 이유로
CI 의 클라이언트 빌드보다 뒤에 있어야 한다.

### 6단계 — 서버가 dist 를 같은 오리진으로 서빙 (끝났다)

`@fastify/static` 이 `apps/server/src/app.ts` 의 `serveClient` 에서 등록된다.
`CLIENT_DIST` 가 자리를 정하고, **비워 두면 이 저장소의 `apps/client/dist`** 다.
개발도 테스트도 dist 없이 서버를 띄우므로 여기서 죽으면 안 되고, 실제로 안 죽는다:
없는 폴더로 등록해도 `@fastify/static` 은 던지지 않고 전부 404 를 줄 뿐이다(실측).

**그래서 없어도 등록은 한다.** 기동 로그에 "아직 없다" 한 줄만 남기고 붙여 둔다 —
없으면 건너뛰던 코드는 **서버 PC 의 첫 ship** 을 그대로 밟았다(거기엔 라이선스
에셋이 없어 빌드할 수 없으니, 정의상 첫 ship 전까지 dist 가 없다). 밀어 넣어도
서비스를 껐다 켜기 전까지 사이트가 404 인데 스크립트와 이 문서는 그 순간
"재시작할 필요 없다"고 적으므로, 운영자는 초록 스크립트를 손에 들고 404 앞에
서게 된다. 지금은 **기동 뒤에 생긴 dist 도 그 자리에서 나간다**
(`apps/server/src/clientDist.test.ts` 가 두 경우를 다 잰다).

- **`wildcard` 는 기본값(true)** 이다. `wildcard: false` 는 기동 시 파일마다
  라우트를 등록하는 모드인데, 그것으로 바꿔서 실제로 재 봤다: ① dist 를 갈아
  끼워도 재시작 전까지 옛 목록이 남고(사람이 손으로 밀어 넣는 것이 이 프로젝트의
  배포 절차라 치명적이다), ② dist 에 `api/` 아래 파일이 하나라도 있으면
  `FST_ERR_DUPLICATED_ROUTE` 로 **앱이 아예 안 뜬다.**
  (이 문서가 예전에 적었던 "한글 맵 파일명이 깨진다"는 **틀렸다** — 재 보니
  라우터가 %-인코딩을 풀어 맞춘다. 기본값을 지키는 이유는 위 둘이다.)
- **등록 순서는 상관없다** — Fastify 라우터는 등록 순서가 아니라 경로 구체성으로
  고른다. dist 안에 `api/health` 라는 **파일을 일부러 심어 놓아도** 라우트가
  이긴다(`apps/server/src/clientDist.test.ts`).
- **SPA 폴백은 두지 않았다.** 이 클라이언트에는 History API 라우터가 없다 —
  화면 전환이 전부 Zustand 상태이고 주소는 늘 `/` 하나다(pushState·popstate
  0건). 폴백을 두면 얻는 것 없이 오타 난 API 호출이 404 대신 HTML 을 받아,
  클라이언트가 "JSON 이 아니다"로 엉뚱하게 죽는다.

실측(포트 3055 에 서버 하나, dist 하나): 게임이 통째로 뜨고 타일셋·스프라이트·
`maps/%ED%95%AD%EA%B5%AC%EB%A7%88%EC%9D%84.json`·가입·캐릭터 생성이 **전부 서버
자신의 오리진**으로 갔다. 프리플라이트 0건, 콘솔 오류 0건.

#### dist 를 서버 PC 로 옮기기

**운영 부담을 정직하게 적는다.** `.github/workflows/deploy.yml` 은 서버만 배포하고
**클라이언트를 빌드하지도 복사하지도 않는다.** 그리고 서버 PC 에는 라이선스 에셋이
없다(`docs/deploy.md:239` — "미니PC 는 그림을 모른다"). 즉 릴리스마다 개발 PC 에서
빌드한 3.1MB dist 를 사람이 서버 PC 로 옮겨야 한다. **자동 CI 로 만들지 마라** —
러너에도 그림이 없어 그림 없는 사이트가 올라간다.

Tailscale 로 두 기계가 이미 붙어 있으므로(개발 PC 100.96.41.41, 서버
100.125.30.85) 관리 공유 위로 밀어 넣는 것이 손이 가장 덜 간다. 개발 PC 에서:

```powershell
powershell -File scripts/ship-client.ps1 -Destination '\\100.125.30.85\c$\nogada-server\nogada-rpg-server\apps\client\dist'
```

스크립트가 빌드하고, 5단계의 관문 둘을 돌리고, `robocopy /MIR` 로 옮긴다. 관문을
**옮기기 앞에** 두는 것이 요점이다 — `/MIR` 은 목적지를 지우므로, 빈 dist 를
미러하면 서버 PC 의 멀쩡한 화면을 지우고 아무것도 안 남긴다. `-SkipBuild` 를 주면
지금 폴더에 있는 것을 그대로 잰다.

sshd 를 켜 둔 서버라면 스크립트 없이 이렇게 해도 된다(관문은 손으로 돈다):

```bash
scp -r apps/client/dist/* user@100.125.30.85:/c/nogada-server/nogada-rpg-server/apps/client/dist/
```

**목적지를 저장소 안으로 고른 이유:** dist 는 gitignore 대상이고 배포 워크플로는
`git clean` 을 일부러 안 돌린다(거기 `.env` 와 node_modules 가 있다). 그래서 한 번
밀어 넣은 화면은 `git reset --hard` 를 지나도 남고, 서버의 `CLIENT_DIST` 기본값도
그 자리라 `.env` 에 한 줄도 안 적어도 된다.

**서버를 재시작할 필요는 없다** — 첫 ship 에서도 그렇다. `wildcard` 기본값이 요청
때마다 파일시스템을 보므로 다음 요청부터 새 화면이 나가고, 기동 때 dist 가 없었어도
정적 서빙은 붙어 있다(위 6단계).

강력 새로고침도 필요 없다. `index.html` 은 해시가 안 붙는 유일한 파일이지만,
실측한 응답 헤더가 `cache-control: public, max-age=0` 에 `etag`·`last-modified` 다 —
`max-age=0` 이면 브라우저는 평범한 방문에서도 조건부 요청을 보내고 바뀐
`index.html` 을 그 자리에서 받는다(`clientDist.test.ts` 가 그 헤더를 잰다).

감당하기 싫으면 대안은 Cloudflare Pages 에 `wrangler pages deploy` 로 dist 만
올리는 것인데, 그러면 오리진이 갈려 CORS_ORIGIN 관리가 돌아온다. **리포 연결 자동
빌드는 절대 하지 마라** — 에셋이 없어 그림 없는 사이트가 올라간다.

### 7단계 — 검증

집 밖 회선(폰 LTE)에서:

```bash
curl -i https://nogada.내도메인/api/health
```

CORS 가 실제로 좁혀졌는지. **음성 대조군이 필요하다** — 허용 오리진만 테스트하면
"전부 허용"과 "제대로 좁혀짐"을 구별할 수 없다:

```bash
curl -i -H "Origin: http://evil.example" https://nogada.내도메인/api/health
```

레이트리밋이 붙었는지 — 가입을 20번 연달아 시도해 429 가 나오는지 본다. 그리고
로그의 remoteAddress 가 127.0.0.1 이 아닌 실제 IP 인지 눈으로 확인한다.

### 8단계 — 웹 경험 보강 (HTTPS 가 선 다음에만 의미 있다)

`apps/client/public/manifest.webmanifest` 에 `"display":"standalone"`,
`"orientation":"landscape"`, 192/512 아이콘. `index.html <head>` 에
`<link rel="manifest">` 와 `<meta name="theme-color">`. 친구에게 "크롬 ⋮ → 홈 화면에
추가"를 안내하면 주소창 50px 을 되찾고 가로가 잠긴다.

**세로로 들면 패널이 무너진다.** 클라이언트 CSS 전체에 `@media` 쿼리가 **0개**이고,
마을 카드는 `repeat(4, 1fr)`, 제작·상점은 좌우 분할이라 375px 폭에서 못 쓴다.
캔버스는 멀쩡히 늘어나므로 "게임은 떴는데 창을 열면 못 쓴다"로 나타난다. iOS
사파리는 manifest 의 orientation 을 무시하므로 `@media (orientation: portrait)` 한
블록으로 "가로로 돌려 주세요"를 띄우는 것이 아이폰 사용자를 위한 유일한 방어다.

---

## 5. APK 를 굳이 만든다면

HTTPS 가 선 뒤라면 평문 차단은 사라진다. 그래도 이 순서를 지킨다.

1. **keystore 를 만들기 전에 먼저 막아라.** `apps/client/android/.gitignore:57-58`
   의 `#*.jks` `#*.keystore` 가 **주석 처리된 채** 커밋되어 있다. 지금 릴리스 키를
   만들어 그 폴더에 두면 다음 `git add -A` 에 서명키가 통째로 커밋된다. 키가
   유출되면 폐기해야 하고, 폐기하면 그 키로 뿌린 APK 의 **업데이트 경로가 영구히
   끊긴다**(서명이 다른 APK 는 덮어 설치되지 않는다). 잃어버려도 같다. 이 저장소는
   불가침 파일을 커밋한 전례가 있다(`ec3be0d`).
2. **당장 친구에게 줄 목적이면 릴리스를 건드리지 마라.** `assembleDebug` 산출물은
   안드로이드 디버그 키로 v2 서명되어 그대로 설치된다(실측 5,531,446 바이트).
   `assembleRelease` 는 signingConfig 가 없어 unsigned 를 뱉는데 **빌드는 BUILD
   SUCCESSFUL 로 끝나서** 파일이 생긴 걸 보고 착각하기 쉽다.
3. **JAVA_HOME 을 잡아라.** PATH 의 java 는 JDK 8 이고 AGP 8.13 은 JVM 11+ 를
   요구한다. `C:\Program Files\Android\Android Studio\jbr`(JDK 21.0.6)로 지정하면
   빌드된다. Android Studio 안에서는 되고 터미널에서만 실패해 원인 찾기가 오래
   걸린다.
4. **`.env.local` 을 실제 주소로.** APK 는 오리진 상대경로를 못 쓴다 —
   `VITE_API_BASE_URL=https://nogada.내도메인`.
5. **`CORS_ORIGIN` 에 `https://localhost` 추가.** `capacitor://localhost` 가 아니다.
6. `pnpm android:sync` 는 루트에서 없는 명령이다(실측 `ERR_PNPM_RECURSIVE_EXEC_
   FIRST_FAIL`). `pnpm --filter @nogada/client android:sync` 이고, 그 스크립트는
   `data:build` 를 부르지 않으니 손으로 먼저 돌린다.
7. **서명을 검산하라.** `apksigner verify --print-certs -v <apk>` 첫 줄이
   "Verifies" 여야 한다. `outputs/` 아래에 debug 와 unsigned release 둘이 있다.
8. `versionCode` 가 1 에 고정이다. 보낼 때마다 +1 하고 versionName 을 날짜로 두면
   받은 사람이 뭘 깔았는지 확인할 수 있다.

**받는 사람이 밟는 단계:** APK 를 연다 → "이 출처의 앱 설치" 허용(안드로이드 8부터
시스템 전체가 아니라 **앱마다**) → 다시 설치 → Play Protect 의 "알 수 없는 개발자"
경고에서 무시하고 설치. 구글 드라이브로 주면 "바이러스 검사 불가" 경고가 뜨는데
정상이니 미리 말해 둔다.

**2027년 대비:** Google 개발자 인증이 2026-09-30 브라질·인니·싱가포르·태국에서
시작해 2027년 전세계로 확대된다(한국 구체 시점 미공개). **사이드로딩이 끝나는 것은
아니다** — 개발자 모드 수동 활성화 → 강압 확인 → 재부팅·재인증 → **24시간 대기** →
생체/PIN 확인의 advanced flow 가 남는다. 즉 늘어나는 비용은 "못 깐다"가 아니라
"받는 사람이 24시간 대기가 낀 5단계를 밟는다"다. 지인 범위라면 **Limited
distribution account**(등록비 없음, 신분증 불필요, 최대 20대)가 $25 정식 계정보다
낫다. Play 정식 배포로 가면 2023-11-13 이후 만든 개인 계정은 테스터 12명 × 14일
연속 클로즈드 테스트가 프로덕션 승인의 선행 조건이다(법인 계정 면제).

---

## 6. 저장소 안의 틀린 기록 — 함께 고칠 것

### 이미 고친 것 (다시 하지 마라)

CORS 오귀속과 `TRUST_PROXY` 는 **닫혔다.** 지운 자리에 남기는 이유는 2장의 그것과
같다 — 같은 실측을 다시 하지 않게, 그리고 아무도 되돌리지 않게.

- **안드로이드 WebView 의 오리진은 `https://localhost` 다.** `capacitor://` 는
  iOS 스킴이고 이 저장소에 iOS 는 없다. 근거 셋: `@capacitor/cli` 8.5 의
  declarations.d.ts (`androidScheme` 기본값 `https`, `iosScheme` 기본값
  `capacitor`), 안드로이드 네이티브 CapConfig.java 의 `androidScheme =
  CAPACITOR_HTTPS_SCHEME` · `hostname = "localhost"`, 그리고
  `apps/client/capacitor.config.ts` 가 그 둘을 안 건드린다는 것.
  틀리게 적혀 있던 여섯 곳(`.env.example`, `config.ts`, `app.ts`,
  `deploy.md` 셋)을 전부 고쳤고, **트러블슈팅 표가 틀린 답을 가리키던 것**도
  같은 자리에서 정정했다. 다시 틀려지는 길은 문서가 아니라 `capacitor.config.ts`
  에 `androidScheme` 한 줄이 붙는 것이라, 자를 거기 댔다
  (`apps/client/src/api/androidOrigin.test.ts` — 그 파일이 `.env.example` 의
  `CORS_ORIGIN` 값까지 함께 잰다).
- **`CORS_ORIGIN` 은 요청을 보내는 쪽의 목록이다.** "서버 자기 주소를 넣어라"고
  적던 `deploy.md` 9장을 고쳤다. 같은 오리진 서빙이 선 지금은 **웹용으로는 아예
  필요 없다**는 것도 함께 적었다.
- **`TRUST_PROXY` 는 주소 목록으로만 켠다.** `deploy.md` 10장이 시키던 `1` 은
  위조되는 값이었다 — 숫자와 `true` 는 소켓 주소를 안 본다. 10장과
  `.env.example`, `config.ts` 를 `127.0.0.1,::1` 로 맞췄다. **8장(도커+Caddy)은
  값이 아니라 절차로 바꿨다** — 거기서는 Caddy 가 compose 네트워크로 붙어
  소켓 주소가 결코 127.0.0.1 이 아니므로, 복사용 블록에서 값을 빼고
  "4단계 뒤 `docker network inspect` 로 재서 적는다"만 남겼다. 한 번은
  그 자리에 `127.0.0.1,::1` 을 그대로 옮겨 적었다가 검토에 잡혔다 —
  **위조되는 값을 지운 자리에 또 다른 틀린 값을 넣은 것**이었다.
  `config.test.ts` 의 `TRUST_PROXY 배선` 이 **음성 대조군까지** 재고, 그중 한
  검사는 "숫자로 켜면 위조된다"를 일부러 고정한다 — 그것이 빨개지는 날
  문서 문장들을 다시 써야 한다는 신호다.
- **`docs/deploy-windows.md` 에 그 축이 통째로 없던 것.** 실제 운영자가 보는
  런북이 이쪽인데 tailscale·https·CORS·TRUST_PROXY·APK 가 grep 0건이었다.
  8장을 새로 붙이고 머리말에서 그리로 가리켰다 — `deploy.md` 만 고치면
  헛일이었을 자리다.
- **`deploy.md` 8장(도커+Caddy)이 현행 토폴로지와 어긋나는 것.** 장을 다시 쓰지는
  않고 **단서를 달았다**: 실제 서버는 WinSW 네이티브 + Cloudflare Tunnel 이고,
  지금 공개하려는 것이면 이 문서로 오라고.

### 아직 안 고친 것

- **게임 안 크레딧이 실제 배포물과 다르다.** `detailMenuTabs.ts:221-235` 는 아이템
  아이콘을 game-icons.net 것이라 적는데, APK 안에 SVG 는 0개이고 실제 아이콘 76개는
  finalbossblues 것이며 그쪽은 크레딧에 없다. 라이선스 의무 위반은 아니지만
  (`CREDITS.md:30` 이 finalbossblues 크레딧을 "불필요"로 기록) **오귀속**이고,
  `detailMenuTabs.ts:218-219` 가 스스로 건 "게임 안과 저장소가 같은 말을 한다" 규약
  위반이다. "자세한 조건은 저장소의 CREDITS.md 참고" 문구도 APK/웹만 받은 사람에겐
  아무것도 안 가리킨다. (Neo둥근모 OFL 고지는 이미 배포물 안에 있다 — WOFF name
  테이블 nameID 0/13/14. OFL 1.1 조건 2 가 명시적으로 허용하는 방식이라 문제 없다.)

## 7. 남은 미지수

- **Tailscale 무료 Personal 은 사용자 6명 상한**(2026 기준). "친구들에게 Tailscale
  초대" 경로를 계속 쓸 거면 여섯을 넘는 순간 유료다. `tailscale serve`/`cert` 는
  tailnet 의 HTTPS Certificates 를 켜야 하고 지금 이 tailnet 은 꺼져 있다.
- **지연시간을 아무도 안 쟀다.** 현재 Tailscale 직결 0.097s(실측). Cloudflare
  Tunnel 은 클라 → CF 엣지 → 집 PC 라 왕복이 는다. 채집을 연타하는 게임이라 이게
  체감의 실제 판정 기준이다. 전환 전에 quick tunnel 로 한 시간 세워 p50/p95 를 재
  볼 값어치가 있다. 관련해서 한국 이통사 LTE/5G 는 CGNAT 뒤라 Tailscale 직결이 자주
  실패하고 DERP 중계(도쿄 계열)를 타는데, 웹으로 주면 첫 로드 1.94MB 가 매번 그
  중계를 지난다 — 이건 APK 쪽의 실질적 이점 하나다.
- **모니터링이 없다.** 지금은 죽어도 내 시간이지만 공개하면 남의 시간이 걸린다.
  외부에서 `/api/health` 를 주기적으로 두드려 알림을 주는 것 하나는 열기 전에 붙여
  두는 게 맞다.
- **SK브로드밴드 주택용 약관의 서버 운영 제한 조항**과, 아이디·비밀번호를 받는
  서비스를 공개하는 것의 개인정보 취급 문제는 이 조사에서 다루지 않았다.
  포트포워딩을 안 하면 전자는 상당 부분 비껴가지만 후자는 어느 경로든 남는다.

---

## 8. 잘한 것 (바꾸지 말 것)

인증 코어는 이 규모에서 기대 이상이다 — argon2id(m=19MiB/t=2/p=1, OWASP 권장),
토큰은 sha256 만 저장, pg 쿼리 전수 파라미터화(SQL 인젝션 경로 0), 본문 있는 라우트
전부에 zod, 없는 계정에도 argon2 를 돌려 타이밍으로 아이디 존재를 못 센다.

드랍 확률표 비유출 규범도 지켜지고, **이제는 그것을 지키는 자가 있다** —
`apps/client/src/hiddenThresholds.test.ts` 가 자를 둘 댄다.

- **소스 그래프**(빌드 없이 늘 돈다) — 클라이언트 진입에서 import 를 따라 걸어가
  서버 전용 진입(`@nogada/data` 의 서브경로 셋)과 그 생성 JSON 에 닿지 않는지 본다.
  금지 목록은 손으로 적지 않고 데이터 패키지의 `exports` 에서 읽는다.
- **빌드된 번들**(dist 가 있을 때만) — 구운 JSON 에서 값을 읽어 만든 서명이 dist
  어디에도 없는지, 그리고 소스맵이 없는지 본다. 서명의 최소화된 꼴은 추측하지
  않고 빌드가 쓰는 그 esbuild 에게 시켜서 만든다(실측: 유출된 번들은 `0.5` 를
  `.5` 로, `60000` 을 `6e4` 로 적는다 — 손으로 적었으면 틀렸을 자리다).

배럴에 import 한 줄이 추가되는 날 이제 CI 가 잡는다. 실측으로 확인했다: 배럴에
`export * from './loadGatherTables.js'` **한 줄만** 넣고 아무도 안 써도 확률표가
통째로 번들에 실린다(loader 의 최상위 `deepFreeze` 부수효과 때문에 트리 셰이킹이
지우지 못한다). "안 쓰니까 괜찮다"는 성립하지 않는다.
