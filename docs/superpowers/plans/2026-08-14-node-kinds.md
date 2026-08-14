# 노드의 종류 구현 계획 (아크 B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** 채집장 넷에 특수 노드가 하나씩 서고, **넷이 서로 다른 조건에서만 열리며**,
거기서만 나오는 재료 넷이 채집 도구의 **4단**을 연다.

**설계 문서:** `docs/superpowers/specs/2026-08-14-node-kinds-design.md` —
**§13-앞 이 다른 모든 절보다 우선한다.**

## Global Constraints

- **규범마다 그 규범을 무는 검사를 같은 태스크에서 짠다.** §13-앞 이 "아직 무는 코드가
  없는 규범" 일곱을 표로 적어 뒀다. **직전 아크의 가장 비싼 교훈이 이것이다** — 규범을
  적고 검사를 안 짜면 최종 리뷰가 그 대가를 셋 찾는다.
- **숫자는 재서 말한다. 측정 조건(손·숙련·척도)을 안 적은 숫자는 쓰지 않는다.**
  스펙 §0-1 이 그 실수를 세 번 기록했다.
- `apps/client/src/ui/App.tsx` 불가침. `git add -A` / `commit -a` 금지.
- **에셋 파일은 하나도 커밋하지 않는다.** `apps/client/public/{nodes,icons}/` 는 무시
  대상이고, 잘라 낸 것도 색을 돌린 것도 Pipoya 의 `Not redistribute` 아래 있다.
  모든 가공은 `CREDITS.md` 의 **결정적 명령**으로 재구성돼야 한다.
- import `.js`; strict; 주석·테스트 이름은 **왜**.
- 커밋 한국어 + 왜, 트레일러 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- 각 태스크 끝에 `pnpm data:build && pnpm test && pnpm typecheck` 초록.
  **"빌드 초록"은 성공 기준이 아니다** — 빌드는 조용한데 테스트가 말한다.

---

### Task B1: 등급과 접미사를 전사로 묶는다

**Files:** `packages/shared/src/types.ts`, `packages/data/src/gatherTables.ts`,
`packages/data/src/parse.ts`(+test), `packages/data/src/validate.ts`

- [ ] `NodeVariant = 'normal' | 'deep' | 'special'` 로 늘린다(`types.ts:329`).
- [ ] **전사 함수 하나가 등급↔접미사를 소유한다.** `gatherTables.ts` 에
      `SPECIAL_TABLE_SUFFIX = '_special'` · `isSpecialTableId()` · `variantOfTableId()` ·
      `suffixOfVariant()` 를 두고, **바깥 표의 정의를 "접미사가 없는 표"로 바꾼다**
      (`:305-311` 의 `if (isDeepTableId(table.id)) continue` → 전사 함수 사용).
- [ ] `parse.ts:255` 의 3값 허용 + 문구. `parse.test.ts:239` 의
      `(허용값: normal, deep)` 를 같이 고친다.
- [ ] **양방향 검사:** `variant` 와 `tableId` 접미사가 어긋나면 거절.
      `variant='special'` + `tableId='ice'` 는 오늘 파서가 2값이라 못 만드는데,
      3값이 되는 이 태스크가 그 거짓말을 만들 수 있게 한다. **아크 A 가 그림을 달았으므로
      그 거짓말은 화면에서 보인다**(붉은 얼음 광맥이 보통 얼음을 준다).
- [ ] RED→GREEN: 어긋난 짝 거절(양방향 각각), 접미사 없는 표만 바깥으로 잡힘.
      **기존 8표·61배치가 그대로 초록.**
- [ ] 커밋.

**Interfaces (뒤 태스크가 쓴다):** `isSpecialTableId(id: string): boolean` ·
`variantOfTableId(id: string): NodeVariant` · `suffixOfVariant(v: NodeVariant): string`

### Task B2: 채집 도구에 4단을 낸다

**Files:** `packages/shared/src/formulas/toolProfile.ts`(+test)

- [ ] `gatherToolProfile`(`:38-41`)의 `if (tier >= 3)` 을 `>= 4` 갈래로 늘린다:
      `{ rollFactor: 0.7, intervalFactor: 0.45, jackpotFlat: 4 }`.
- [ ] 주석에 **왜 세 축이 함께 좋아지는가**를 적는다 — 같은 파일 `:121-126` 이 망치
      티어를 성공률 하나에 묶은 이유(승급 한 칸이 두 축을 사면 안 된다)와 **채집 도구는
      원래 세 축을 진다**는 사실이 나란히 서야, 다음 사람이 둘을 같은 규칙으로 읽지 않는다.
- [ ] RED→GREEN: t4 프로필 세 값, **t5 이상도 t4 와 같다**(사다리 끝), t3 무변화.
- [ ] 분당 산출 비를 테스트가 **재서** 못박는다 — 미스릴 대비 간격 0.6 → 0.45.
- [ ] 커밋. **아직 t4 아이템은 없다.** 이 커밋은 사다리만 낸다.

### Task B3: 노드가 조건을 진다

**Files:** `packages/data/csv/nodes.csv`, `packages/data/src/parse.ts`(+test),
`packages/shared/src/types.ts`, `packages/shared/src/nodeAvailability.ts`(new, +test),
`apps/server/src/services/gatherService.ts`(+test),
`apps/client/src/game/scenes/WorldScene.ts`, `apps/client/src/ui/`(문구)

- [ ] `nodes.csv` 에 `requireWeather`(`rain|snow|빈칸`) · `requireTime`(`night|tide|빈칸`) 두 칸.
      **출하 8행은 전부 빈 칸** — 이 태스크는 동작을 안 바꾼다.
- [ ] **술어 하나가 부등호를 소유한다** — `nodeAvailability.ts` 의
      `nodeAvailable(node, weather, nowMs): { open: true } | { open: false; reason: … }`.
      결계의 `transitionGate` 가 선 그 자리다. 서버와 화면이 **같은 함수**를 부른다.
- [ ] 날씨는 `activeWeather(player.weather, now)`(`weather.ts`), 밤은 `skyShade`/시각,
      물때는 `isLowTide(hour)`(`time.ts:170`). **새 시계를 만들지 않는다.**
- [ ] `/api/gather` 가 `nodeAvailable` 로 거절한다. 새 오류 코드 —
      `MoveErrorCode` 가 `no_transition | locked` 로 나눈 그 이유와 같다:
      **화면이 무엇이 필요한지 말해야** 하므로 "안 됨" 하나로 뭉치지 않는다.
- [ ] 거절은 `nextActionAt` 을 읽지도 쓰지도 않는다(`moveService.ts` 의 그 주석과 같은
      이유 — 닫힌 노드 앞에서 A 를 눌렀다고 노가다가 느려지면 안 된다).
- [ ] 화면: 노드 앞에서 A 를 눌렀는데 닫혀 있으면 **무엇이 필요한지** 뜬다
      ("눈이 올 때만 캘 수 있다"). 결계가 밀려날 때 숫자를 말하는 그 문법이다.
- [ ] RED→GREEN: 조건별 열림/닫힘 경계(물때 시작 포함·끝 제외, 날씨 만료 순간),
      빈 칸은 언제나 열림, 서버 거절 코드, **거절이 `nextActionAt` 을 안 건드림**.
- [ ] 커밋.

**Interfaces:** `nodeAvailable(node, weather, nowMs)` — 뒤 태스크가 이 술어만 쓴다.

### Task B4: 검증 기계에 특수용 순회를 낸다

**Files:** `packages/data/src/gatherTables.ts`(+test)

**§13-앞 2·3·4 — 셋 다 오늘 무는 코드가 없다.**

- [ ] `SPECIAL_YIELD_MAX` 와 **`SPECIAL_YIELD_MIN` 을 둘 다** 둔다. 천장만 두면
      §5 목표를 만족하는 표가 ≤500 에서 ×0.828, ∞ 에서 ×0.016 — **폭 ×52.3 이 전부
      초록**이다. 심층이 `DEEP_YIELD_TARGET ± TOLERANCE` 로 양쪽을 죄는 그 모양이다.
- [ ] **규칙 5 순회를 특수용으로 분기한다.** 여섯 갈래 각각에 "특수 표에서 이것이
      옳은가"를 한 줄씩 적는다:

  | 자리 | 심층에서 | 특수에서 |
  |---|---|---|
  | `:533` 1티어 손 없음 | 건너뜀 | 그대로 |
  | `:544` 결계 문턱 모름 | 건너뜀 | **문턱이 무의미하다** |
  | `:546` ∞ 브라켓 | 건너뜀 | **반드시 잰다** |
  | `:558` 문턱 아래 동일성 | 요구 | **요구하지 않는다** |
  | `:567` 바깥이 ∞ 를 줌 | 면제 | 재검토 |
  | `:572` 바깥 0G | 건너뜀 | 그대로 |

- [ ] **`:558` 이 핵심이다.** 심층에서 옳은 이유는 "문턱 아래에는 그 표를 굴릴 사람이
      없다"인데, **특수 노드는 결계 밖이라 문턱 아래가 곧 그 표가 굴려지는 자리다.**
- [ ] **`:546` 을 복사하지 않는다.** 플레이어가 그 노드 앞에서 보내는 시간의 대부분이
      ∞ 다(584.2분 이후 영원히).
- [ ] RED→GREEN: 픽스처 표로 — 천장 위반, **바닥 위반**, **∞ 구간 위반**,
      문턱 아래에서 바깥과 달라도 통과, 대역 안이면 초록.
      **위반 메시지가 어느 구간·어느 배수인지 말한다**(작가가 고칠 수 있어야 한다).
- [ ] 커밋. **출하 8표는 그대로 초록.**

### Task B5: 도감이 특수 표를 안 세고, 형평이 특수 표를 본다

**Files:** `packages/data/src/collection.ts`(+test)

**§13-앞 5·6 — 5 는 무는 코드가 없다.**

- [ ] `:181` 의 칸 유도에서 **`isSpecialTableId(table.id)` 로** 특수 표를 뺀다.
      **`!table.equity` 로 적으면 안 된다** — `equity` 는 "형평을 재는 대표 표"라는 뜻이고
      심층도 false 다. 그것으로 좁히면 `ice.equity=false` 같은 고장 상태에서
      **"얼음 조각은 채집물이 아니다"** 다섯 줄이 나오고(`collection.test.ts:176` 이
      1 → 6 으로 빨개진다), 그것은 이 파일 자신이 금지한 자세다.
- [ ] **새 검사:** "특수 표를 뺀 모든 표의 티어 집합 = equity 표의 티어 집합".
      오늘 `collection.csv` 에 특수 표만 가진 아이템 한 줄을 넣으면 아무도 안 짖는다.
- [ ] **형평이 특수 표를 본다**(`:288`). 특수 표가 같은 아이템의 훨씬 빠른 출처가 되면
      도감 안전망이 무너진다 — 실측: `ice_special` ∞ 를 `ice_shard` 99.94% 로 채우면
      t4 도달이 29.8분 → **5.3분**(×5.67)인데 분당 골드비가 0.0096 이라
      **천장을 100배 여유로 통과한다. 천장을 잘 통과할수록 형평이 더 깨진다.**
- [ ] RED→GREEN: 특수 표의 티어가 칸을 안 만든다, 특수 표만 가진 칸이 있으면 거절,
      특수 표가 형평을 깨면 거절, **`collection.test.ts:176` 이 1건 그대로**.
- [ ] 커밋. **칸 25 · 만점 100 그대로.**

### Task B6: 배치 검사에 거울을 단다

**Files:** `packages/data/src/transitions.ts`(+test) 또는 배치 검사가 사는 자리

- [ ] `:416` 이 `variant === 'deep'` 만 본다(심층은 결계 안이어야 한다). 거울:
  - 특수 배치는 **모든 결계 구역 밖** — 유일 출처라 안에 들어가면 그 아이템이 통째로
    153.8분짜리 문 뒤로 사라진다.
  - 특수 배치는 **개발맵에 없다** — 숙련 0 으로 걸어 들어가는 문이다.
  - **채집장당 정확히 하나** — 둘이면 "제일 가까운 것" 문제가 복사된다.
- [ ] RED→GREEN 셋 각각 + 출하 61배치 초록.
- [ ] 커밋.

### Task B7: 얼음 하나로 사슬을 관통한다

**Files:** `packages/data/csv/{gather_tables,gather_brackets,gather_tiers,items,nodes,recipes,milestones,collection}.csv`,
`packages/data/maps/얼음채집장.tmx`, `apps/client/src/game/nodeSprites.ts`(+test),
`assets/CREDITS.md`, `apps/client/public/{nodes,icons}/`(커밋 안 함)

**이 태스크가 목표 숫자를 처음 실증한다. 나머지 셋은 B8 이 같은 모양으로 따른다.**

- [ ] `ice_special` 표. **목표(구리손·증표 없음·강화 0·연속·숙련 고정)**:
      뜨거운 얼음 1개까지 **숙련 0 = 37.5분 이내 / 10,000 = 15분 / 85,000 = 6분 /
      150,000 = 4분 / ∞ = 2분.** `pnpm content gather ice_special --prof=N` 으로 역산한다.
- [ ] **최상위 티어가 `hot_ice`**(가장 비싸다) — `gatherTables.test.ts:580` 이 모든 표의
      매도가 단조 감소를 요구한다. 아래는 얼음 계열의 싼 것들. **이것은 고칠 테스트가
      아니라 지킬 제약이다.**
- [ ] `hot_ice` 아이템. **도감 칸을 만들지 않는다**(B5 가 보장).
- [ ] `red_ice_vein` 노드 — `variant=special` · `tableId=ice_special` ·
      `requireWeather=snow` · `sprite=red_ice_vein`.
- [ ] 얼음채집장 `.tmx` 에 배치 **하나**. 결계 밖. **A1 의 교훈대로 그 맵 지면 위에
      얹어 걸어 본다** — 색을 돌려도 바닥과 같은 계열이면 묻힌다.
- [ ] `starfall_chisel`(ice t4) 레시피 — `mithril_ingot` + `hot_ice` +
      `lightning_heartwood`. **B8 이 벼락 심재를 만들기 전까지 이 레시피는 못 만든다.**
      그것이 순환 설계의 뜻이고, 카드는 잠긴 채 보인다(목록방 문법).
      **`gateSkill` 을 걸지 않는다**(§13-앞 1 — `validate.ts:422-431` 이 산출물 `skill`
      칸과 일치를 강제하는데 도구 13행 전부 비어 있다). `requiredSkill=50000`.
- [ ] `milestones.csv` 에 `crafting_50000` 한 행. `validate.ts:1122-1137` 이
      `requiredSkill > 0` 인 레시피마다 정확히 하나의 recipes-이정표를 강제한다.
      **네 도구를 한 행에 싣는다**(미스릴 넷이 `crafting_25000` 한 행에 실린 그 모양).
- [ ] **수요를 분으로 잰다.** 별똥 정 1자루 + 강화 +5 = 6자루 분의 `hot_ice` 총수요를
      **숙련 85,000 기준 30~60분**에 맞춘다. `craftService.ts:131` 의 실패 소모
      (`Math.ceil(count/2)`, 기대 배수 `1 + 0.5·(1/c − 1)`)를 **함께 센다.**
- [ ] 그림 둘: `red_ice_vein.png`(= `ice_vein` 색 변주) · `hot_ice` 아이콘.
      `CREDITS.md` 의 **노드 대장 + 아이콘 대장**에 행을 더하고 **복원 명령**을 적는다.
      `nodeSprites.ts` 매니페스트도 같은 커밋. **삼자 전수 대조 테스트가 이미 있다.**
      복원 명령만으로 픽셀까지 재현되는 것을 `magick compare -metric AE` 로 확인한다.
- [ ] 고칠 테스트(§6-9): `gatherTables.test.ts:403`·`:686`, `content-cli.test.ts:612`,
      `parse.test.ts:262`, `nodeSprites.test.ts:98`, `itemIcons.test.ts`.
- [ ] 커밋.

### Task B8: 나머지 셋을 같은 모양으로

**Files:** B7 과 같은 목록 + `나무수렵장·광물채굴장·허브채집장.tmx`

- [ ] `wood_special`(벼락 심재 · 벼락 맞은 나무 · **비**) ·
      `mineral_special`(별똥 쇳물 · 별똥 자리 · **밤**) ·
      `herb_special`(서리꽃 · 서리 핀 군락 · **물때**).
- [ ] 도구 셋: 별똥 도끼(벼락 심재 + 별똥 쇳물) · 별똥 곡괭이(별똥 쇳물 + 서리꽃) ·
      별똥 낫(서리꽃 + 뜨거운 얼음). **순환이 닫힌다** — 넷을 다 만들려면 네 채집장.
- [ ] **나무는 다르다.** 보통 표가 이미 분주하다(경계 여섯, 26~241분 창 안에 계단 둘 —
      65.6·131.6분). 나무 특수 표는 **조용하게** 짓는다. §1 병2 를 다시 읽을 것.
- [ ] 목표·수요·그림·대장·테스트 전부 B7 과 같은 규율.
- [ ] 커밋(계열마다 나눠도 된다).

### Task B9: 눈으로 확인하고 닫는다

- [ ] **다섯 맵을 전부 걷는다**(개발맵 포함 — 개발맵에 특수 배치가 **없어야** 한다).
      812×375. 특수 노드 넷이 그림으로 서고 **그 맵 바닥에서 묻히지 않는지** 본다.
- [ ] **조건 넷을 실제로 겪는다:** 눈 가루를 써서 붉은 얼음 광맥을 연다(성공 기준 7).
      닫혀 있을 때 A 를 눌러 화면이 **무엇이 필요한지** 말하는지 넷 다 확인한다.
- [ ] **4단 도구를 들고 행동 간격이 실제로 줄어드는지 DOM 으로 읽는다**(스크린샷 아님).
      미스릴 대비 −25%.
- [ ] `git ls-files apps/client/public` 이 **글꼴 2개 그대로**인지 확인한다.
- [ ] `pnpm data:build && pnpm test && pnpm typecheck && client build` 초록.
- [ ] 커밋.

---

## 규범 → 태스크 대조 (§13-앞)

| 규범 | 태스크 |
|---|---|
| 1 `gateSkill` 안 건다 | B7 |
| 2 규칙 5 특수 분기 (검사 없음) | **B4** |
| 3 ∞ 를 잰다 (검사 없음) | **B4** |
| 4 천장+바닥 (검사 없음) | **B4** |
| 5 형평이 특수를 본다 (검사 없음) | **B5** |
| 6 술어는 `isSpecialTableId` | B5 |
| 8 소진 뒤의 이유 (검사 없음) | 설계 §4 — B3 의 조건이 진다 |
| 9 화면에 나타나는 자리 | B3 |
| 10 `milestones.csv` | B7 |
| 11 수요를 분으로 (검사 없음) | **B7** |
| 12 실패 소모 배수 | B7 |
| 13 나무 줄 (검사 없음) | **B8** |
| 17 테스트 ≥9 | B7 · B8 |
| 18 아이콘 대장 | B7 · B8 |
| 19 prof-0 = 37.5분 | B7 |
| 20 날씨·물때 채택 | B3 |

**굵은 것이 "규범은 있는데 무는 코드가 없다"** — 그 태스크가 검사를 같이 짠다.

## 범위 밖

노드 고갈 · 결계 만료 · 망치 티어 · "철 정에 철이 안 들어간다" · 도감 칸 확장 ·
브라켓 경계에 맞춘 이정표 신설.
