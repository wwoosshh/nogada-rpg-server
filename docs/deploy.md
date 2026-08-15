# 미니PC 배포 안내

이 문서는 **집에 둔 미니PC 한 대에 게임 서버를 올리는 절차**다. 명령을 위에서
아래로 그대로 따라 하면 되도록 썼고, 각 단계마다 "왜 이걸 하는가"와 "빼먹으면
무슨 증상이 나오는가"를 함께 적었다 — 증상만 보고는 원인을 찾기 어려운 것들이라서다.

> **이 문서는 도커(컨테이너) 전제다.** 지금 실제로 도는 서버는 그 길로 안 간다 —
> 윈도 네이티브(WinSW)로 돌고(`docs/deploy-windows.md`), 공개는 8장의
> 포트포워딩+Caddy 가 아니라 Cloudflare Tunnel 로 연다(`docs/deploy-public.md`).
> **그 기계의 값을 고치러 왔다면 저 둘로 간다.** 여기 남은 도커 절차는 다른
> 기계(리눅스 서버 등)에 세울 때를 위한 것이다.

**이 문서가 전제하는 것**

- 서버는 **한 대**다. 로그인 실패 백오프가 메모리에 살기 때문에(설계 §3) 서버를
  둘로 늘리면 그 표가 갈라진다. 늘려야 하는 날이 오면 그 표부터 옮겨야 한다.
- 비밀번호 찾기가 없다. 계정을 잊으면 그 계정은 죽는다(설계 규범 6, 수용된 사실).
- **저장소는 이제 GitHub 의 비공개 리포지토리에 있다.** 그래서 손으로 배포하는
  길(3장의 USB·scp)과 자동으로 배포하는 길(13장)이 둘 다 있다. 처음 한 번은
  어느 쪽으로든 사람이 세워야 하고, 그 뒤부터는 13장이 대신한다.
- 요청 로그가 켜져 있다(컨테이너 기본 `LOG_LEVEL=info`). 요청 한 줄과 응답 한 줄이
  남고, **자격증명은 `[가려짐]` 으로 덮인다** — Authorization 헤더·비밀번호·세션
  토큰(`apps/server/src/config.ts`). 로그 보는 법은 14장, 회전 정책도 거기 있다.

---

## 1. OS 준비

**권장: Ubuntu Server 24.04 LTS.** 화면도 마우스도 필요 없고, 전원을 넣으면 알아서
올라오고, `restart: unless-stopped` 가 재부팅 뒤 컨테이너를 되살린다. 서버로 두는
기계에는 이쪽이 손이 덜 간다.

설치할 때 정할 것 둘:

- **고정 IP 또는 DHCP 예약.** 서버 주소가 바뀌면 클라이언트를 다시 빌드해야 한다
  (주소가 빌드에 박히기 때문이다 — 7장). 공유기 설정에서 이 기계의 MAC 에 IP 를
  묶어 두는 것이 가장 쉽다.
- **자동 절전 끄기.** 노트북형 미니PC 는 뚜껑을 닫거나 유휴 상태가 되면 잠드는데,
  잠든 서버는 켜져 있는 것도 꺼져 있는 것도 아니어서 증상이 "가끔 안 붙는다"로
  나타난다.

```bash
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
```

**대안: 이미 쓰던 Windows PC + Docker Desktop.** 새로 설치하기 싫을 때의 길이다.
같은 compose 파일이 그대로 돈다. 다만 두 가지가 다르다:

- Docker Desktop 은 **로그인한 사용자 세션에서 돈다.** 설정에서 "Start Docker
  Desktop when you sign in" 을 켜고, 윈도 자동 로그인까지 해 두지 않으면 재부팅
  뒤에 아무도 로그인하지 않아 서버가 안 뜬다.
- 절전은 여기서도 꺼야 한다(제어판 → 전원 옵션 → 절전 안 함).

---

## 2. Docker 와 Compose 설치

Ubuntu:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER    # 이 줄 뒤에는 로그아웃했다 다시 들어와야 적용된다
docker compose version           # v2 가 나오면 준비 끝
```

Windows: [Docker Desktop](https://www.docker.com/products/docker-desktop/) 을 설치하면
WSL2 와 Compose 가 함께 온다. 아래 명령들은 PowerShell 이 아니라 **WSL 셸(우분투)**
에서 실행하는 편이 낫다 — `scripts/backup.sh` 가 sh 스크립트다.

---

## 3. 저장소 가져오기

**방법 0 — GitHub 에서 클론 (지금은 이쪽이다).** 비공개 리포지토리이므로 그
계정으로 로그인된 상태여야 한다(`gh auth login` 이나 자격증명 관리자).
**자동 배포(13장)를 쓸 것이라면 경로가 정해져 있다** — 워크플로가 이 폴더를 본다:

```powershell
git clone https://github.com/wwoosshh/nogada-rpg-server.git C:\nogada-server\nogada-rpg-server
cd C:\nogada-server\nogada-rpg-server
```

아래 둘은 **GitHub 에 닿을 수 없을 때**의 길이다(미니PC 가 인터넷에 없거나
계정을 그 기계에 넣고 싶지 않을 때). 개발 PC 에서 만들어 옮긴다.
**`node_modules` 는 절대 함께 옮기지 않는다** — 윈도에서 깔린 네이티브
모듈(argon2)은 리눅스에서 안 돌고, 어차피 이미지가 안에서 다시 깐다.

**방법 A — git bundle.** 파일 하나에 이력까지 들어가고, 나중에 새 bundle 로
`git pull` 을 할 수 있다.

```bash
# 개발 PC 에서
git bundle create nogada.bundle --all
# USB 에 복사하거나 scp 로 보낸다
scp nogada.bundle 사용자@192.168.0.10:~/
# 미니PC 에서
git clone -b main ~/nogada.bundle ~/nogada && cd ~/nogada
```

**방법 B — 지금 상태를 통째로.** git 이 없어도 되고, 대신 이력이 없다.

```bash
# 개발 PC 에서 (추적 중인 파일만 담긴다 = node_modules·에셋·.env 자동 제외)
git archive --format=tar.gz -o nogada.tar.gz HEAD
scp nogada.tar.gz 사용자@192.168.0.10:~/
# 미니PC 에서
mkdir -p ~/nogada && tar -xzf ~/nogada.tar.gz -C ~/nogada && cd ~/nogada
```

USB 로 옮길 때도 같은 파일 하나를 복사하면 된다. **서버에는 라이선스 에셋이
필요 없다** — 그림은 클라이언트에만 들어간다(7장).

---

## 4. `.env` 작성

```bash
cd ~/nogada
cp apps/server/.env.example apps/server/.env
openssl rand -hex 24        # 나온 문자열을 비밀번호로 쓴다
nano apps/server/.env
```

고칠 곳 셋:

1. **`POSTGRES_PASSWORD`** 와 **`DATABASE_URL` 안의 비밀번호** — 반드시 **같은 값**.
   두 곳에 적히는 이유는 하나는 DB 가 계정을 만드는 값이고 하나는 서버가 붙는
   주소이기 때문이다. 어긋나면 서버가 뜨자마자 인증 실패로 죽는다.
2. **`CORS_ORIGIN`** — **이 서버에 요청을 보내는 쪽**의 출처 목록이다(서버 자기
   주소가 아니다). 안드로이드 앱으로 논다면 `https://localhost` 가 반드시 들어가야
   한다 — 그것이 Capacitor 안드로이드 WebView 의 오리진이다(`androidScheme`
   기본값이 `https`). **`capacitor://localhost` 가 아니다**: 그건 iOS 스킴이고
   이 저장소에 iOS 는 없다. 브라우저로도 연다면 그 주소
   (`http://192.168.0.10:5173` 같은)를 쉼표로 덧붙인다.
   **빠뜨리면 "서버는 200 인데 화면은 아무것도 안 나온다"** — 거절하는 것은
   브라우저이고 서버 로그에는 아무 흔적이 없다. 그리고 **컨테이너로 도는 서버는
   빈 값을 "전부 허용"이 아니라 "아무 데도 허용 안 함"으로 읽는다**(9장) —
   같은 오리진으로만 논다면 그것이 맞는 상태다.
3. **`TRUST_PROXY`** — 지금은 **비워 둔다**. 켜는 때는 10장에 있다.

`.env` 는 커밋되지 않는다(`.gitignore`). 미니PC 를 새로 설치하는 날 이 파일만
따로 챙겨 두면 된다 — 잃어버리면 DB 비밀번호를 잃는 것이다.

---

## 5. 띄우기

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

첫 빌드는 몇 분 걸린다(의존성 설치 + 데이터 굽기). **개발용 `docker-compose.yml`
과 다른 파일이다** — 개발 쪽은 Postgres 만 띄우고 5432 를 밖에 연다. 배포 쪽은
서버까지 띄우고 DB 포트는 밖에 내지 않는다.

일어나는 일 순서:

1. Postgres 가 뜨고, `pg_isready` 헬스체크가 통과할 때까지 서버는 **기다린다**
   (`depends_on: service_healthy`).
2. 서버 컨테이너의 엔트리포인트가 **마이그레이션을 돌린다**. 두 번째 기동부터는
   `No migrations to run!` 이 찍힌다 — 매번 돌려도 안전하다.
3. 서버가 3000 을 듣는다.

확인:

```bash
docker compose -f docker-compose.prod.yml ps          # 둘 다 (healthy) 여야 한다
docker compose -f docker-compose.prod.yml logs -f server
curl http://localhost:3000/api/health                 # {"ok":true,"items":...}
```

`(healthy)` 는 30초 안에 붙는다. `unhealthy` 로 남으면 서버가 DB 에 못 붙는
것이다 — `/api/health` 가 저장소에 실제로 한 번 묻기 때문이다(그래서 이 신호를
믿을 수 있다). 로그에서 비밀번호 불일치부터 확인한다.

표가 제대로 섰는지 보고 싶으면:

```bash
docker compose -f docker-compose.prod.yml exec db psql -U nogada -d nogada -c '\dt'
# users · sessions · characters · pgmigrations 넷이 보이면 된다
```

**멈추고 다시 켜기**

```bash
docker compose -f docker-compose.prod.yml stop        # 잠깐 내린다
docker compose -f docker-compose.prod.yml up -d       # 다시
docker compose -f docker-compose.prod.yml down        # 컨테이너를 지운다(자료는 볼륨에 남는다)
```

**`down -v` 는 쓰지 않는다.** `-v` 는 볼륨까지 지우고, 그것이 곧 모든 계정과
캐릭터의 삭제다.

**새 버전 배포**: 3장의 방법으로 소스를 갱신한 뒤 `up -d --build` 한 번이면 된다.
스키마가 바뀌었다면 기동하면서 알아서 마이그레이션이 돈다. **이 세 줄을 사람이
치지 않게 하는 것이 13장이다** — 러너를 깔고 나면 `main` 에 올리는 것으로 끝난다.

---

## 6. 백업

```bash
./scripts/backup.sh                    # backups/nogada-YYYYmmdd-HHMMSS.sql.gz
```

매일 새벽 4시에 자동으로 (`crontab -e`):

```cron
0 4 * * * cd /home/사용자/nogada && ./scripts/backup.sh >> /home/사용자/nogada-backup.log 2>&1
15 4 * * * find /home/사용자/nogada/backups -name '*.sql.gz' -mtime +14 -delete
```

복원은 스크립트 안의 주석에 그대로 있다(서버를 내리고 부어야 한다):

```bash
docker compose -f docker-compose.prod.yml stop server
gunzip -c backups/nogada-20260811-040000.sql.gz | \
  docker compose -f docker-compose.prod.yml exec -T db psql -U nogada -d nogada
docker compose -f docker-compose.prod.yml start server
```

**볼륨은 백업이 아니다.** 네임드 볼륨은 컨테이너를 지워도 남지만 디스크가 죽으면
함께 죽는다. 만든 `.sql.gz` 를 다른 기계(USB·클라우드 저장소)로 옮겨 두는
것까지가 백업이고, 가끔 **복원을 실제로 한 번 해 보는 것**까지가 백업이다.

---

## 7. 클라이언트 빌드

서버 주소는 **빌드 시점에 박힌다**(`import.meta.env.VITE_API_BASE_URL`). 주소가
바뀌면 다시 빌드해야 한다.

```bash
cd apps/client
echo 'VITE_API_BASE_URL=http://192.168.0.10:3000' > .env.local
pnpm data:build                             # ← 먼저다. 없으면 아래가 던진다.
pnpm --filter @nogada/client build          # apps/client/dist/
pnpm --filter @nogada/client android:sync   # 안드로이드 프로젝트에 반영
```

> `data:build` 가 앞에 있는 이유: 클라이언트 빌드는 구운 맵 JSON 을 dist 로
> 복사하는 것으로 끝나고, 그것이 없으면 `vite.config.ts` 의 `closeBundle` 이
> `맵 JSON 이 없다 … 먼저 pnpm data:build 를 돌린다` 로 던진다. `android:sync` 도
> 이 스크립트를 안 부른다(`deploy-public.md` 5장 6번).

> **라이선스 에셋은 저장소에 없다.** 타일셋·스프라이트·아이콘은 재배포 금지
> 조항 때문에 커밋되지 않는다(`assets/CREDITS.md`). 그래서 **클라이언트 빌드는
> `CREDITS.md` 의 복원 절차를 마친 PC 에서만 가능하다.**
>
> 함정은 빌드가 **에러 없이 끝난다**는 것이다 — `public/` 아래가 비어 있어도
> Vite 는 복사할 것이 없다고 여길 뿐이다. 그림 없는 APK 가 조용히 만들어지고,
> 검은 화면은 폰에서야 보인다. 이 조건은 명령이 아니라 사람이 지켜야 한다.
>
> **서버 배포에는 에셋이 필요 없다.** 미니PC 는 그림을 모른다.

APK 는 `pnpm --filter @nogada/client android:open` 으로 Android Studio 를 열어
만든다. 폰과 미니PC 가 같은 공유기에 있으면 이대로 붙는다.

---

## 8. 공개 경로 ① — 도메인 + Caddy (자동 HTTPS)

> **이 장은 지금 쓰는 토폴로지가 아니다.** 실제 서버(미니PC)는 도커·Caddy 가
> 아니라 **WinSW 네이티브**로 돌고(`docs/deploy-windows.md`), 공개는 포트포워딩이
> 아니라 **Cloudflare Tunnel** 로 연다(`docs/deploy-public.md`). 아래의
> `docker compose --profile caddy`, `PUBLIC_DOMAIN`, 포트포워딩 절차는 그 기계에
> 그대로 적용되지 않는다. 다른 기계에 도커로 세우는 경우를 위해 남겨 둔 것이고,
> **지금 서버를 공개하려는 것이면 `docs/deploy-public.md` 로 간다.**

친구가 아무 데서나 접속하게 하려면 이 길이다. 준비물: 도메인, 공유기의 포트
포워딩 권한, 공인 IP.

> **TLS 없이 LAN 밖으로 내보내지 않는다**(설계 규범 8). 평문으로 나가는 것은
> 비밀번호와 세션 토큰이고, 공용 와이파이 한 번이면 계정이 남의 것이 된다.
> 아래를 다 하기 전에는 3000 포트를 공유기에 열지 않는다.

1. 도메인의 A 레코드를 미니PC 의 공인 IP 로 맞춘다.
2. 공유기에서 **80 과 443** 을 미니PC 로 포워딩한다(3000 은 열지 않는다).
   80 이 닫혀 있으면 인증서 발급이 실패한다.
3. `apps/server/.env` 를 고친다:
   ```
   PUBLIC_DOMAIN=nogada.내도메인.com
   CORS_ORIGIN=https://localhost,https://nogada.내도메인.com
   # TRUST_PROXY 는 여기서 정하지 않는다 — 4단계까지 세운 뒤 아래 명령으로
   # 재서 그 대역을 적는다. 붙여 넣을 수 있는 값을 여기 두지 않는 이유가 바로
   # 다음 문단이다.
   ```
   `https://localhost` 는 안드로이드 앱의 오리진이다(APK 를 안 뿌릴 것이면 뺀다).
   `TRUST_PROXY` 를 **`1` 로 적지 않는 이유는 10장**에 있다 — 그 값은 위조된다.
   목록에 적을 것은 **Caddy 가 서버 소켓에 붙는 주소**이고, **이 장에서는 그것이
   결코 `127.0.0.1` 이 아니다.** 4단계가 서버의 published 포트를
   `127.0.0.1:3000:3000` 으로 돌리므로 Caddy 는 호스트 루프백이 아니라 **같은
   compose 네트워크**로 붙고, 그때 서버가 보는 소켓 주소는 **Caddy 컨테이너의
   주소**다. 그러니 다른 장(터널·`docs/deploy-public.md`)의 `127.0.0.1,::1` 을
   여기로 옮겨 적으면 안 된다 — 그 대역을 확인해서 적는다:
   ```bash
   docker network inspect $(docker compose -f docker-compose.prod.yml ps -q server \
     | xargs docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}')
   ```
   (이 토폴로지는 지금 안 돌고 있어서 **대역을 실측하지 못했다** — 위 명령으로
   직접 보고 적는다. 흔히 `172.18.0.0/16` 이지만 compose 프로젝트 이름에 따라
   달라진다.) 틀리면 조용히 반대쪽으로 망가진다: 좁게 적으면 XFF 를 안 읽어 모든
   요청이 프록시 하나로 보이고, 넓게 적으면 위조가 열린다.
4. `docker-compose.prod.yml` 의 서버 포트를 안쪽으로 돌린다 — 이 한 줄을
   `- '3000:3000'` 에서 `- '127.0.0.1:3000:3000'` 으로. 이제 밖에서 보이는 문은
   443 하나다.
5. 띄운다:
   ```bash
   docker compose -f docker-compose.prod.yml --profile caddy up -d
   docker compose -f docker-compose.prod.yml logs -f caddy   # 인증서 발급 확인
   curl https://nogada.내도메인.com/api/health
   ```

**이 시점의 체크리스트 — 앱 쪽도 함께 바꿔야 끝난다:**

- [ ] `apps/client/capacitor.config.ts` 의 `android.allowMixedContent: true` **삭제**.
      개발용 평문 접속을 위해 열어 둔 구멍이고, https 로 넘어오는 이 시점이 닫기로
      약속한 자리다(설계 규범 8). 남겨 두면 앱은 여전히 http 를 받아 준다.
- [ ] `apps/client/.env.local` 의 `VITE_API_BASE_URL` 을 `https://...` 로.
- [ ] 클라이언트 재빌드 + `android:sync` + APK 재설치. (주소가 빌드에 박히므로
      이 셋을 하지 않으면 폰은 계속 옛 주소를 부른다.)
- [ ] `curl -I http://nogada.내도메인.com/api/health` 가 308 로 https 에 넘기는지 확인.

---

## 9. 공개 경로 ② — Tailscale (포트를 열지 않는다)

지인 몇 명과만 논다면 이쪽이 훨씬 안전하고 간단하다. 공유기에 구멍을 내지 않고,
도메인도 인증서도 필요 없다. 기계들이 서로 암호화된 사설망(WireGuard) 안에 든다.

```bash
# 미니PC 에서
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --hostname=nogada
tailscale ip -4                 # 100.x.y.z — 이것이 서버 주소가 된다
```

폰과 친구의 기기에도 Tailscale 앱을 깔고 **같은 계정(또는 초대받은 계정)** 으로
로그인하면 끝이다. 클라이언트는 그 주소로 빌드한다:

```
VITE_API_BASE_URL=http://100.x.y.z:3000
```

**`TRUST_PROXY` 는 비워 둔다**(프록시가 없다). 공유기 포트 포워딩은 하지 않는다 —
그것이 이 방식의 요점이다.

`.env` 의 `CORS_ORIGIN` 에 대해: **여기에 서버 자기 주소를 넣는 것이 아니다.**
(오래 그렇게 적혀 있었다.) 이 값은 **요청을 보내는 쪽**의 오리진 목록이고,
브라우저는 자기가 띄운 페이지의 오리진을 `Origin` 헤더에 실어 보낸다. 그래서
넣을 것은 **화면이 어디서 로드됐는가**다:

- 서버가 화면까지 내주면(지금 모습 — `CLIENT_DIST`) 오리진이 하나뿐이라
  **교차 출처 요청 자체가 안 생긴다.** 값이 필요 없다 — 그래도 `CORS_ORIGIN=`
  한 줄은 남겨 둔다. **운영에서 빈 값은 "전부 허용"이 아니라 "아무 데도 허용
  안 함"**이고(개발 콘솔에서만 전부 허용이다 — `config.ts` 의 isDevConsole),
  APK 를 붙이는 날 손댈 자리가 그 줄이다.
- Vite 개발 서버로 붙는다면 그 주소(`http://100.x.y.z:5173`).
- APK 로 붙는다면 `https://localhost`.

평문 http 인데 괜찮은 이유: Tailscale 자체가 기기 사이를 암호화한 터널이라,
"평문이 공용 인터넷을 지나간다"는 상황이 아니다. 반대로 말하면 **Tailscale 을
쓰지 않는 사람은 접속할 수 없다** — 그 폐쇄성이 곧 안전장치다.

---

## 10. `TRUST_PROXY` 는 언제 켜는가

**리버스 프록시(Caddy)나 터널(cloudflared) 뒤에 있을 때만 켜고, 켤 때는 반드시
프록시의 주소 목록으로 켠다. 그 밖에는 비워 둔다.**

> **이 장은 오래 `TRUST_PROXY=1` 을 시켰다. 그것이 위조되는 값이다.**
> Fastify 5 실측: `1` 이든 `true` 든 **누가 보냈는지를 안 본다** — LAN 의 아무
> 기계나 `X-Forwarded-For: 9.9.9.9` 를 붙여 보내면 `request.ip` 가 9.9.9.9 로
> 잡힌다. IP/CIDR 목록으로 주면 소켓 주소가 목록에 없는 요청은 그 헤더를
> **아예 안 읽는다**(같은 실측). 터널 뒤라면 `TRUST_PROXY=127.0.0.1,::1` 이다.
> `::1` 은 **지금은 안 쓰이는 항목**이다 — 이 문서가 시키는 바인딩이 전부 IPv4
> 전용이라(`HOST` 기본 `0.0.0.0`, 터널 런북은 `127.0.0.1`) 소켓 주소가 ::1 이 될
> 길이 없다. 실측: `0.0.0.0` 소켓에 ::1 로 붙으면 ECONNREFUSED 다. `HOST` 를
> `::` 나 `localhost` 로 바꾸는 날을 위한 보험이다.
> 이 실측은 `apps/server/src/config.test.ts` 의 `TRUST_PROXY 배선` 이
> 음성 대조군까지 붙여 고정해 둔다 — 그중 한 검사는 "숫자로 켜면 위조된다"를
> 일부러 재고 있어서, 그것이 빨개지는 날 이 문장을 다시 써야 한다.

서버는 로그인·가입 실패를 IP 별로 세어 백오프를 건다(`auth/rateLimit.ts`). 그
"IP" 를 무엇으로 볼지 정하는 것이 이 값이다. 프록시 뒤인데 **끄면**, 모든 요청이
Caddy 컨테이너의 주소 하나로 보인다 — 누군가 비밀번호를 몇 번 틀리는 순간 그
백오프가 **접속자 전원**에게 걸리고, 반대로 공격자는 남들과 한 통에 섞여 계정별
백오프에만 걸린다. 프록시가 없는데 **켜면** 더 나쁘다: `X-Forwarded-For` 는 그냥
헤더라 아무나 지어낼 수 있고, 요청마다 다른 IP 를 적어 보내면 IP 백오프는 존재하지
않는 것과 같아진다(계정별 백오프만 남는다). 어느 쪽도 서버는 멀쩡히 200 을
돌려주므로 **틀렸다는 사실이 겉으로 드러나지 않는다** — 그래서 토폴로지를 바꾸는
날 이 값을 함께 바꾸는 것을 잊으면 안 된다.

**그리고 "켠다"에도 두 가지가 있다.** 숫자(`1`)와 `true` 는 헤더를 그냥 믿는 것
이라, 프록시 뒤에 제대로 세워 두어도 **프록시를 거치지 않고 서버 포트에 직접
닿을 수 있는 누구든** 그대로 위조할 수 있다. 지금 서버는 `HOST` 를 좁히기 전까지
LAN·Tailscale 에서 3000 이 열려 있으므로 그 "누구든"이 실재한다. 주소 목록으로
적으면 그 경로가 통째로 닫힌다 — 소켓 주소가 목록에 없으면 헤더를 읽지 않는다.

적을 주소는 **프록시가 서버 소켓에 붙는 주소**다:

| 앞에 선 것 | 적는 값 |
|---|---|
| cloudflared (같은 PC, 8장 아님 → `docs/deploy-public.md`) | `127.0.0.1,::1` |
| Caddy 컨테이너 (같은 compose 네트워크) | 그 컨테이너의 대역 — `docker network inspect` 로 확인 |
| 없음 (LAN·Tailscale 직결) | 비워 둔다 |

목록에 IP 가 아닌 것이 섞이면 **서버가 기동에서 죽는다**(`invalid IP address: …`,
실측). 조용히 넘어가지 않는 것이 여기서는 이득이다 — 물러설 자리가 양쪽 다
나쁘기 때문이다(끄면 전원이 한 덩어리, 전부 믿으면 위조).

켠 뒤에는 **로그의 `remoteAddress` 가 접속자의 실제 IP 인지 눈으로 한 번
확인한다.** 그 자리에 프록시 주소(`127.0.0.1` 같은 것) 하나만 찍히면 안 켜진
것이다. 반대쪽(위조되는 꼴로 켜진 것)은 로그로는 안 보인다 — 위조가 들어오기
전까지 화면이 똑같기 때문이다. 그래서 그쪽은 눈이 아니라 **적은 값**으로만
확인한다: 목록인가, 숫자인가.

---

## 11. 안 될 때

| 증상 | 먼저 볼 곳 |
|---|---|
| `server` 가 `unhealthy` | `logs server`. 대개 DB 비밀번호 불일치이거나 `DATABASE_URL` 의 호스트가 `db` 가 아니다. |
| 서버는 200 인데 화면이 비어 있다 | `CORS_ORIGIN`. 브라우저 콘솔에 CORS 오류가 있는지 본다 — 서버 로그에는 안 남는다. |
| 앱(안드로이드)에서만 안 붙는다 | `CORS_ORIGIN` 에 **`https://localhost`** 가 빠졌거나, 8장 뒤 APK 를 다시 안 깔았다. **`capacitor://localhost` 가 아니다** — 이 표가 오래 그렇게 가리켜서 이 증상을 쫓으면 한 바퀴 헛돌았다. 안드로이드 WebView 의 오리진은 `https://localhost` 이고 `capacitor://` 는 iOS 스킴이다(`androidScheme` 기본값 `https`, `iosScheme` 기본값 `capacitor`). 확인은 `adb logcat -s chromium:*` 의 CORS 줄에 찍히는 Origin 으로 한다. |
| 시간이 이상하게 흐른다 | `x-server-now` 헤더가 막힌 것이다. 프록시를 직접 설정했다면 이 헤더가 지워지지 않는지 확인한다. |
| **재부팅 뒤 서버가 안 살아난다 (윈도)** | 컨테이너 정책(`unless-stopped`)은 문제가 아니다 — **Docker Desktop 이 서비스가 아니라 사용자 세션 앱**이라서, 재부팅 후 그 사용자가 로그인하기 전에는 엔진 자체가 없다(러너 서비스는 부팅과 함께 떠도 같은 벽에 막힌다). 무인 복구 두 가지: ① Docker Desktop → Settings → General → **Start Docker Desktop when you sign in** 체크. ② 그 사용자 **자동 로그인** — `netplwiz` 에서 "암호를 입력해야" 체크 해제(체크박스가 안 보이면 관리자 PowerShell 로 `Set-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\PasswordLess\Device" DevicePasswordLessBuildVersion 0` 후 다시). 보안이 걸리면 로그온 트리거 예약 작업으로 `rundll32.exe user32.dll,LockWorkStation` — 화면은 잠기고 세션(과 Docker)은 산다. 확인: 재부팅 몇 분 뒤 `/api/health` 200. Ubuntu 로 옮기면 이 문제 자체가 없다(도커가 시스템 서비스). `stop` 으로 손수 내려 둔 컨테이너는 어느 쪽이든 안 살아난다 — 그건 정책이 아니라 의도다. |
| **로컬은 200 인데 다른 기기에서 연결 자체가 안 된다 (윈도)** | 실제 배포에서 겪은 순서대로: ① `netstat -ano \| findstr ":3000"` 에 `0.0.0.0:3000 LISTENING` 이 있는지 — 없으면 Docker Desktop 재시작. ② 있다면 십중팔구 **Windows 가 만든 Docker 차단 규칙**이다. 처음 포트를 열 때 뜨는 허용 창이 닫히면 `com.docker.backend.exe` 에 대한 **차단** 규칙이 생기고, 차단은 포트 허용 규칙보다 항상 이긴다. 관리자 PowerShell 에서 확인 후 제거: `Get-NetFirewallRule -Enabled True -Action Block \| Where-Object DisplayName -match "docker" \| Remove-NetFirewallRule`. ③ 포트 허용 규칙도 함께: `netsh advfirewall firewall add rule name="nogada-server-3000" dir=in action=allow protocol=TCP localport=3000`. |
| 윈도에서 Docker 가 "Virtualization support not detected" | 작업 관리자 성능 탭에 가상화 **사용**이라고 나오는데도 그러면 BIOS 가 아니라 윈도 기능이다. 관리자 PowerShell: `dism /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart` + `featurename:VirtualMachinePlatform` + `bcdedit /set hypervisorlaunchtype auto` → 재부팅 → `wsl --update`. |
| 디스크가 찼다 | `docker system prune -a` (볼륨은 건드리지 않는다) + `backups/` 의 오래된 덤프. |
| **배포 잡이 노랗게 대기만 하고 시작하지 않는다** | 라벨이거나 러너다(13-2). GitHub → Settings → Actions → Runners 에서 그 러너가 **Idle(초록)** 인지, 라벨에 `windows` 와 `mini-pc` 가 둘 다 붙어 있는지 본다. 하나라도 없으면 잡은 실패하지 않고 **영원히 기다린다** — 그래서 증상이 조용하다. 라벨은 러너 화면에서 나중에 더할 수 있다. |
| 배포 잡이 `open //./pipe/docker_engine: The system cannot find the file specified` 로 죽는다 | 도커가 없는 것이 아니라 **러너 서비스 계정이 도커를 못 보는 것**이다(13-3). 서비스를 Docker Desktop 쓰는 사용자 계정으로 다시 깔고, 그 사용자가 로그인해 있는지 확인한다. |
| 관리 화면(8081·8082)이 다른 기기에서 안 열린다 | **그게 맞다.** `127.0.0.1` 에만 묶여 있다(14장). RDP 나 Tailscale 로 미니PC 안에 들어가서 연다. |
| CI 의 테스트가 로컬과 다르게 실패한다 | CI 에는 진짜 Postgres 가 붙어 있어 평소 건너뛰던 계약 스위트 29개가 **실제로 돈다**. 로컬에서 같게 보려면 `docker compose up -d` 뒤 `TEST_DATABASE_URL=postgres://nogada:nogada@localhost:5432/nogada pnpm test`. |

---

## 12. 참고

- **현행 서버(윈도 네이티브)의 런북: `docs/deploy-windows.md`** — 그 기계의
  `CORS_ORIGIN`·`TRUST_PROXY`·APK 축은 그쪽 8장이다
- **공개(터널·HTTPS) 절차: `docs/deploy-public.md`**
- 서버 환경변수 전부: `apps/server/.env.example`
- 배포 구성: `docker-compose.prod.yml` · 이미지: `apps/server/Dockerfile`
- 자동 배포 정의: `.github/workflows/deploy.yml` (13장)
- 백업/복원: `scripts/backup.sh`
- 설계 근거: `docs/superpowers/specs/2026-08-10-account-character-design.md` §6, 규범 8·9
- 에셋 복원 절차: `assets/CREDITS.md`

---

## 13. 자동 배포 (CI/CD)

> **미니PC 쪽 절반은 `docs/deploy-windows.md` 로 옮겨 갔다.** 그 기계는 이제
> 컨테이너가 아니라 윈도 서비스로 서버를 돌린다(WSL2 VM 계층을 걷어내며 2.9GB
> 회수). 아래 `deploy` 칸은 그래서 갱신된 것이고, 그 기계를 처음 세우거나
> 되돌리는 절차는 이 문서가 아니라 저쪽에 있다. `verify` 칸과 이 장의 나머지는
> 그대로 유효하다.

**하는 일:** `main` 에 커밋이 들어오면 GitHub 이 테스트를 돌리고, 통과하면
미니PC 가 스스로 새 코드를 받아 서비스를 다시 세운다. 사람이 미니PC 앞에
앉는 일은 없어진다. 정의는 `.github/workflows/deploy.yml` 한 파일이다.

```
main 에 push ─▶ verify (GitHub 이 빌려주는 리눅스)
                 pnpm install / data:build / test / typecheck / 클라이언트 빌드
                 + 진짜 Postgres 를 붙여 계약 스위트까지 (평소엔 건너뛰는 29개)
                    │ 통과해야만
                    ▼
               deploy (미니PC 의 self-hosted 러너 — 윈도 네이티브)
                 git fetch + reset --hard origin/main
                 pnpm install / data:build / migrate up
                 WinSW XML 의 GIT_SHA 를 이번 커밋으로 갈고 서비스 restart
                 /api/health 가 ok:true **와 그 커밋의 sha** 를 줄 때까지 90초
                 서비스 상태·로그 꼬리로 마무리
```

**sha 까지 대조하는 것이 컨테이너 시절과 다른 점이다.** 네이티브에서는 재시작이
조용히 실패해도 옛 프로세스가 계속 3000 을 쥔 채 `ok:true` 를 준다.

알아 둘 것 셋:

- **미니PC 가 GitHub 에 붙는다.** 반대가 아니다. 러너가 이쪽에서 나가는 연결로
  일감을 받아 오므로 공유기에 구멍을 낼 필요가 없다(9장의 Tailscale 과 같은 이치).
- **`pull` 이 아니라 `reset --hard` 다.** 미니PC 에서 무언가 손으로 고쳐 본
  흔적이 남아 있어도 배포가 서지 않게 하려는 것이다. 반대로 말하면 **미니PC 에서
  직접 고친 것은 다음 배포에 사라진다** — 고칠 것이 있으면 개발 PC 에서 고쳐 올린다.
  `git clean` 은 돌지 않으므로 `apps/server/.env` 는 안전하다.
- **배포는 줄을 선다.** 두 배포가 겹치면 어느 코드가 올라갔는지 알 수 없어서,
  앞 배포가 끝날 때까지 뒤 배포는 기다린다(취소되지 않는다).
- PR 에서는 `verify` 만 돈다. 배포는 `main` 에 실제로 들어온 것만 나간다 —
  그래서 검토 중인 가지가 미니PC 를 건드릴 일이 없다.

### 13-1. 가지 이름을 `main` 으로 바꾼다

워크플로는 `main` 만 본다. 지금 가지 이름이 `master` 라면 먼저 바꾼다.

1. GitHub → 리포지토리 → **Settings → General → Default branch** → 연필 아이콘 →
   `master` 를 `main` 으로 → **Rename branch**. (GitHub 이 열린 PR 을 알아서 옮긴다.)
2. 개발 PC 에서:

```bash
git branch -m master main
git fetch origin
git branch -u origin/main main
git remote set-head origin -a
```

3. 미니PC 에 이미 클론이 있다면 거기서도 같은 네 줄을 돌린다. 배포 잡이
   `git fetch origin main` 부터 하므로 로컬 가지 이름 자체는 중요하지 않지만,
   사람이 그 폴더에서 `git status` 를 볼 때 헷갈리지 않게 맞춰 둔다.

### 13-2. 미니PC 에 러너를 깐다 (주인이 직접 하는 부분)

여기는 **토큰이 오가는 자리라 사람이 손으로 한다.** 순서대로:

1. 미니PC 에 저장소가 **`C:\nogada-server\nogada-rpg-server`** 에 클론되어 있고,
   `apps\server\.env` 가 채워져 있고, 손으로 한 번 `up -d --build` 가 성공한
   상태여야 한다(3·4·5장). 자동 배포는 이미 서 있는 것을 갈아 끼우는 일이지
   처음 세우는 일이 아니다.
2. GitHub → 리포지토리 → **Settings → Actions → Runners → New self-hosted runner**.
3. 운영체제 **Windows**, 아키텍처 **x64** 를 고르면 그 화면이 명령 네댓 줄을
   보여 준다. **그 화면의 명령을 그대로** 미니PC 의 PowerShell 에 붙여 넣는다
   (토큰이 박혀 있어 여기 적을 수 없고, 그 토큰은 한 시간이면 만료된다).
   푸는 위치는 `C:\actions-runner` 정도가 무난하다.
4. `.\config.cmd` 가 몇 가지를 물어본다:
   - `Enter the name of the runner group` → 그냥 엔터.
   - `Enter the name of runner` → `nogada-minipc` 같은 이름.
   - **`Enter any additional labels` → `windows,mini-pc` 를 입력한다.**
     워크플로가 `runs-on: [self-hosted, windows, mini-pc]` 라, 이 라벨이 없으면
     배포 잡은 **영원히 대기 상태로 남는다**(실패도 아니고 그냥 안 돈다).
     `self-hosted` 는 자동으로 붙으므로 적지 않아도 된다.
   - `Enter name of work folder` → 그냥 엔터.
5. **서비스로 등록한다.** 관리자 PowerShell 에서:

```powershell
cd C:\actions-runner
.\svc.cmd install "DESKTOP-XXXX\사용자이름"   # ← Docker Desktop 을 쓰는 그 계정
.\svc.cmd start
.\svc.cmd status
```

**`.\run.cmd` 로 띄우지 않는다.** 그것은 창을 닫으면 끝나는 방식이라, 재부팅
뒤에 러너가 없고 배포는 조용히 대기만 한다. 계정을 왜 넘기는지는 바로 다음이다.

### 13-3. Docker Desktop 을 쓰면 서비스 계정이 중요하다

**이것 하나가 가장 흔한 실패다.** Docker Desktop 은 시스템 서비스가 아니라
**로그인한 사용자 세션에서** 돈다. 도커에 말을 거는 파이프
(`\\.\pipe\docker_engine`)의 접근 권한도 그 사용자와 `docker-users` 그룹에
묶여 있다. 러너 서비스를 기본값(`NT AUTHORITY\NETWORK SERVICE`)으로 깔면,
배포 잡의 `docker compose` 가 이런 말로 죽는다:

```
error during connect: ... open //./pipe/docker_engine: The system cannot find the file specified.
```

이 문장은 도커가 안 깔렸다고 말하는 것처럼 보이지만, 실제로는 **그 계정이
도커를 못 보는 것**이다. 그래서:

- `svc.cmd install` 에 **Docker Desktop 을 쓰는 그 사용자 계정**을 넘긴다
  (위 명령의 `"DESKTOP-XXXX\사용자이름"`). 비밀번호를 물어보면 그 계정의
  윈도 로그인 비밀번호다. 계정 이름은 `whoami` 로 확인한다.
- 그 계정이 `docker-users` 로컬 그룹에 있어야 한다(Docker Desktop 설치 계정은
  대개 이미 들어 있다). 확인: `net localgroup docker-users`.
- **그 사용자가 로그인해 있어야 Docker Desktop 이 돈다.** 1장에서 이미 말한
  두 가지를 여기서 다시 확인한다 — Docker Desktop 의 "Start Docker Desktop when
  you sign in" 켜기, 그리고 윈도 자동 로그인. 재부팅 뒤 아무도 로그인하지
  않으면 러너 서비스는 살아 있는데 도커만 없는 상태가 되고, 그때 배포는
  위 파이프 오류로 실패한다.
- 절전도 끈다. 잠든 미니PC 의 러너는 "오프라인"으로 보인다.

깔고 나서 확인: GitHub → Settings → Actions → Runners 에 그 이름이
**Idle(초록)** 으로 보이고 라벨에 `windows` 와 `mini-pc` 가 붙어 있으면 된다.

### 13-4. 되돌리기

배포가 나가고 나서 게임이 이상하면, 되돌리는 길이 둘이다.

**빠른 길 — 미니PC 에서 직접 (몇 분).** GitHub 을 거치지 않으므로 가장 빠르다.
다만 **다음 배포가 오면 다시 새 코드로 덮인다** — 응급 처치다.

```powershell
cd C:\nogada-server\nogada-rpg-server
git log --oneline -10                  # 돌아갈 커밋을 고른다
git reset --hard <이전 SHA>
docker compose -f docker-compose.prod.yml up -d --build
curl http://localhost:3000/api/health
```

**제대로 된 길 — main 에 되돌리는 커밋 (권장).** 저장소와 서버가 다시 같은
것을 가리키게 되고, 자동 배포가 알아서 반영한다.

```bash
git revert <문제 커밋 SHA>      # 되돌리는 새 커밋을 만든다
git push origin main            # → verify → deploy 가 다시 돈다
```

**`git push --force` 로 이력을 지우지 않는다.** 미니PC 는 `reset --hard` 로
따라오므로 되기는 하지만, 그날 이후 아무도 무엇이 배포됐는지 되짚을 수 없다.

**마이그레이션은 되돌아가지 않는다.** 코드를 되돌려도 이미 돈 스키마 변경은
그대로 남는다(엔트리포인트는 `up` 만 돌린다). 스키마가 바뀐 배포를 되돌려야
한다면 6장의 백업에서 복원하는 것이 정직한 길이고, 그래서 **스키마를 바꾸는
배포 직전에는 `./scripts/backup.sh` 를 한 번 돌려 두는 것**이 규칙이다.

---

## 14. 관리 도구

DB 를 들여다보는 화면(Adminer)과 로그를 보는 화면(Dozzle)을 프로필 하나로 켠다.

```bash
docker compose -f docker-compose.prod.yml --profile admin up -d
```

**둘 다 `127.0.0.1` 에만 열린다.** 관리 화면은 게임 포트처럼 열지 않는다 —
LAN 의 다른 기계에서도, 포트 포워딩을 해 둔 공유기 밖에서도 보이지 않는다.
보려면 **미니PC 앞에 앉거나, RDP 로 그 기계에 들어가거나, Tailscale 로
그 기계에 붙어서**(9장) 그 안의 브라우저로 연다.

| 무엇 | 주소 | 하는 일 |
|---|---|---|
| Adminer | http://127.0.0.1:8081 | DB 를 표로 보고 고친다 |
| Dozzle | http://127.0.0.1:8082 | 컨테이너 로그를 브라우저에서 흐르는 대로 본다 |

**Adminer 로그인** — 화면의 네 칸을 이렇게 채운다:

| 칸 | 값 |
|---|---|
| 시스템 | PostgreSQL |
| 서버 | `db` (미리 채워져 있다) |
| 사용자 이름 | `.env` 의 `POSTGRES_USER` (예시 그대로면 `nogada`) |
| 비밀번호 | `.env` 의 `POSTGRES_PASSWORD` |
| 데이터베이스 | `.env` 의 `POSTGRES_DB` (예시 그대로면 `nogada`) |

들어가면 `users` · `sessions` · `characters` · `pgmigrations` 넷이 보인다.
**여기서 고친 것은 되돌릴 수 없다.** 캐릭터 상태는 `characters.state` 의 JSONB
한 칸에 통째로 들었고(설계 §2), 손으로 고쳐 스키마를 깨면 그 캐릭터는 서버가
읽지 못해 500 을 받는다. 만지기 전에 `./scripts/backup.sh`.

**볼일이 끝나면 내린다 — 내릴 때도 `--profile admin` 을 붙인다:**

```bash
docker compose -f docker-compose.prod.yml --profile admin down
```

프로필을 빼면 `db` 와 `server` 만 내려가고 **관리 화면 둘은 그대로 서 있다.**
게임을 내려놨으니 다 내려간 줄 알기 쉬운 자리다. 다만 이 둘에는 재시작 정책을
걸지 않았으므로(`restart: 'no'`) 재부팅하면 어차피 사라진다 — 다른 서비스와
일부러 다르게 해 둔 것이다.

**터미널에서 로그 보기.** Dozzle 없이도 되는 일이고, 미니PC 에 SSH 로만
들어갔을 때는 이쪽뿐이다:

```bash
docker compose -f docker-compose.prod.yml logs -f server        # 흐르는 대로 본다 (Ctrl+C 로 나온다)
docker compose -f docker-compose.prod.yml logs --since 30m server   # 최근 30분만
docker compose -f docker-compose.prod.yml logs --tail 100 db    # DB 의 마지막 100줄
```

남는 줄은 요청 하나에 둘이다 — 들어올 때 `incoming request`(method·url·ip),
끝날 때 `request completed`(상태 코드·걸린 시간). 같은 `reqId` 로 묶인다.
**자격증명은 남지 않는다**: Authorization 헤더·비밀번호·세션 토큰은 `[가려짐]`
으로 덮인다. 조용하게/시끄럽게 하려면 `.env` 에 `LOG_LEVEL` 을 적고 서버를
다시 띄운다(`warn` · `debug` · `off`, 기본은 `info`).

**로그는 회전한다.** `db` 와 `server` 는 10MB 짜리 파일 5개까지만 쥐고
(compose 의 `logging:`), 넘으면 오래된 것부터 버린다. 이것이 없으면 도커의 기본
설정은 파일 하나를 한없이 키우고, 몇 달 뒤 미니PC 의 SSD 를 채우는 것은 게임
자료가 아니라 그 파일이다. 바꿔 말하면 **며칠보다 오래된 로그는 없다** — 남겨야
할 것이 있으면 그때그때 파일로 뽑아 둔다:

```bash
docker compose -f docker-compose.prod.yml logs --no-color server > server-$(date +%F).log
```
