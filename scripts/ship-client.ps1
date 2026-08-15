<#
.SYNOPSIS
빌드한 클라이언트 dist 를 서버 PC 로 밀어 넣는다 — **관문 둘을 먼저 통과시킨 뒤에.**

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
pwsh -File scripts/ship-client.ps1 -Destination '\\100.125.30.85\c$\nogada-server\nogada-rpg-server\apps\client\dist'
#>
# **이 파일의 BOM 을 지우지 마라.** Windows PowerShell 5.1 은 BOM 이 없는 .ps1 을
# 시스템 ANSI 코드페이지로 읽어서, 한글이 깨지는 데서 그치지 않고 **파서가 선다**
# (실측: `Unexpected token`). 서버 PC 에 pwsh 7 이 있다는 보장이 없어 5.1 에서
# 도는 것을 전제로 한다 — 식별자를 전부 영문으로 둔 것도 같은 이유다. BOM 이
# 날아가도 메시지만 깨지고 스크립트는 계속 돈다.
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
$baked = Get-ChildItem -LiteralPath (Join-Path $dist 'assets') -Filter *.js -File |
  Select-String -Pattern 'localhost:3000', '100\.125\.30\.85' -AllMatches
if ($baked) {
  $baked | ForEach-Object { Write-Host "  $($_.Filename):$($_.LineNumber)" }
  throw 'dist 번들에 서버 주소가 박혀 있다 — apps/client/.env.production 이 비어 있는지 본다.'
}

# --- 옮기기 -------------------------------------------------------------------
# `/MIR` 다: 지난 릴리스의 번들 파일 이름은 해시가 달라 그냥 두면 계속 쌓인다.
# 그리고 `index.html` 이 가리키지 않는 옛 번들이 남아 있으면, 무엇이 올라가 있는지
# 폴더를 봐서는 알 수 없게 된다.
#
# **목적지를 지우는 명령이므로** 위 관문 둘 뒤에 둔다 — 빈 dist 를 미러하면
# 서버 PC 의 멀쩡한 화면을 지우고 아무것도 안 남긴다.
Write-Host "옮긴다: $dist -> $Destination"
robocopy $dist $Destination /MIR /NFL /NDL /NJH /NP
# robocopy 는 0~7 이 성공이다(8 이상이 실패). 그대로 두면 성공한 복사가
# `$LASTEXITCODE = 1`(파일이 복사됨)로 스크립트를 세운다.
if ($LASTEXITCODE -ge 8) { throw "robocopy 가 실패했다(코드 $LASTEXITCODE)." }

# 서버를 재시작할 필요가 없다는 것을 적어 둔다 — 안 적으면 다음 사람이 매번
# 서비스를 껐다 켠다. @fastify/static 은 wildcard 기본값이라 요청 때마다
# 파일시스템을 보므로, 새 파일이 그 자리에서 나간다(clientDist.test.ts).
Write-Host '끝났다. 서버는 재시작하지 않아도 된다 — 다음 요청부터 새 화면이 나간다.'
Write-Host '눈으로 한 번: 브라우저에서 강력 새로고침(Ctrl+Shift+R) 하고 그림이 뜨는지 본다.'

# **성공을 성공으로 말한다.** robocopy 는 "파일을 복사했다"에 1 을 주는데, 그대로
# 두면 스크립트의 종료 코드가 1 이 되어 부르는 쪽에는 실패로 보인다 — 관문을 다
# 통과하고 옮기기까지 끝낸 실행이 그렇게 되면 다음 사람은 스크립트를 안 믿는다.
exit 0
