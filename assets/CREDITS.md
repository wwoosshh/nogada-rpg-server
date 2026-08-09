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
│  │                              blob 이라 Tiled 에서 그대로 쓸 수 있다.**
│  │                              (예전 이 표는 셋 다 32x160 이라고 적어 두었다.
│  │                              그 오기 때문에 물·물가·지형 경계 오토타일이
│  │                              "Tiled 에서 못 쓴다" 로 잠겨 있었다.)
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
**M1 은 수동 개명으로 간다** — 13종뿐이고, 어떤 그림이 어떤 아이템인지는 사람이 눈으로 골라야 한다.

M2 에서 아이템이 수백 종이 되면 이 방식은 무너지지만, 그때는 개명이 아니라 **설계 문서 4.5 의 「형태 × 재질 색상」
조합 생성**으로 넘어간다 — 곡괭이 실루엣 하나에 팔레트를 갈아끼워 재질 5종을 만드는 방식이라 애초에 아이콘 파일이
수백 개로 늘지 않는다. 즉 지금의 수동 개명은 그 방식으로 가기 전까지의 임시 조치이고, 확장할 계획이 없다.

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

재질별 색 구분은 팩에 있는 그림을 그대로 쓴 것이라 등급 간 대비가 약하다. 실제로 구분이 안 되면
**아이콘을 더 찾기보다 M2 의 팔레트 스왑을 앞당기는 쪽이 맞다** — 같은 실루엣에 색만 다른 편이
서로 다른 그림을 모아 놓은 것보다 등급 관계가 잘 읽힌다.

### `apps/client/public/` 복원 방법

빌드에는 에셋이 필요하지만 **리포지토리에 올리면 재배포에 해당**하므로
`apps/client/public/` 아래 `tilesets/` · `sprites/` · `icons/` 는 `.gitignore` 대상이다.
새 환경에서는 아래를 실행해 복원한다 (Git Bash 기준, 저장소 루트에서):

```bash
mkdir -p apps/client/public/tilesets apps/client/public/sprites apps/client/public/icons

cp "assets/licensed/PIPOYA FREE RPG Character Sprites 32x32/PIPOYA FREE RPG Character Sprites 32x32/Male/Male 01-1.png" \
   apps/client/public/sprites/player.png

# 아이템 아이콘 13종 — 위 매핑 표와 같은 내용이다.
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
ICONS
```

타일셋은 **단순 복사가 아니라 네 장으로 잘라야 한다** (아래 참조). PowerShell 에서, 저장소 루트에서:

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

### 시트 네 장과 그 gid 구간

| 시트 | 원본 | 원본 행 | 크기 | 격자 | 타일 | gid |
|---|---|---|---|---|---|---|
| `pipoya-basechip.png` | `[Base]BaseChip_pipo.png` | 0–63 | 256×2048 | 8열 × 64행 | 512 | 1 – 512 |
| `pipoya-basechip-2.png` | 〃 | 64–127 | 256×2048 | 8열 × 64행 | 512 | 513 – 1024 |
| `pipoya-basechip-3.png` | 〃 | 128–132 | 256×160 | 8열 × 5행 | 40 | 1025 – 1064 |
| `pipoya-addwork.png` | `Unorganized Parts/addwork.png` | 전부 | 384×2048 | **12열** × 64행 | 768 | 1065 – 1832 |

앞 세 장은 자른 순서대로 이어 붙였으므로 **gid = 원본 시트의 타일 번호 + 1** 이 시트 경계를 넘어
그대로 성립한다. `addwork` 만 열 수가 12 라 별도 계산이다: `gid = 1065 + (행 × 12 + 열)`.

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
경로에 네 장을 모두 복원해 두지 않으면 **Tiled 에서 맵을 열었을 때 타일셋이 깨진 채로
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
