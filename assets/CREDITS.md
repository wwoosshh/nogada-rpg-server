# 에셋 출처 및 라이선스 대장

실제 에셋 파일은 `assets/licensed/` 에 두며 **버전 관리에서 제외된다** (재배포 금지 조항 대응).
이 문서만 커밋하며, 이것만으로 다른 환경에서 에셋을 재구성할 수 있어야 한다.

**규칙: 에셋을 추가하는 시점에 이 표를 함께 갱신한다.** 배포 직전 소급 정리는 사실상 불가능하다.

---

## 확인 체크리스트

새 팩을 추가할 때마다 아래를 확인하고 표에 기록한다.

- [ ] 상업 이용 가능 여부 — **무료판이 비상업 전용인 경우가 흔하다**
- [ ] 엔진 제한 유무 — "RPG Maker 전용" 표기 확인
- [ ] 편집·개변 허용 여부
- [ ] 크레딧 표기 의무 여부
- [ ] 재배포 조항 — 리포지토리 업로드 가능 여부

**동일 팩이라도 판매처에 따라 라이선스가 다르다.** finalbossblues 계열은 itch.io 판이 엔진 무관, RPG Maker 공식 스토어 판이 RPG Maker 전용이다. **에셋은 itch.io에서 구매한다.**

---

## 도입 완료 (2026-08-02 확인)

| 팩 | 제작자 | 구매처 | 가격 | 용도 | 상업 | 엔진제한 | 편집 | 크레딧 | 재배포 |
|---|---|---|---|---|---|---|---|---|---|
| [FREE RPG Tileset 32×32](https://pipoya.itch.io/pipoya-rpg-tileset-32x32) | Pipoya | itch.io | 무료 | 맵 타일셋 | ✅ | 없음 | ✅ | 권장 | ❌ 금지 |
| [FREE RPG Character Sprites 32×32](https://pipoya.itch.io/pipoya-free-rpg-character-sprites-32x32) | Pipoya | itch.io | 무료 | 플레이어·NPC | ✅ | 없음 | ✅ | 권장 | ❌ 금지 |
| [1000+ Fantasy RPG Icons](https://finalbossblues.itch.io/icons) | finalbossblues | itch.io | $6 | 아이템 아이콘 | ✅ | **없음** | ✅ | **불필요** | ❌ 금지 |
| [game-icons.net](https://game-icons.net/) | 다수 | 웹 | 무료 | 인터페이스 기호 (SVG) | ✅ | 없음 | ✅ | **CC BY — 의무** | — |
| Neo둥근모 Pro | 김중태(원본 둥근모꼴) / Dalgona `<me@dalgona.dev>` (변환·확장) | 사용자가 내려받아 제공 | 무료 | 게임 전체 글꼴 (DOM·캔버스 공통) | ✅ | 없음 | ✅ | **OFL — 의무** | ✅ **허용** |

**Pipoya 라이선스 원문:** `For commercial or personal use.` / `Use and edit freely.` / `Not redistribute or resell this assets.`

마지막 조항이 `assets/licensed/` 를 버전 관리에서 제외하는 근거다. 에셋을 리포지토리에 커밋하면 재배포에 해당한다.

### 글꼴만 예외로 저장소에 커밋한다

Neo둥근모 Pro 는 **SIL Open Font License 1.1** 이라 재배포가 명시적으로 허용된다 — 위 "커밋하지 않는다" 규칙의 유일한 예외다. 그래서 `apps/client/public/fonts/` 에 실제 파일(woff2·woff)이 들어 있다.

라이선스는 추측이 아니라 **폰트 파일의 `name` 테이블에서 직접 읽은 것**이다:

```
copyright:  Original font was released under the public domain by Jungtae Kim
            in 1990s. Conversion and additional character design by Dalgona.
            <me@dalgona.dev>
license:    This font software may be used, studied, modified, embedded and
            redistributed under the SIL Open Font License 1.1.
licenseUrl: https://scripts.sil.org/OFL
version:    Version 1.020
```

**OFL 의 의무:** 저작권·라이선스 고지를 함께 배포해야 하고, 폰트 자체를 단독으로 판매할 수 없으며, 개변본에 원래 이름을 그대로 쓸 수 없다. 이 프로젝트는 폰트를 고치지 않고 그대로 쓴다.

**게임 안 표기:** 상세 메뉴(B)의 설정 탭에 표시한다 — `apps/client/src/game/detailMenuTabs.ts` 의 `CREDITS`. 저장소의 이 문서는 플레이어가 볼 수 없으므로 게임 안에도 같은 내용이 있어야 한다. **한쪽만 고치면 두 곳이 다른 말을 하게 되므로 함께 갱신한다.**

**설계상 제약:** `unitsPerEm = 16` 인 비트맵 계열이라 글자 크기가 16 의 배수가 아니면 획이 반픽셀에 걸려 뭉개진다. 그래서 게임의 글자 크기는 16 과 32 만 쓴다 (`apps/client/src/game/gameText.ts` 의 `FONT_SIZE`).

### 로컬 배치 및 실제 규격

```
assets/licensed/
├─ Pipoya RPG Tileset 32x32/
│  ├─ [Base]BaseChip_pipo.png     256x4256 — 8x133 = 1,064 타일. 셋으로 나눠 전부 사용
│  ├─ LightShadow_pipo.png        256x192  — 그림자 오버레이
│  ├─ [A]_type1/                  각 34개, 32x160 = 1x5 — 애니메이션 프레임 5장.
│  │                              Tiled 에서 오토타일로 직접 못 씀
│  ├─ [A]_type2/                  각 34개, 64x96 = 2x3 = 6 타일 — RPG Maker 축약 포맷
│  ├─ [A]_type3/                  각 34개, **256x192 = 8x6 = 48 타일 — 완전히 펼친
│  │  │                           blob 이라 Tiled 에서 그대로 쓸 수 있다.**
│  │  │                           (예전 이 표는 셋 다 32x160 이라고 적어 두었다.
│  │  │                           그 오기 때문에 물·물가·지형 경계 오토타일이
│  │  │                           "Tiled 에서 못 쓴다" 로 잠겨 있었다.)
│  │  │                           물·폭포만 2048x192 인데, 그건 애니메이션
│  │  │                           8프레임을 가로로 이어 붙였기 때문이다.
│  │  │                           `pipoya-ground.png` 는 이 폴더의 `[A]Dirt4` 다
│  │  └─ not_animation/           그 첫 프레임만 잘라 둔 것. 256x192.
│  │                              `pipoya-water.png` 가 여기서 나온다
│  └─ SampleMap/                  완성 .tmx + 외부 .tsx 예제
├─ PIPOYA FREE RPG Character Sprites 32x32/
│  └─ Male/ Female/ Enemy/ Boss/ Animal/ Soldier/ Other/ Xmas/ ...
│     각 PNG 96x128 = 3열 x 4행, 프레임 32x32 (아래·왼쪽·오른쪽·위 4방향 걷기)
├─ icons_8.13.20/                 finalbossblues Time Fantasy Icons (최신판)
│  ├─ fullcolor/individual_32x32/ icon001.png ~ icon1023.png (1,023개)
│  ├─ fullcolor/icons_full_32.png 통합 시트
│  └─ quick_guide.png             아이콘 배치 개요 — 어떤 번호가 무엇인지 여기서 찾는다
├─ icons_12.26.19/                같은 팩 구판. 사용하지 않음
├─ game-icons.net.svg/icons/      CC BY 3.0 SVG 세트
├─ Door_Animation/ · Unorganized Parts/            Pipoya 타일셋 팩 보너스
└─ CharaMEL ver.0.4.0/ · Pipoya Character Sprite 32 Generator/   캐릭터 생성기 (선택)
```

### 아이콘 번호 → `items.csv` 이름 매핑 (Task 11 에서 결정)

아이콘 파일명이 `icon001.png` 형식이라 `items.csv` 의 `icon` 컬럼(`ore_copper` 등)과 직접 대응하지 않는다.
**수십 종까지는 수동 개명으로 간다** — 어떤 그림이 어떤 아이템인지는 사람이 눈으로 골라야 한다.

아이템이 수백 종이 되는 시점에는 이 방식이 무너지므로, 그때는 개명이 아니라 **설계 문서 4.5 의 「형태 × 재질 색상」
조합 생성**으로 넘어간다 — 곡괭이 실루엣 하나에 팔레트를 갈아끼워 재질 5종을 만드는 방식이라 애초에 아이콘 파일이
수백 개로 늘지 않는다. 지금의 수동 개명은 그 전환점 전까지 쓰는 방식이다.

아래 매핑은 `icons_8.13.20/fullcolor/individual_32x32/` 기준이다.

| items.csv 의 icon | 원본 | 그림 |
|---|---|---|
| `ore_copper` | icon945 | 갈색 광석 덩어리 |
| `ore_iron` | icon946 | 광석 덩어리 |
| `ore_mithril` | icon948 | 광석 덩어리 |
| `ingot_copper` | icon964 | 황동빛 주괴 |
| `ingot_iron` | icon961 | 회색 주괴 |
| `ingot_mithril` | icon963 | 청회색 주괴 |
| `plate_reinforced` | icon962 | 금속 판 |
| `pickaxe_copper` | icon544 | 곡괭이 |
| `pickaxe_reinforced` | icon545 | 곡괭이 |
| `pickaxe_iron` | icon546 | 곡괭이 |
| `hammer_copper` | icon933 | 망치 (붉은 머리) |
| `hammer_iron` | icon934 | 망치 (회색 머리) |
| `hammer_mithril` | icon940 | 망치 (청회색 머리) |
| `shard_ice` | icon880 | 얼음 조각 |
| `crystal_ice` | icon914 | 맑은 얼음 결정 |
| `log_soft` | icon958 | 무른 통나무 |
| `log_hard` | icon959 | 단단한 통나무 |
| `herb_common` | icon288 | 흔한 약초 |
| `herb_rare` | icon293 | 귀한 약초 |
| `chisel_copper` | icon930 | 구리빛 정 |
| `chisel_iron` | icon931 | 쇠빛 정 |
| `chisel_mithril` | icon929 | 청회색 정 |
| `axe_copper` | icon453 | 구리빛 도끼 |
| `axe_iron` | icon452 | 쇠빛 도끼 |
| `axe_mithril` | icon462 | 청회색 도끼 |
| `sickle_copper` | icon459 | 구리빛 낫 |
| `sickle_iron` | icon935 | 쇠빛 낫 |
| `sickle_mithril` | icon460 | 청회색 낫 |
| `crystal_pale` | icon918 | 옅은 청백색 결정 |
| `gem_blue` | icon982 | 파란 보석 |
| `gem_ice` | icon999 | 청록빛 보석 |
| `leaf_tea` | icon289 | 초록 잎 |
| `leaf_gold` | icon290 | 금빛 잎 |
| `fruit_red` | icon304 | 붉은 열매 |
| `fruit_gold` | icon305 | 금빛 열매 |
| `flower_lavender` | icon301 | 분홍 꽃 |
| `fruit_lime` | icon306 | 초록 열매 |
| `herb_sage` | icon294 | 청록 잎 다발 |
| `herb_aroma` | icon296 | 뿌리 달린 초록 허브 |
| `herb_millennium` | icon297 | 붉은 잎 허브 |
| `ore_silver` | icon969 | 은빛 광석 덩어리 |
| `ore_gold` | icon970 | 주황빛 광석 덩어리 |
| `ore_sapphire` | icon909 | 파란 보석 원석 |
| `ore_ruby` | icon910 | 붉은 보석 원석 |
| `ingot_silver` | icon960 | 파란빛 주괴 |
| `ingot_gold` | icon965 | 금빛 주괴 |
| `feather_ice` | icon875 | 하늘빛 깃털 |
| `feather_wood` | icon876 | 밝은 갈색 깃털 |
| `feather_mineral` | icon877 | 잿빛 깃털 |
| `feather_herb` | icon879 | 주홍 깃털 |
| `ring_ice` | icon802 | 금빛 반지 (파란 보석) |
| `ring_wood` | icon801 | 금빛 반지 (초록 보석) |
| `ring_mineral` | icon800 | 은빛 반지 (푸른 보석) |
| `ring_herb` | icon803 | 금빛 반지 (붉은 보석) |
| `plank_light` | icon956 | 밝은 갈색 널빤지 |
| `plank_dark` | icon957 | 짙은 갈색 널빤지 |
| `flask_gold` | icon284 | 금빛 액체가 담긴 넓은 병 |
| `flask_green` | icon278 | 초록 액체 병 (붉은 마개) |
| `flask_rose` | icon282 | 분홍빛이 피어오르는 병 |
| `flask_teal` | icon274 | 청록 액체 병 |
| `cloud_rain` | icon121 | 비 내리는 구름 |
| `cloud_snow` | icon122 | 눈 내리는 구름 |
| `cloud_storm` | icon124 | 잿빛 구름의 굵은 비 |
| `snowflake` | icon152 | 파란 눈송이 |

증표 8종은 나머지와 고르는 방식이 다르다 — **종류를 형태로, 계열을 색으로** 읽는다(깃털 = 속도증표,
반지 = 선별증표). 8종이 한 벌이라 가방에서 묻는 것이 "이게 무엇인가"보다 "내가 무슨 증표를 가졌는가"
이기 때문이다. 이 배정은 4배 확대 대조 시트로 눈으로 확인하고 승인한 것이다.

정제품 6종과 날씨 가루 4종도 같은 방식으로 고른다 — **계열을 형태로** 읽는다: 나무는 널빤지
(`plank_light`·`plank_dark`), 허브는 유리병(`flask_green`·`flask_rose`·`flask_teal`), 얼음은 하늘
(`cloud_rain`·`cloud_snow`·`cloud_storm`·`snowflake`). 나무 3단(`leaf_extract`)만 널빤지가 아니라
병(`flask_gold`)인데, 그것이 목재가 아니라 **잎을 우린 물**이기 때문이다. 이 10종도 4배 확대 대조
시트로 확인하고 승인한 배정이다.

재질별 색 구분은 팩에 있는 그림을 그대로 쓴 것이라 등급 간 대비가 약하다. 실제로 구분이 안 되면
**아이콘을 더 찾기보다 M2 의 팔레트 스왑을 앞당기는 쪽이 맞다** — 같은 실루엣에 색만 다른 편이
서로 다른 그림을 모아 놓은 것보다 등급 관계가 잘 읽힌다.

### `apps/client/public/` 복원 방법

빌드에는 에셋이 필요하지만 **리포지토리에 올리면 재배포에 해당**하므로
`apps/client/public/` 아래 `tilesets/` · `sprites/` · `icons/` 는 `.gitignore` 대상이다.
새 환경에서는 아래를 실행해 복원한다 (Git Bash 기준, 저장소 루트에서):

```bash
mkdir -p apps/client/public/tilesets apps/client/public/sprites apps/client/public/icons

CHR="assets/licensed/PIPOYA FREE RPG Character Sprites 32x32/PIPOYA FREE RPG Character Sprites 32x32"

cp "$CHR/Male/Male 01-1.png" apps/client/public/sprites/player.png

# 플레이어가 고르는 외형 — 아래 "플레이어 외형 대장" 표와 같은 내용이다.
while IFS=: read -r name src; do
  cp "$CHR/$src.png" "apps/client/public/sprites/${name}.png"
done <<'LOOKS'
blue_hat:Male/Male 04-1
olive_armor:Male/Male 09-1
silver_hair:Male/Male 16-1
rose_tunic:Female/Female 03-1
violet_hat:Female/Female 09-1
teal_robe:Female/Female 13-1
LOOKS

# 화자 스프라이트 — 아래 "화자 스프라이트 대장" 표와 같은 내용이다.
while IFS=: read -r name src; do
  cp "$CHR/$src.png" "apps/client/public/sprites/${name}.png"
done <<'NPCS'
npc_elder:Male/Male 07-1
npc_innkeeper:Female/Female 19-1
npc_child:Female/Female 20-1
npc_logger:Male/Male 14-1
npc_herbalist:Female/Female 17-1
npc_miner:Male/Male 12-1
NPCS

# 아이템 아이콘 64종 — 위 매핑 표와 같은 내용이다. items.csv 는 이 중 60종을 쓴다
# (ingot_iron·plate_reinforced·hammer_iron·hammer_mithril 은 아직 쓰는 아이템이
# 없는 예비 배정 4종. ore_mithril·ingot_mithril·pickaxe_reinforced 는 각각 mithril_ore·
# mithril_ingot·mithril_pickaxe(G5) 가 재사용하며 주인을 얻었고, chisel_mithril·
# axe_mithril·sickle_mithril 은 미스릴 정·도끼·낫(도구 루프 T2)의 것이다.
# feather_*·ring_* 8종은 증표 8종(경제 E2)의 것이고, plank_*·flask_*·cloud_*·
# snowflake 10종은 정제품 6종과 날씨 가루 4종(제작 확장 C2)의 것이다).
SRC="assets/licensed/icons_8.13.20/fullcolor/individual_32x32"
while IFS=: read -r name num; do
  cp "$SRC/icon${num}.png" "apps/client/public/icons/${name}.png"
done <<'ICONS'
ore_copper:945
ore_iron:946
ore_mithril:948
ingot_copper:964
ingot_iron:961
ingot_mithril:963
plate_reinforced:962
pickaxe_copper:544
pickaxe_reinforced:545
pickaxe_iron:546
hammer_copper:933
hammer_iron:934
hammer_mithril:940
shard_ice:880
crystal_ice:914
log_soft:958
log_hard:959
herb_common:288
herb_rare:293
chisel_copper:930
chisel_iron:931
chisel_mithril:929
axe_copper:453
axe_iron:452
axe_mithril:462
sickle_copper:459
sickle_iron:935
sickle_mithril:460
crystal_pale:918
gem_blue:982
gem_ice:999
leaf_tea:289
leaf_gold:290
fruit_red:304
fruit_gold:305
flower_lavender:301
fruit_lime:306
herb_sage:294
herb_aroma:296
herb_millennium:297
ore_silver:969
ore_gold:970
ore_sapphire:909
ore_ruby:910
ingot_silver:960
ingot_gold:965
feather_ice:875
feather_wood:876
feather_mineral:877
feather_herb:879
ring_ice:802
ring_wood:801
ring_mineral:800
ring_herb:803
plank_light:956
plank_dark:957
flask_gold:284
flask_green:278
flask_rose:282
flask_teal:274
cloud_rain:121
cloud_snow:122
cloud_storm:124
snowflake:152
ICONS
```

안내판(`kind=sign`)만 캐릭터 시트가 아니라 **타일셋에서 잘라 온다.** 마을들이 이미 세워 둔
그 나무 이정표(basechip 타일 229 + 237, 세로로 붙은 1×2)를 그대로 32×64 한 장으로 뜬다 —
사람이 아닌 화자를 사람 시트로 그리면 걸음 프레임도 방향도 없는데 있는 척하게 된다.
`Bitmap.Clone` 을 쓰는 이유는 위 물 시트와 같다: 화소를 그대로 옮긴다.

```powershell
Add-Type -AssemblyName System.Drawing
$src = (Resolve-Path "apps\client\public\tilesets\pipoya-basechip.png").Path
$img = New-Object System.Drawing.Bitmap($src)
# 타일 229 = 28행 5열, 타일 237 = 29행 5열. 8열 시트라 x = 5*32, y = 28*32, 세로 두 칸.
$rect = New-Object System.Drawing.Rectangle(160, 896, 32, 64)
$crop = $img.Clone($rect, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$crop.Save((Join-Path (Get-Location) "apps\client\public\sprites\sign_wood.png"),
           [System.Drawing.Imaging.ImageFormat]::Png)
$crop.Dispose(); $img.Dispose()
```

ImageMagick 이라면 한 줄이다:

```bash
magick apps/client/public/tilesets/pipoya-basechip.png -crop 32x64+160+896 +repage \
  apps/client/public/sprites/sign_wood.png
```

### 노드 스프라이트 대장

맵 위의 채집 노드가 세우는 그림. `csv/nodes.csv` 의 `sprite` 칸 → 파일 → 원본 타일이고,
클라이언트가 아는 목록은 `apps/client/src/game/nodeSprites.ts` 다. 화자와 같은 규칙으로
**모르는 id 를 만나면 그 자리에서 던지므로**, 이 표와 그 파일과 CSV 셋이 함께 움직인다.

**여덟 장 전부 32×32 한 칸이다.** 두 칸짜리 큰 나무를 쓰면 밑변 정렬과 y 정렬 깊이가
따라오는데(`apps/client/src/game/depth.ts` 의 `node = 5` 는 평면이다), 그것은 노드에 얼굴을
붙이는 일이 살 값이 아니다.

원본은 `[Base]BaseChip_pipo.png`(8열)이고 **타일 번호 = 행 × 8 + 열**이다. 아래 crop 좌표는
`pipoya-basechip.png` 기준인데, 그 시트가 원본의 0–63행을 그대로 뜬 것이라 원본 좌표와 같다.

| id | 파일 | 원본 타일 | crop | 가공 | 왜 이 그림인가 |
|---|---|---|---|---|---|
| `young_tree` | `young_tree.png` | 40 (r5c0) | `32x32+0+160` | — | 밝은 초록 잎이 꽉 찬 덤불. 고목과 **잎↔가지**로 갈리므로 색이 아니라 실루엣이 등급을 말한다 |
| `old_tree` | `old_tree.png` | 43 (r5c3) | `32x32+96+160` | — | 잎이 하나도 없고 가지만 뻗은 나무. 단단한 통나무가 나올 나무로 읽힌다 |
| `herb_patch` | `herb_patch.png` | 48 (r6c0) | `32x32+0+192` | — | 꽃 없는 초록 잎 포기. 팩에서 가장 "풀" 다운 그림이다 |
| `rare_herb_patch` | `rare_herb_patch.png` | 53 (r6c5) | `32x32+160+192` | — | 같은 크기의 포기가 분홍 꽃으로 덮였다. **꽃의 유무**가 등급이다 |
| `copper_vein` | `copper_vein.png` | 65 (r8c1) | `32x32+32+256` | 붉게(R ×1.25 + G ×0.10, G ×0.80, B ×0.45) | 팩에서 가장 밝은 바위. **그대로 쓰면 광물채굴장 지면과 같은 갈색이라 사라진다** — 실제로 얹어 보고 캡션 없이는 어느 것이 캘 수 있는지 못 골랐다. 붉게 돌려 산화 구리로 읽히게 했다 |
| `iron_vein` | `iron_vein.png` | 65 (r8c1) | `32x32+32+256` | 명도 행렬 + ×0.75 | 구리와 **한 채굴장에 나란히 서므로** 실루엣이 아니라 금속색이 갈라야 한다. 같은 바위에서 색을 빼고 어둡게 한 것 |
| `ice_vein` | `ice_vein.png` | 64 (r8c0) | `32x32+0+256` | R↔B 교환 + ×1.7 | **팩에 얼음이 없다.** 작은 바위의 빨강과 파랑을 맞바꾸면 황동빛이 청록이 된다. 밝혀서 옅은 조각으로 |
| `deep_ice_vein` | `deep_ice_vein.png` | 65 (r8c1) | `32x32+32+256` | R↔B 교환 | 같은 교환을 큰 바위에 하고 **밝히지 않은 것**. 크고 짙다 |

**팩의 셋째 바위(타일 66)는 쓰지 않는다.** 밑동이 반투명 디더라서 광물채굴장의 어두운 갈색
지면 위에 놓으면 바위가 아니라 **구덩이로 읽힌다** — 실제로 얹어 보고 기각했다. 철을 그 바위가
아니라 구리와 같은 바위의 색 변주로 간 이유가 이것이다.

**노드가 쓰는 타일은 그 맵의 소품에서 비웠다.** 고른 그림들은 팩의 자연 소품이고, 채집장들이
이미 같은 타일을 배경으로 깔고 있었다 — 나무수렵장의 `t40` ×26·`t43` ×6, 허브채집장의
`t48` ×37·`t53` ×26, 광물채굴장의 `t65` ×12. 그대로 두면 **같은 그림 30여 개 중 여덟 개만
캘 수 있는** 화면이 되어,
갈색 네모였을 때보다 오히려 구별이 나빠진다. 그래서 그림을 바꾸는 대신 그 맵들의 소품 107칸을
그 맵에 이미 깔려 있던 다른 타일로 옮겼다(`packages/data/maps/*.tmx`). 얼음 둘은 색을 돌려
그 맵에서 유일해졌으므로 얼음채집장은 손대지 않았다.

**타일을 비우는 것으로는 모자란 곳이 하나 있었다 — 광물채굴장.** 소품에서 `t65` 를 뺐어도
그 자리에 들어간 `t64`(작은 바위)가 같은 갈색 바위였고, 지면부터가 갈색이라 **원본 그대로의
구리는 노드가 아니라 지형으로 읽혔다.** 다섯 맵을 걸어 보고서야 보인 것이고, 그래서 구리도
철·얼음처럼 색을 돌렸다(위 표). 여기서 배울 것: **"그 타일을 비웠다"는 겹침의 필요조건이지
충분조건이 아니다.** 배경과 같은 색 계열이면 다른 타일이어도 묻힌다.

색을 돌린 뒤로는 광물채굴장의 그 12칸 치환이 더는 필요하지 않지만 되돌리지 않았다 — 작은
바위 소품이 채굴장에 어울리고, 필요 없어진 편집을 다시 편집하는 것이 얻는 것보다 위험하다.

**그 유일성은 맵 단위다 — 그 노드가 서는 맵에서만 그 타일이 노드다.** 맵을 넘으면 아직
겹친다: 허브채집장에 `t40` ×36(어린 나무 그림), 나무수렵장에 `t48` ×41(약초 군락 그림),
얼음채집장·광물채굴장에 `t43`(고목 그림). 각 노드는 자기 맵에만 서므로 한 화면에서 헷갈릴 일이
없고, 전 맵으로 넓히면 월드맵과 마을 넷까지 200칸 가까이 번져 값보다 비싸다. 그래서 일부러
맵 단위에서 멈춘 것이지 빠뜨린 것이 아니다.

> **새 채집장을 그리는 사람에게:** 그 맵에 노드를 놓았다면, 위 표의 여덟 타일 가운데 **그 맵에
> 서는 노드가 쓰는 것**을 그 맵의 `decor`·`walls` 에서 빼야 한다. 안 빼면 캘 수 있는 것과 배경이
> 같은 그림이 되어, 색칠한 네모였던 시절보다 구별이 나빠진다. **그리고 뺀 뒤에 한 번 걸어
> 봐야 한다** — 노드가 지면·남은 소품과 같은 색 계열이면 타일이 달라도 묻힌다(구리가 그랬다).
> `walls` 안에서의 gid 치환은
> 통행을 바꾸지 않는다 — 벽의 기준이 "어느 타일인가"가 아니라 "비어 있지 않은가"이기 때문이다
> (`placements.ts` 의 `parseTerrain`, `WorldScene.isWalkable`).

`nodes/` 도 `tilesets/`·`sprites/`·`icons/` 와 같이 **커밋하지 않는다.** 잘라 낸 것도 색을 돌린
것도 Pipoya 의 `Not redistribute or resell this assets` 아래 있다 — 편집 허용(`Use and edit
freely`)은 **개변 허가이지 재배포 허가가 아니다.** `.gitignore` 의 넷째 줄이 그 자리이고,
그 줄은 그림보다 **먼저** 들어갔다. 이 경로는 기본값이 추적이라 한 번 커밋되면 그 커밋 자체가
위반이기 때문이다.

여덟 장이 모두 `pipoya-basechip.png` 에서 나오므로 **위 타일셋 복원을 먼저 끝내야 한다.**

```bash
mkdir -p apps/client/public/nodes
S=apps/client/public/tilesets/pipoya-basechip.png
N=apps/client/public/nodes

magick "$S" -crop 32x32+0+160   +repage "$N/young_tree.png"
magick "$S" -crop 32x32+96+160  +repage "$N/old_tree.png"
magick "$S" -crop 32x32+0+192   +repage "$N/herb_patch.png"
magick "$S" -crop 32x32+160+192 +repage "$N/rare_herb_patch.png"

# 구리 — 빨강을 키우고 파랑을 절반 아래로 눌러 갈색 바위를 산화 구리로 만든다.
# 원본 그대로면 광물채굴장의 갈색 지면에 묻힌다. 철의 명도 행렬과 같은 자리에서
# 색을 정하는 것이라, 한 채굴장에 서는 둘이 붉은색↔무채색으로 갈린다.
magick "$S" -crop 32x32+32+256 +repage \
  -color-matrix "1.25 0.10 0 0 0.80 0 0 0 0.45" \
  -define png:color-type=6 "$N/copper_vein.png"

# 철 — 같은 바위에서 색을 빼고(명도 행렬) 4분의 3으로 어둡게 한다.
# png:color-type=6 이 없으면 세 채널이 같아진 김에 회색조 PNG 로 저장돼,
# 여덟 장 중 하나만 색 타입이 달라진다.
magick "$S" -crop 32x32+32+256 +repage \
  -color-matrix "0.299 0.587 0.114 0.299 0.587 0.114 0.299 0.587 0.114" \
  -channel RGB -evaluate multiply 0.75 +channel \
  -define png:color-type=6 "$N/iron_vein.png"

# 얼음 — 빨강과 파랑 채널을 맞바꾼다. 보통 등급만 1.7배 밝힌다.
magick "$S" -crop 32x32+0+256  +repage -color-matrix "0 0 1 0 1 0 1 0 0" \
  -channel RGB -evaluate multiply 1.7 +channel "$N/ice_vein.png"
magick "$S" -crop 32x32+32+256 +repage -color-matrix "0 0 1 0 1 0 1 0 0" "$N/deep_ice_vein.png"
```

**색 변주를 `-modulate`(HSL)로 하지 않은 것이 이 블록의 핵심이다.** 위 두 연산은 화소마다의
**순수 sRGB 정수 산술**이라 감마도 HSL 반올림도 끼지 않는다:

| 연산 | 산술 |
|---|---|
| `-color-matrix "0 0 1 0 1 0 1 0 0"` | `(r,g,b) → (b,g,r)` |
| `-color-matrix "0.299 0.587 0.114"` ×3행 | `(r,g,b) → (l,l,l)`, `l = 0.299r + 0.587g + 0.114b` |
| `-channel RGB -evaluate multiply m` | `c → min(255, round(c×m))`. 알파는 건드리지 않는다 |

화소를 실제로 재어 확인한 것이다. 원본 `(96,79,21)` 이 얼음에서 `(36,134,163)` 이 되는데
그것이 `round(21×1.7), round(79×1.7), round(96×1.7)` 과 같고, 철에서는 `l = 77.471` →
`round(77.471 × 0.75) = 58` → `(58,58,58)` 이다. **그러므로 ImageMagick 이 없는 환경에서도
이 표만 보고 같은 파일을 만들 수 있다** — 이 문서 하나로 재구성된다는 맨 위 규칙이
"명령이 적혀 있다"가 아니라 **"산술이 적혀 있다"** 수준으로 지켜진다.

규격 확인 (여덟 줄이 전부 `32x32` 여야 한다):

```powershell
Add-Type -AssemblyName System.Drawing
Get-ChildItem apps\client\public\nodes\*.png | ForEach-Object {
  $i = [System.Drawing.Bitmap]::new($_.FullName)
  "{0,-20} {1}x{2}" -f $_.Name, $i.Width, $i.Height
  $i.Dispose()
}
```

### 플레이어 외형 대장

캐릭터를 만들 때 고르는 외형. `packages/shared` 의 `APPEARANCES` → 파일 → 원본이고,
클라이언트가 아는 목록은 `apps/client/src/game/playerSprites.ts` 다. **셋이 함께 움직인다** —
`playerSprites.test.ts` 가 세 곳을 전수로 대조하고, 이 표에 빠진 id 는 그 테스트가 세운다
(설계 규범 4).

**모든 시트가 `player.png` 와 같은 96×128 = 3열 × 4행 규격이다**(설계 규범 13). 추출한 뒤
크기를 확인한다 — 규격이 다르면 프레임 번호가 통째로 어긋나 걷는 방향이 뒤섞이는데,
그건 게임을 켜서 걸어 봐야만 드러난다.

```powershell
Add-Type -AssemblyName System.Drawing
Get-ChildItem apps\client\public\sprites\*.png | Where-Object { $_.Name -ne 'sign_wood.png' } | ForEach-Object {
  $i = New-Object System.Drawing.Bitmap($_.FullName)
  "{0,-18} {1}x{2}" -f $_.Name, $i.Width, $i.Height
  $i.Dispose()
}
```

| APPEARANCES 의 id | 파일 | 원본 | 화면에 적히는 이름 | 왜 이 그림인가 |
|---|---|---|---|---|
| `player` | `player.png` | `Male/Male 01-1` | 은빛 갑옷 | 계정이 생기기 전부터 쓰던 시트. 옛 세이브의 기본값이라 목록에 남는다 |
| `blue_hat` | `blue_hat.png` | `Male/Male 04-1` | 파란 챙모자 | 챙 넓은 파란 모자. 32px 에서 실루엣만으로 갈리는 유일한 모자다 |
| `olive_armor` | `olive_armor.png` | `Male/Male 09-1` | 올리브 갑옷 | 어두운 올리브+금빛. 목록에서 가장 짙은 덩어리라 멀리서도 구별된다 |
| `silver_hair` | `silver_hair.png` | `Male/Male 16-1` | 은빛 머리 | 뻗친 은발 + 청회색. 모자도 투구도 없는 맨머리 쪽의 대표 |
| `rose_tunic` | `rose_tunic.png` | `Female/Female 03-1` | 분홍 상의 | 옆으로 묶은 머리 + 분홍 상의. 넷이 화려한 가운데 유일하게 수수하다 |
| `violet_hat` | `violet_hat.png` | `Female/Female 09-1` | 보라 모자 | 뾰족한 보라 모자 + 안경. 파란 챙모자와 색·모양이 둘 다 다르다 |
| `teal_robe` | `teal_robe.png` | `Female/Female 13-1` | 청록 예복 | 연보라 긴 머리 + 청록 예복. 목록에서 유일한 청록 계열 |

**서로 구별되는 것이 이 여섯 장의 조건이다** — 고르는 화면에 나란히 놓이므로, 화자 시트와
달리 "한 화면에 같이 안 나오니 비슷해도 된다" 가 통하지 않는다. 색이 여섯 방향(파랑·올리브·
은회색·분홍·보라·청록)으로 흩어지고 셋은 머리, 둘은 모자, 하나는 투구다. 성별도 셋씩 섞었다.
화자 여섯(`Male 07·12·14`, `Female 17·19·20`)과 플레이어 기본값(`Male 01-1`)은 피했다.

### 화자 스프라이트 대장

`csv/speakers.csv` 의 `sprite` 칸 → 파일 → 원본. 클라이언트가 아는 목록은
`apps/client/src/game/npcSprites.ts` 이고, **모르는 id 를 만나면 그 자리에서 던진다** —
그러니 이 표와 그 파일과 CSV 셋이 함께 움직인다.

| sprite | 파일 | 원본 | 누구 | 왜 이 그림인가 |
|---|---|---|---|---|
| `npc_elder` | `npc_elder.png` | `Male/Male 07-1` | 채집장 노인 | 초록 두건 + 흰 수염. 32px 에서 실루엣만으로 노인이 읽히는 유일한 남자 시트다 |
| `npc_innkeeper` | `npc_innkeeper.png` | `Female/Female 19-1` | 눈의 마을 여관 안주인 | 안경 쓴 백발 + 붉은 숄. 눈밭 위에서 붉은색이 유일하게 튄다 |
| `npc_child` | `npc_child.png` | `Female/Female 20-1` | 눈의 마을 아이 | 양갈래 머리에 몸집이 작아 어른들과 한눈에 갈린다 |
| `npc_logger` | `npc_logger.png` | `Male/Male 14-1` | 숲의 마을 벌목꾼 | 뻗친 머리 + 주황 상의. 숲의 초록 배경에서 사람이 배경에 묻히지 않는다 |
| `npc_herbalist` | `npc_herbalist.png` | `Female/Female 17-1` | 항구 마을 약초밭지기 | 쪽진 머리 + 앞치마. 일하는 사람으로 읽히는 가장 수수한 시트 |
| `npc_miner` | `npc_miner.png` | `Male/Male 12-1` | 북동쪽 마을 늙은 광부 | 벗어진 머리 + 회색 수염. 노인이되 두건 쓴 채집장 노인과 안 헷갈린다 |
| `sign_wood` | `sign_wood.png` | basechip 타일 229+237 | 안내판 | 사람이 아니다 — 위 잘라내기 참고 |

**플레이어(`Male 01-1`)와 겹치지 않게 고른 것이 이 여섯 장의 공통 조건이다.** 플레이어는 은빛
갑옷에 파란 장식이라, 위 여섯은 전부 그 조합을 피한다. 한 화면에 나오지 않는 조합(예: 항구의
약초밭지기와 눈의 마을 아이)은 서로 비슷해도 괜찮지만, 플레이어는 언제나 같은 화면에 있다.

타일셋은 **단순 복사가 아니라 여섯 장으로 잘라 잇는다** (아래 참조). PowerShell 에서, 저장소 루트에서:

```powershell
Add-Type -AssemblyName System.Drawing
$src = "assets\licensed\Pipoya RPG Tileset 32x32\Pipoya RPG Tileset 32x32\[Base]BaseChip_pipo.png"
$out = "apps\client\public\tilesets"
$img = New-Object System.Drawing.Bitmap((Resolve-Path $src))
# 원본 256x4256 을 행 0-63 / 64-127 / 128-132 으로 나눈다. 높이는 전부 2048 이하여야 한다.
foreach ($cut in @(
    @{ n = 'pipoya-basechip';   y = 0;    h = 2048 },
    @{ n = 'pipoya-basechip-2'; y = 2048; h = 2048 },
    @{ n = 'pipoya-basechip-3'; y = 4096; h = 160  })) {
  $rect = New-Object System.Drawing.Rectangle(0, $cut.y, 256, $cut.h)
  $crop = $img.Clone($rect, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $crop.Save("$out\$($cut.n).png", [System.Drawing.Imaging.ImageFormat]::Png)
  $crop.Dispose()
}
$img.Dispose()

# addwork 은 이미 384x2048 이라 자를 것이 없다 — 이름만 바꿔 복사한다.
Copy-Item "assets\licensed\Unorganized Parts\Unorganized Parts\addwork.png" "$out\pipoya-addwork.png"
```

물 시트는 자르는 것이 아니라 **오토타일 두 벌을 위아래로 잇는다.** 베이스칩에는 물이 없다.

```powershell
Add-Type -AssemblyName System.Drawing
$src = "assets\licensed\Pipoya RPG Tileset 32x32\Pipoya RPG Tileset 32x32\[A]_type3\not_animation"
$out = "apps\client\public\tilesets"
# -LiteralPath 가 필수다. 파일명의 [A] 는 Resolve-Path 에게 와일드카드로 읽힌다.
$deep  = New-Object System.Drawing.Bitmap((Resolve-Path -LiteralPath "$src\[A]Water1_pipo.png").Path)
$shore = New-Object System.Drawing.Bitmap((Resolve-Path -LiteralPath "$src\[A]Water7_pipo.png").Path)
$sheet = New-Object System.Drawing.Bitmap(256, 384, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($sheet)
# SourceCopy 라야 화소가 그대로 옮겨진다. 기본값(SourceOver)은 알파를 곱했다 푸는데,
# 이 두 시트는 48타일 중 47장이 반투명이라 그 오차가 물가 전체에 남는다.
$g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
$g.DrawImage($deep,  (New-Object System.Drawing.Rectangle(0,   0, 256, 192)), 0, 0, 256, 192, [System.Drawing.GraphicsUnit]::Pixel)
$g.DrawImage($shore, (New-Object System.Drawing.Rectangle(0, 192, 256, 192)), 0, 0, 256, 192, [System.Drawing.GraphicsUnit]::Pixel)
$g.Dispose()
$sheet.Save((Join-Path (Get-Location) "$out\pipoya-water.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$sheet.Dispose(); $deep.Dispose(); $shore.Dispose()
```

ImageMagick 이라면 한 줄이다:

```bash
SRC="assets/licensed/Pipoya RPG Tileset 32x32/Pipoya RPG Tileset 32x32/[A]_type3/not_animation"
magick "$SRC/[A]Water1_pipo.png" "$SRC/[A]Water7_pipo.png" -append \
  apps/client/public/tilesets/pipoya-water.png
```

`Bitmap.Clone` 은 화소를 그대로 옮긴다. `Graphics.DrawImage` 를 쓰면 알파가 곱해졌다 풀리면서
반투명 화소가 1/255 만큼 흔들린다 — 예전 이 문서의 방법이 그랬다.

ImageMagick 이 있다면 같은 것을 이렇게도 할 수 있다:

```bash
SRC="assets/licensed/Pipoya RPG Tileset 32x32/Pipoya RPG Tileset 32x32/[Base]BaseChip_pipo.png"
magick "$SRC" -crop 256x2048+0+0    +repage apps/client/public/tilesets/pipoya-basechip.png
magick "$SRC" -crop 256x2048+0+2048 +repage apps/client/public/tilesets/pipoya-basechip-2.png
magick "$SRC" -crop 256x160+0+4096  +repage apps/client/public/tilesets/pipoya-basechip-3.png
cp "assets/licensed/Unorganized Parts/Unorganized Parts/addwork.png" \
   apps/client/public/tilesets/pipoya-addwork.png
```

파일명 개명은 필수다. 원본 이름의 대괄호와 공백이 URL 인코딩 문제를 일으킨다.

지면 시트는 자를 것도 이을 것도 없다 — 팩의 blob 파일 하나를 이름만 바꿔 복사한다.

```bash
SRC="assets/licensed/Pipoya RPG Tileset 32x32/Pipoya RPG Tileset 32x32/[A]_type3"
cp "$SRC/[A]Dirt4_pipo.png" apps/client/public/tilesets/pipoya-ground.png
```

### 시트 여섯 장과 그 gid 구간

| 시트 | 원본 | 원본 행 | 크기 | 격자 | 타일 | gid |
|---|---|---|---|---|---|---|
| `pipoya-basechip.png` | `[Base]BaseChip_pipo.png` | 0–63 | 256×2048 | 8열 × 64행 | 512 | 1 – 512 |
| `pipoya-basechip-2.png` | 〃 | 64–127 | 256×2048 | 8열 × 64행 | 512 | 513 – 1024 |
| `pipoya-basechip-3.png` | 〃 | 128–132 | 256×160 | 8열 × 5행 | 40 | 1025 – 1064 |
| `pipoya-addwork.png` | `Unorganized Parts/addwork.png` | 전부 | 384×2048 | **12열** × 64행 | 768 | 1065 – 1832 |
| `pipoya-water.png` | `[A]_type3/not_animation/` 두 장 | — | 256×384 | 8열 × 12행 | 96 | 1833 – 1928 |
| `pipoya-ground.png` | `[A]_type3/[A]Dirt4_pipo.png` | — | 256×192 | 8열 × 6행 | 48 | 1929 – 1976 |

앞 세 장은 자른 순서대로 이어 붙였으므로 **gid = 원본 시트의 타일 번호 + 1** 이 시트 경계를 넘어
그대로 성립한다. `addwork` 만 열 수가 12 라 별도 계산이다: `gid = 1065 + (행 × 12 + 열)`.

`pipoya-water.png` 는 48타일짜리 blob 두 벌을 위아래로 이은 것이다.

| 블록 | 원본 파일 | 피포야가 붙인 지형 이름 | 그림 | gid |
|---|---|---|---|---|
| 위 (인덱스 0–47) | `[A]Water1_pipo.png` | `water1` | 짙은 남색 깊은 물 + 이끼 낀 돌 둔덕 | 1833 – 1880 |
| 아래 (인덱스 48–95) | `[A]Water7_pipo.png` | **`wave`** | 밝은 물 + **흰 물거품 물가** | 1881 – 1928 |

지형 이름은 `SampleMap/[A]Water_pipo.tsx` 의 `<terraintypes>` 에서 온다. 파일 이름과 어긋나 있다 —
그 시트는 type3 파일들을 **이름순**으로 이어 붙인 것이라 `[A]Water3_Cave1` 이 `water3`, `[A]Water3` 이
`water4` 가 됐다. 화소를 맞대어 확인한 대응이지 추측이 아니다.

**48타일 blob 은 인덱스가 곧 이웃 모양이다.** 인덱스 14(1행 6열)가 사방이 같은 종류인 한가운데,
인덱스 47은 빈 칸이고 절대 쓰지 않는다. 나머지 45개가 모서리·변·안쪽모서리다.
256가지 이웃 조합을 47개 인덱스로 접는 표는 `.superpowers/sdd/water-report.md` 에 있다.

`pipoya-ground.png` 는 같은 48타일 blob 하나짜리다 — `[A]Dirt4`, 팩에서 가장 차가운 청회색 지면.
**그 한가운데 타일(인덱스 14)은 베이스칩의 타일 7(gid 8)과 화소 단위로 같다.** 그래서 이 시트는
새 지면 색을 들여오는 것이 아니라, **이미 쓰고 있던 색에 가장자리를 붙여 주는 것**이다. 시트가
없을 때 맵의 지면 색이 바뀌는 자리가 전부 직각이던 이유가 이것이었다.

물과 같은 방식으로 겹친다: `ground` 에 불투명한 바닥(포장 또는 gid 8), 그 위 `decor` 에 blob 의
잘린 가장자리. **한가운데(인덱스 14)는 내보내지 않는다** — gid 8 과 같은 그림이라 깔아 봐야
`decor` 만 채우고, 그 자리는 소품을 놓을 칸으로 남는 편이 낫다.

### 물을 어느 레이어에 두는가

**두 시트 다 알파가 뚫린 오버레이다** — 48장 중 47장이 반투명이라 한 겹만 깔면 물가마다 배경이
비친다. 그래서 물은 "칸마다 타일 하나" 가 아니라 겹이다.

| 레이어 | 깊이 | 무엇이 들어가나 |
|---|---|---|
| `ground` | 0 | **불투명한 바닥.** 바다 밑은 모래, 호수 밑은 풀. 물 시트의 뚫린 가장자리가 비추는 것이 이것이다. 물에 닿는 뭍도 모래로 바꿔 해변을 만든다 |
| `walls` | 2 | **물 자체.** `walls` 는 비어 있지 않으면 못 지나가는 칸이므로(`packages/data` 의 `parseTerrain`, 클라이언트의 `isWalkable`) 물을 여기 두면 그리기와 막기가 한 번에 된다. 물가 한 줄은 `wave` blob, 그 안쪽은 깊은 물 한가운데 타일(gid 1847) |
| `decor` · `overhead` | 1 · 20 | 물은 안 쓴다. 비워 둔다 |

**왜 `walls` 인가:** 물은 못 지나가야 하고, 이 프로젝트에서 못 지나가는 칸은 `walls` 의 비어 있지
않은 칸 하나뿐이다. `decor` 에 그리면 예뻐도 걸어 들어가지고, `overhead` 는 플레이어 위에 그려진다.

**왜 물가 한 줄만 `wave` 인가:** `[A]Water1` 의 테두리는 이끼 낀 돌 둔덕이다. 바다 한가운데 그으면
걸어 다닐 수 있는 둔덕처럼 읽혀서 못 쓴다. 대신 물가 한 줄을 `wave`(흰 거품 + 밝은 얕은 물)로 두고
그 안쪽을 깊은 물 한가운데 타일로 채우면, 모래 → 거품 → 얕은 물 → 깊은 물이 된다.
반대로 **풀밭 속 호수에는 그 돌 둔덕이 정답이다** — 거품은 파도가 부서지는 곳에만 있다.
그래서 월드맵의 호수만 `[A]Water1` blob 을 그대로 쓴다.

이 순서와 `firstgid` 는 맵 열 장의 `.tmx` 에 그대로 적혀 있고, `packages/data` 의 `TILESET_NAMES` 가
같은 순서를 갖는다. **셋 중 하나만 바꾸면 세계의 모든 타일이 조용히 밀린다** — 그래서 빌드가
`firstgid` 가 앞 시트의 타일 수를 잇는지 검사한다(`parseTmx`).

무엇이 어디에 있는가(원본 행 기준):

- 0–63 — 자연 지형·바닥·마을 길·벽·울타리·나무·바위. 예전엔 이것만 있었다.
- 64–69 — 실내 바닥과 벽지, 계단.
- **70–75 — 지붕 여덟 색과 그 박공·모서리.** 벽은 세울 수 있는데 지붕을 못 얹던 이유가 여기였다.
- 76–110 — 실내 가구 전부: 침대 네 색, 부엌, 벽난로, 책장, 탁자, 소품.
- 111–127 — 분수·음식·무기·상자 등 소품.
- 128–132 — 상점 진열용 소품(갑옷·옷걸이·무기 거치대·방패·열쇠).
- `addwork` — 큰 나무 4×4, 마른 나무, 노점, 걸개 간판, 묘비, 절벽면, 산봉우리.

### ⚠️ 시트 높이를 2048px 이하로 유지하는 이유 — 모바일 WebGL 텍스처 한계

원본 `[Base]BaseChip_pipo.png` 는 **256×4256** 이다. 안드로이드 WebView 의 WebGL `MAX_TEXTURE_SIZE` 는
기기에 따라 다르며 검증에 쓴 에뮬레이터는 **4096** 이었다. 160px 초과라 텍스처 업로드가 실패하고
**맵 타일이 전부 검게 렌더링된다.** 데스크톱 GPU 는 한계가 높아 그대로 보이므로 브라우저 테스트만으로는
드러나지 않는다. Task 6(안드로이드 빌드)에서 발견했다.

**2048px 를 고른 근거:** 저사양 안드로이드 상당수가 `MAX_TEXTURE_SIZE = 2048` 이라 가장 넓은 호환성을 준다.

**한동안 첫 512 타일만 남기고 나머지를 버렸다.** 그 512 타일로는 지붕도 가구도 침대도 놓을 수 없었다 —
타일셋 제작자 자신의 샘플 맵이 쓰는 basechip 타일 306종 중 114종(37%)이, 그 맵의 `building_up`
레이어 62종 중에서는 49종(79%)이 잘려 나간 쪽에 있었다. 이제는 **버리지 않고 나눈다.** 자르는 자리를
64행·128행 경계에 둔 덕에 첫 장의 타일 번호는 예전과 한 칸도 다르지 않고, 이미 그린 맵 열 장이
그대로 남았다.

시트를 더하거나 크기를 바꾸면 **`.tmx` 의 타일셋 메타데이터(`tilecount`/`columns`/`width`/`height`)와
`firstgid` 도 함께 고쳐야 하고**, `packages/data` 의 `TILESET_NAMES` 에 이름을 넣어야 한다. 빌드가
둘을 다 검사한다 — 이름을 모르면 "클라이언트가 모르는 타일셋" 으로, `firstgid` 가 안 맞으면
"앞 시트의 타일 수를 이어야 한다" 로 세운다.

> 반대로 **맵 파일(`packages/data/maps/*.tmx`)은 우리가 만든 저작물이므로 커밋한다.**
> `world.json` 은 더 이상 커밋 대상이 아니다 — Task 1 부터 빌드가 `.tmx` 를 직접 읽어
> `packages/data/src/generated/maps/` 에 만들어 내는 생성물이다(수동 Export 가 사라졌다).

**Tiled 에서 맵을 열 때 타일셋 이미지 경로:** 맵들은 타일셋을
`apps/client/public/tilesets/pipoya-*.png` (위 "복원 방법" 참고)로 가리킨다. 그
경로에 여섯 장을 모두 복원해 두지 않으면 **Tiled 에서 맵을 열었을 때 타일셋이 깨진 채로
보인다** — 다만 이건 Tiled 편집 화면에만 해당하고, **게임 실행(빌드·테스트·클라이언트)에는
영향이 없다.** 빌드도 클라이언트도 이 경로 문자열 자체를 읽지 않기 때문이다(클라이언트는
`WorldScene.ts` 의 `preload()` 에 적힌 별도 키로 그림을 찾는다).

### 도구

| 도구 | 용도 | 상태 |
|---|---|---|
| [Tiled](https://www.mapeditor.org) | 맵 편집 | ✅ 설치됨 (1.12.2) |

Tiled **프로젝트 파일은 선택 사항**이다. 맵 하나를 다루는 동안은 `.tmx` 를 직접 열고 닫는 편이 단순하다.
`.tiled-session` 은 사용자별 편집 상태이므로 커밋하지 않는다.

## 도입 검토 (M1 통과 후)

프로토타입 단계에서는 유료 에셋을 구매하지 않는다. M1에서 코어 루프의 재미가 검증된 뒤 구매한다.

| 팩 | 제작자 | 구매처 | 용도 |
|---|---|---|---|
| [Time Fantasy RPG Sprites 2 (Monsters)](https://finalbossblues.itch.io/time-fantasy-monsters) | finalbossblues | **itch.io** | 몬스터 |

### ⚠️ Time Fantasy 계열 타일셋은 보충재가 아니라 **교체재**다

[Fantasy RPG Tileset Pack](https://finalbossblues.itch.io/fantasy-rpg-tileset-pack)($15)을
"본편 맵 타일셋" 으로, 즉 Pipoya 에 얹어 쓸 보충재로 적어 두었었다. **그럴 수 없다.**

finalbossblues / Time Fantasy 계열의 타일 그림은 원래 **16×16 을 200% 확대한 것**이라
32×32 칸 안의 실제 픽셀 밀도가 Pipoya 의 절반이다. 한 맵 안에 섞으면 같은 화면에서 픽셀
크기가 두 배 차이 나서, 어느 쪽도 "일부러 그런 것" 으로 안 보이고 그냥 잘못 만든 화면이 된다.
칸 크기가 같다는 것은 섞을 수 있다는 뜻이 아니다.

그러므로 이 팩을 들이는 결정은 "타일을 더 산다" 가 아니라 **"맵 그림 전부를 갈아엎는다"** 이고,
그러면 이미 그린 맵의 타일 id 가 전부 무의미해진다. M1 이후에 그런 결정을 내리더라도
Pipoya 와 병행이 아니라 한쪽을 고르는 문제로 다뤄야 한다. 몬스터 스프라이트는 다르다 —
캐릭터는 타일 격자에 얹히지 않아 밀도 차이가 훨씬 덜 드러난다.

## 검토했으나 보류

| 팩 | 사유 |
|---|---|
| [Sprout Lands](https://cupnooble.itch.io/sprout-lands-asset-pack) | 16×16. 무료판은 **상업 이용 불가**(수정본 포함), 상업 이용 시 유료판 필수 |
| [Mystic Woods](https://game-endeavor.itch.io/mystic-woods) | 16×16. 무료판 상업 이용 불가. 유료판도 **재배포 금지**(리포지토리 업로드 포함) |

---

## 크레딧 표기 문안 (배포 시 게임 내 표시)

game-icons.net은 CC BY 3.0이므로 표기가 **의무**다. 실제 사용한 아이콘의 원저자를 확인해 아래에 추가한다.

```
(도입 후 작성)
```
