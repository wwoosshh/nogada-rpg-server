<#
.SYNOPSIS
빌드한 클라이언트 dist 를 서버 PC 로 밀어 넣는다 — **관문 셋을 먼저 통과시킨 뒤에.**

.DESCRIPTION
왜 사람이 옮기는가: `.github/workflows/deploy.yml` 은 서버만 배포하고 클라이언트를
빌드하지도 복사하지도 않는다. 그리고 서버 PC 에는 라이선스 에셋이 없어서
(docs/deploy.md 의 "미니PC 는 그림을 모른다") 거기서 빌드할 수도 없다. 즉 릴리스마다
그림을 가진 개발 PC 에서 빌드한 dist 를 사람이 옮기는 것이 이 프로젝트의 절차다.
**이것을 CI 로 자동화하면 안 된다** — 러너에도 그림이 없으므로 그림 없는 사이트가
조용히 올라간다.

이 스크립트가 하는 일은 그 수동 절차에서 사람이 빠뜨리는 것을 대신 세는 것이다.
빠뜨리면 폰에서야 발견되고, 그때는 무엇이 틀렸는지 화면이 말해 주지 않는다.

  1. 에셋이 실제로 들어갔는가. 라이선스 에셋은 `.gitignore` 대상이고 **비어 있어도
     빌드는 에러 없이 끝난다** — 그림 없는 게임이 나가는 유일한 경로가 이것이다.
  2. 번들에 서버 주소가 박혔는가. 0 이어야 한다(같은 오리진 서빙).
     이 관문은 테스트에도 있다(apps/client/src/api/apiBase.test.ts) — 여기 다시
     두는 이유는 **옮기기 직전의 dist** 를 재기 위해서다. 테스트가 초록이던 시점과
     지금 폴더에 있는 것이 같다는 보장은 아무 데도 없다.
  3. 번들에 숨은 문턱이 새는가. 드랍 확률·채집 브라켓 확률·결계 좌표·소스맵이다
     (apps/client/src/hiddenThresholds.test.ts). 2번과 **같은 이유로 여기 있고,
     여기 있어야 하는 이유는 2번보다 크다** — 주소는 새도 다시 배포하면 그만이지만
     한 번 받아 간 번들은 회수하지 못한다. 그리고 이 스크립트는 기본적으로 dist 를
     새로 굽는다: 그렇게 구운 dist 는 그 순간까지 어떤 테스트도 본 적이 없고,
     CI 는 클라이언트를 빌드하되 **배포하지 않는다**(deploy.yml 은 서버만). 즉
     공개로 나가는 그 폴더를 재는 자는 여기 말고는 없다.

.PARAMETER Destination
서버 PC 의 `apps\client\dist` 자리. robocopy 가 아는 경로면 무엇이든 된다.

Tailscale 로 두 기계가 이미 붙어 있으므로(개발 PC 100.96.41.41, 서버
100.125.30.85) 관리 공유가 가장 손이 덜 간다:

  \\100.125.30.85\c$\nogada-server\nogada-rpg-server\apps\client\dist

sshd 를 켜 둔 서버라면 대신 이렇게 해도 된다(이 스크립트를 안 쓰고):

  scp -r apps/client/dist/* user@100.125.30.85:/c/nogada-server/nogada-rpg-server/apps/client/dist/

**이 자리를 고른 이유**는 배포가 그 폴더를 안 지우기 때문이다. dist 는 gitignore
대상이고 배포 워크플로는 `git clean` 을 일부러 안 돌리므로(.env·node_modules 이
거기 있다), 한 번 밀어 넣은 화면은 `git reset --hard` 를 지나도 그대로 남는다.
서버의 기본값도 그 자리다(config.ts 의 CLIENT_DIST).

.PARAMETER SkipBuild
빌드를 다시 하지 않고 지금 폴더에 있는 것을 그대로 잰다.

.EXAMPLE
powershell -File scripts/ship-client.ps1 -Destination '\\100.125.30.85\c$\nogada-server\nogada-rpg-server\apps\client\dist'
#>
# **이 파일의 BOM 을 지우지 마라.** Windows PowerShell 5.1 은 BOM 이 없는 .ps1 을
# 시스템 ANSI 코드페이지로 읽어서, 한글이 깨지는 데서 그치지 않고 **파서가 선다**
# (실측: `Unexpected token`).
#
# 5.1 을 전제로 하는 이유는 **이 스크립트가 도는 자리**다. 서버 PC 가 아니라
# 그림을 가진 **개발 PC** 에서 돌고(서버 PC 는 robocopy 의 목적지일 뿐이다), 그
# 개발 PC 에 pwsh 7 이 없다 — 실측: `where pwsh` 0건, 있는 것은
# `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe` 하나다. 그래서
# 문서와 위 .EXAMPLE 도 `powershell -File` 로 부른다(전에는 `pwsh -File` 이라
# 적혀 있었다 — 이 PC 에서 그대로 치면 명령이 없다고 선다). 식별자를 전부 영문으로
# 둔 것도 같은 이유이고, BOM 이 날아가도 메시지만 깨지고 스크립트는 계속 돈다.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Destination,
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
# 저장소 루트에서 도는 것을 전제로 경로를 적는다 — backup.sh 와 같은 자세다.
Set-Location (Join-Path $PSScriptRoot '..')

$dist = Join-Path (Get-Location) 'apps/client/dist'

if (-not $SkipBuild) {
  # `data:build` 를 먼저 부르는 이유: 맵 JSON 은 빌드 생성물이라 저장소에 없고,
  # vite 의 closeBundle 이 그것을 dist 로 복사한다. 없으면 빌드가 거기서 선다.
  pnpm data:build
  if ($LASTEXITCODE -ne 0) { throw '데이터 굽기가 실패했다.' }
  # 셸 환경변수로 주소를 넘기지 않는다. `.env.production` 이 값을 갖는다 —
  # PowerShell 에서 `$env:VITE_API_BASE_URL = ''` 는 값을 비우는 게 아니라
  # 변수를 **삭제해서**, `.env.local` 의 localhost 가 그대로 번들에 박힌다(실측).
  pnpm --filter @nogada/client build
  if ($LASTEXITCODE -ne 0) { throw '클라이언트 빌드가 실패했다.' }
}

if (-not (Test-Path -LiteralPath $dist)) {
  throw "dist 가 없다: $dist — 먼저 pnpm --filter @nogada/client build 를 돌린다."
}

# --- 관문 1: 그림이 실제로 들어갔는가 -----------------------------------------
# 네 폴더는 라이선스 에셋의 public/ 복사본이다(루트 .gitignore 참고). 하나라도
# 비면 그 종류가 통째로 안 보이는 게임이 나간다 — 그리고 빌드는 성공한 채로다.
$assetDirs = @('tilesets', 'icons', 'sprites', 'nodes')
$empty = @()
foreach ($dir in $assetDirs) {
  $path = Join-Path $dist $dir
  $count = 0
  if (Test-Path -LiteralPath $path) {
    $count = (Get-ChildItem -LiteralPath $path -Recurse -File | Measure-Object).Count
  }
  Write-Host ("  {0,-10} {1,6} 개" -f $dir, $count)
  if ($count -eq 0) { $empty += $dir }
}
if ($empty.Count -gt 0) {
  throw ("에셋이 비어 있다: {0} — 이 PC 의 apps/client/public/ 에 그림을 복원한다(assets/CREDITS.md)." -f ($empty -join ', '))
}

# --- 관문 2: 번들에 서버 주소가 박혔는가 --------------------------------------
# 0 이어야 한다. 박혀 있으면 주소가 바뀔 때마다 재빌드가 필요하고, HTTPS 페이지가
# 평문 API 를 부르는 혼합 콘텐츠가 되어 브라우저가 요청 자체를 막는다.
#
# **dist 전체를 재귀로 훑는다.** 전에는 `assets\*.js` 한 층만 봤는데, 그 이름이
# 약속하는 것("번들에 0건")보다 재는 자리가 좁았다 — CSS·index.html·assets 밖으로
# 나오는 산출물이 통째로 빠져, vite 설정이 바뀌어 청크가 다른 폴더로 나가는 날
# 관문이 조용히 눈을 감는다. apps/client/src/api/apiBase.test.ts 도 같은 범위다.
$textExt = @('.js', '.mjs', '.css', '.html', '.json')
$scanned = @(Get-ChildItem -LiteralPath $dist -Recurse -File |
  Where-Object { $textExt -contains $_.Extension.ToLower() })
# 한 건도 안 잡히면 이 관문은 아무것도 안 재고 통과한다 — 빈 dist 를 미러하는
# 것이 바로 아래 명령이라 그 통과가 가장 비싸다.
if ($scanned.Count -eq 0) {
  throw "dist 에서 읽을 파일이 하나도 없다: $dist — 빌드가 실제로 끝났는지 본다."
}
$baked = $scanned | Select-String -Pattern 'localhost:3000', '100\.125\.30\.85' -AllMatches
if ($baked) {
  $baked | ForEach-Object { Write-Host "  $($_.Filename):$($_.LineNumber)" }
  throw 'dist 번들에 서버 주소가 박혀 있다 — apps/client/.env.production 이 비어 있는지 본다.'
}

# --- 관문 3: 번들에 숨은 문턱이 새는가 ----------------------------------------
# 자를 여기 다시 안 적고 **테스트 파일을 그대로 부른다**. 서명은 구운 JSON 에서
# 읽히므로 CSV 를 고쳐도 자가 따라오고, 여기 Select-String 으로 베껴 적으면 그
# 순간부터 두 자가 서로 다른 말을 하기 시작한다.
#
# 파일 하나만 지목해서 도는 데 실측 1.5초다 — 옮기기 절차에 체감이 없다.
# 그리고 이 자는 dist 가 없으면 그 부분을 건너뛰는데, 여기서는 위에서 dist 의
# 존재를 이미 확인했으므로 반드시 실제로 잰다.
Write-Host '숨은 문턱을 잰다(드랍 확률·채집 브라켓·결계 좌표·소스맵)...'
pnpm vitest run apps/client/src/hiddenThresholds.test.ts
if ($LASTEXITCODE -ne 0) {
  throw '숨은 문턱이 번들에 샜다 — 위 실패가 어느 표인지 말한다. 이 dist 를 옮기지 마라.'
}

# --- 옮기기 -------------------------------------------------------------------
# `/MIR` 다: 지난 릴리스의 번들 파일 이름은 해시가 달라 그냥 두면 계속 쌓인다.
# 그리고 `index.html` 이 가리키지 않는 옛 번들이 남아 있으면, 무엇이 올라가 있는지
# 폴더를 봐서는 알 수 없게 된다.
#
# **목적지를 지우는 명령이므로** 위 관문 셋 뒤에 둔다 — 빈 dist 를 미러하면
# 서버 PC 의 멀쩡한 화면을 지우고 아무것도 안 남긴다.
Write-Host "옮긴다: $dist -> $Destination"
robocopy $dist $Destination /MIR /NFL /NDL /NJH /NP
# robocopy 는 0~7 이 성공이다(8 이상이 실패). 그대로 두면 성공한 복사가
# `$LASTEXITCODE = 1`(파일이 복사됨)로 스크립트를 세운다.
if ($LASTEXITCODE -ge 8) { throw "robocopy 가 실패했다(코드 $LASTEXITCODE)." }

# 서버를 재시작할 필요가 없다는 것을 적어 둔다 — 안 적으면 다음 사람이 매번
# 서비스를 껐다 켠다. @fastify/static 은 wildcard 기본값이라 요청 때마다
# 파일시스템을 보므로 새 파일이 그 자리에서 나가고, **기동 때 dist 가 없었어도**
# 그렇다(첫 ship 이 정확히 그 경우다 — clientDist.test.ts 의 두 검사).
Write-Host '끝났다. 서버는 재시작하지 않아도 된다 — 다음 요청부터 새 화면이 나간다.'
# 강력 새로고침을 시키지 않는다: 실측한 응답이 `cache-control: public, max-age=0`
# 에 ETag 라, 브라우저는 평범한 방문에서도 조건부 요청을 보내고 바뀐 index.html 을
# 그 자리에서 받는다. 안 통하는 지시를 안내로 남기면 다음 사람이 계속 반복한다.
Write-Host '눈으로 한 번: 브라우저에서 새로고침하고 그림이 뜨는지 본다.'

# **성공을 성공으로 말한다.** robocopy 는 "파일을 복사했다"에 1 을 주는데, 그대로
# 두면 스크립트의 종료 코드가 1 이 되어 부르는 쪽에는 실패로 보인다 — 관문을 다
# 통과하고 옮기기까지 끝낸 실행이 그렇게 되면 다음 사람은 스크립트를 안 믿는다.
exit 0
