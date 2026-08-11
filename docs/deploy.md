# 미니PC 배포 안내

이 문서는 **집에 둔 미니PC 한 대에 게임 서버를 올리는 절차**다. 명령을 위에서
아래로 그대로 따라 하면 되도록 썼고, 각 단계마다 "왜 이걸 하는가"와 "빼먹으면
무슨 증상이 나오는가"를 함께 적었다 — 증상만 보고는 원인을 찾기 어려운 것들이라서다.

**이 문서가 전제하는 것**

- 서버는 **한 대**다. 로그인 실패 백오프가 메모리에 살기 때문에(설계 §3) 서버를
  둘로 늘리면 그 표가 갈라진다. 늘려야 하는 날이 오면 그 표부터 옮겨야 한다.
- 비밀번호 찾기가 없다. 계정을 잊으면 그 계정은 죽는다(설계 규범 6, 수용된 사실).
- **저장소는 아직 GitHub 에 없다.** 그래서 아래 3장이 USB·scp 로 옮기는 이야기다.
- 요청 로그는 꺼져 있다(`Fastify({ logger: false })`). 컨테이너 로그에 남는 것은
  기동·마이그레이션·오류뿐이다. 어디까지 갔는지 보려면 클라이언트가 받은 상태
  코드를 본다.

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

## 3. 저장소 가져오기 (아직 GitHub 에 없다)

개발 PC 에서 만들어 미니PC 로 옮긴다. **`node_modules` 는 절대 함께 옮기지 않는다** —
윈도에서 깔린 네이티브 모듈(argon2)은 리눅스에서 안 돌고, 어차피 이미지가 안에서
다시 깐다.

**방법 A — git bundle (권장).** 파일 하나에 이력까지 들어가고, 나중에 새 bundle 로
`git pull` 을 할 수 있다.

```bash
# 개발 PC 에서
git bundle create nogada.bundle --all
# USB 에 복사하거나 scp 로 보낸다
scp nogada.bundle 사용자@192.168.0.10:~/
# 미니PC 에서
git clone -b master ~/nogada.bundle ~/nogada && cd ~/nogada
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
2. **`CORS_ORIGIN`** — 이 서버에 붙는 것들의 출처 목록. 안드로이드 앱으로 논다면
   `capacitor://localhost,http://localhost` 는 반드시 들어가야 한다. 브라우저로도
   연다면 그 주소(`http://192.168.0.10:5173` 같은)를 쉼표로 덧붙인다.
   **빠뜨리면 "서버는 200 인데 화면은 아무것도 안 나온다"** — 거절하는 것은
   브라우저이고 서버 로그에는 아무 흔적이 없다.
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
스키마가 바뀌었다면 기동하면서 알아서 마이그레이션이 돈다.

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
pnpm --filter @nogada/client build          # apps/client/dist/
pnpm --filter @nogada/client android:sync   # 안드로이드 프로젝트에 반영
```

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
   CORS_ORIGIN=capacitor://localhost,http://localhost,https://nogada.내도메인.com
   TRUST_PROXY=1
   ```
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

`.env` 의 `CORS_ORIGIN` 에도 같은 주소를 넣고, **`TRUST_PROXY` 는 비워 둔다**
(프록시가 없다). 공유기 포트 포워딩은 하지 않는다 — 그것이 이 방식의 요점이다.

평문 http 인데 괜찮은 이유: Tailscale 자체가 기기 사이를 암호화한 터널이라,
"평문이 공용 인터넷을 지나간다"는 상황이 아니다. 반대로 말하면 **Tailscale 을
쓰지 않는 사람은 접속할 수 없다** — 그 폐쇄성이 곧 안전장치다.

---

## 10. `TRUST_PROXY` 는 언제 켜는가

**Caddy 같은 리버스 프록시 뒤에 있을 때만 켠다(`1`). 그 밖에는 비워 둔다.**

서버는 로그인·가입 실패를 IP 별로 세어 백오프를 건다(`auth/rateLimit.ts`). 그
"IP" 를 무엇으로 볼지 정하는 것이 이 값이다. 프록시 뒤인데 **끄면**, 모든 요청이
Caddy 컨테이너의 주소 하나로 보인다 — 누군가 비밀번호를 몇 번 틀리는 순간 그
백오프가 **접속자 전원**에게 걸리고, 반대로 공격자는 남들과 한 통에 섞여 계정별
백오프에만 걸린다. 프록시가 없는데 **켜면** 더 나쁘다: `X-Forwarded-For` 는 그냥
헤더라 아무나 지어낼 수 있고, 요청마다 다른 IP 를 적어 보내면 IP 백오프는 존재하지
않는 것과 같아진다(계정별 백오프만 남는다). 어느 쪽도 서버는 멀쩡히 200 을
돌려주므로 **틀렸다는 사실이 겉으로 드러나지 않는다** — 그래서 토폴로지를 바꾸는
날 이 값을 함께 바꾸는 것을 잊으면 안 된다.

프록시가 둘 이상이거나(예: Cloudflare + Caddy) 정확히 하고 싶으면 홉 수 대신
프록시의 주소를 적는다: `TRUST_PROXY=127.0.0.1,172.18.0.0/16`.

---

## 11. 안 될 때

| 증상 | 먼저 볼 곳 |
|---|---|
| `server` 가 `unhealthy` | `logs server`. 대개 DB 비밀번호 불일치이거나 `DATABASE_URL` 의 호스트가 `db` 가 아니다. |
| 서버는 200 인데 화면이 비어 있다 | `CORS_ORIGIN`. 브라우저 콘솔에 CORS 오류가 있는지 본다 — 서버 로그에는 안 남는다. |
| 앱(안드로이드)에서만 안 붙는다 | `CORS_ORIGIN` 에 `capacitor://localhost` 가 빠졌거나, 8장 뒤 APK 를 다시 안 깔았다. |
| 시간이 이상하게 흐른다 | `x-server-now` 헤더가 막힌 것이다. 프록시를 직접 설정했다면 이 헤더가 지워지지 않는지 확인한다. |
| 재부팅 뒤 서버가 없다 | Ubuntu: `docker compose ... ps` 로 확인(정책은 `unless-stopped` 라 `stop` 으로 내려 둔 것은 안 살아난다). 윈도: Docker Desktop 자동 시작. |
| **로컬은 200 인데 다른 기기에서 연결 자체가 안 된다 (윈도)** | 실제 배포에서 겪은 순서대로: ① `netstat -ano \| findstr ":3000"` 에 `0.0.0.0:3000 LISTENING` 이 있는지 — 없으면 Docker Desktop 재시작. ② 있다면 십중팔구 **Windows 가 만든 Docker 차단 규칙**이다. 처음 포트를 열 때 뜨는 허용 창이 닫히면 `com.docker.backend.exe` 에 대한 **차단** 규칙이 생기고, 차단은 포트 허용 규칙보다 항상 이긴다. 관리자 PowerShell 에서 확인 후 제거: `Get-NetFirewallRule -Enabled True -Action Block \| Where-Object DisplayName -match "docker" \| Remove-NetFirewallRule`. ③ 포트 허용 규칙도 함께: `netsh advfirewall firewall add rule name="nogada-server-3000" dir=in action=allow protocol=TCP localport=3000`. |
| 윈도에서 Docker 가 "Virtualization support not detected" | 작업 관리자 성능 탭에 가상화 **사용**이라고 나오는데도 그러면 BIOS 가 아니라 윈도 기능이다. 관리자 PowerShell: `dism /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart` + `featurename:VirtualMachinePlatform` + `bcdedit /set hypervisorlaunchtype auto` → 재부팅 → `wsl --update`. |
| 디스크가 찼다 | `docker system prune -a` (볼륨은 건드리지 않는다) + `backups/` 의 오래된 덤프. |

---

## 12. 참고

- 서버 환경변수 전부: `apps/server/.env.example`
- 배포 구성: `docker-compose.prod.yml` · 이미지: `apps/server/Dockerfile`
- 백업/복원: `scripts/backup.sh`
- 설계 근거: `docs/superpowers/specs/2026-08-10-account-character-design.md` §6, 규범 8·9
- 에셋 복원 절차: `assets/CREDITS.md`
