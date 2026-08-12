# 제작 확장 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 얼음은 날씨 가루를, 나무·허브는 정제 사슬을 갖는다. 문턱은 그 계열 채집 숙련이 열고, 강화는 원작대로 원재료와 골드를 계열 회전으로 먹는다.

**설계 문서:** `docs/superpowers/specs/2026-08-13-crafting-expansion-design.md` — **§6-앞(규범 17개)이 다른 절보다 우선한다.**

## Global Constraints

- 게임 규칙은 `packages/shared` 에만. 서버가 판정의 유일한 주인. 확률표는 클라 번들 금지(단 `enhance_costs` 는 **싣는다** — 화면이 요구량을 적어야 한다, §6-앞 13).
- **`apps/client/src/ui/App.tsx` 불가침. `git add -A`/`commit -a` 금지.** 커밋 후 `git status --short` 에 그 파일만.
- import `.js`; strict; 주석·테스트 이름은 왜; 검증 메시지는 CSV 작가가 읽는다.
- 커밋 한국어 + 왜, 트레일러 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- 매 태스크 `pnpm data:build && pnpm test && pnpm typecheck`(+클라 태스크는 client build).
- 기존 세이브 무이행(`weather` 는 `.default(null)`). 라이선스 에셋 git 밖.

---

### Task C1: 문을 여는 두 번째 숫자 — `gateSkill`/`gateValue`

**Files:** Modify `packages/data/csv/recipes.csv`, `packages/data/src/parse.ts`(+test), `validate.ts`(+test), `packages/shared/src/types.ts`, `packages/shared/src/formulas/craft.ts`(+test), `apps/client/src/ui/craftCardModel.ts`(+test), `CraftPanel.tsx`, `apps/server/src/services/craftService.ts`(+test)

**Interfaces:** `RecipeDef.gateSkill?: SkillId`, `RecipeDef.gateValue?: number`.
`canCraft(ctx)` 는 **조합 요구치와 계열 문턱을 둘 다** 본다 —
`CraftContext` 에 `gateProficiency?: number`(그 계열 숙련) 추가.

- [ ] recipes.csv 에 두 칸 추가(기존 17행은 빈 칸 — 조합 문턱만 쓴다). 파서: 둘 다 있거나 둘 다 없어야 한다(하나만 적으면 위반), `gateSkill` 유효, `gateValue > 0`.
- [ ] RED→GREEN: `canCraft` — 조합은 되는데 계열이 모자라면 false, 그 반대도 false, 둘 다 없으면 기존과 동일(회귀).
- [ ] 카드 모델: 잠긴 이유가 둘일 수 있으므로 **모자란 쪽의 숫자를 말한다**(둘 다 모자라면 계열을 먼저 — 그것이 진짜 문턱이다). 기존 `조합 숙련도 N/M` 옆에 `얼음 숙련도 N/M` 형식.
- [ ] 커밋.

### Task C2: 아이템 10종·레시피 10종 — 나무/허브 정제, 얼음 조제

**Files:** Modify `packages/data/csv/items.csv`, `recipes.csv`, `assets/CREDITS.md`, 복사 icons(git 밖)

**확정 아이콘(컨트롤러 승인 — 변경 금지):** 나무=널빤지, 허브=유리병, 얼음=하늘.

| item id | 이름 | skill | price | icon | 원본 |
|---|---|---|---|---|---|
| compressed_log | 압축 목재 | wood | 600 | plank_light | icon956 |
| dense_log | 고압축 목재 | wood | 6600 | plank_dark | icon957 |
| leaf_extract | 농축 잎물 | wood | 10800 | flask_gold | icon284 |
| herb_extract | 허브 농축액 | herb | 1200 | flask_green | icon278 |
| lavender_oil | 라벤더 향유 | herb | 3850 | flask_rose | icon282 |
| sage_essence | 세이지 정수 | herb | 9300 | flask_teal | icon274 |
| rain_powder | 비 가루 | ice | 100 | cloud_rain | icon121 |
| snow_powder | 눈 가루 | ice | 100 | cloud_snow | icon122 |
| heavy_rain_powder | 굵은 비 가루 | ice | 400 | cloud_storm | icon124 |
| heavy_snow_powder | 함박눈 가루 | ice | 400 | snowflake | icon152 |

**레시피(카테고리 `정제` 6종 · `조제` 4종, 전부 `requiredSkill 0` + `baseChance 0.95`):**

| id | 입력 | gateSkill/gateValue | skillGain |
|---|---|---|---|
| compressed_log | soft_log×20 | wood 1000 | 10,20 |
| dense_log | hard_log×15 + compressed_log×1 | wood 10000 | 25,40 |
| leaf_extract | tea_leaf×10 + golden_leaf×3 + dense_log×1 | wood 50000 | 40,70 |
| herb_extract | common_herb×20 | herb 1000 | 10,20 |
| lavender_oil | lavender×15 + lime×5 + herb_extract×1 | herb 10000 | 25,40 |
| sage_essence | sage×10 + rare_herb×3 + lavender_oil×1 | herb 50000 | 40,70 |
| rain_powder | ice_shard×10 + pure_ice×5 | ice 1000 | 10,20 |
| snow_powder | ice_shard×10 + pure_ice×5 | ice 1000 | 10,20 |
| heavy_rain_powder | ice_shard×30 + pure_ice×10 | ice 10000 | 25,40 |
| heavy_snow_powder | ice_shard×30 + pure_ice×10 | ice 10000 | 25,40 |

- [ ] 가격은 **정제 = 입력 매도합 ×1.0**(=price 2배), **가루는 소모품이라 손해**(§6-앞 7·17). 돈복사 검증이 전부 통과하는지 확인하고 그 수치를 보고하라.
- [ ] CREDITS 표·heredoc 10쌍, PNG 10장 복사, 아이콘 유일성 테스트 통과.
- [ ] `requiredSkill 0` 이므로 **이정표를 만들지 않는다**(§6-앞 9) — 역방향 검증이 초록인지 확인.
- [ ] 커밋.

### Task C3: 날씨 — weather 사실의 첫 공급자

**Files:** Modify `packages/shared/src/types.ts`·`protocol.ts`·`facts.ts`(+test), Create `apps/server/src/services/useService.ts`(+test)·`routes/use.ts`, Modify `apps/server/src/app.ts`, `packages/data/src/validate.ts`(+test)

**Interfaces:** `PlayerState.weather: { kind: 'rain'|'snow'; untilMs: number } | null`(`.default(null)`),
`UseRequestSchema { itemId }`, `ItemDef.useEffect?: { kind: 'weather'; weather: 'rain'|'snow'; minutes: number }`(items.csv 에 두 칸: `useEffect`,`useValue` 로 접어도 좋다 — 파서가 읽기 쉬운 쪽을 택하고 이유를 적어라).

- [ ] `facts.ts`: `weather` 를 **실제로 공급한다**(만료 지났으면 넣지 않는다 — 공급자 없는 사실은 넣지 않는다는 기존 규범 그대로). `dialogue.ts` 의 `supplied: false` → `true`.
- [ ] `POST /api/use`: 소지 확인 → 1개 소모 → `weather` 설정(기존이 남아 있으면 **덮어쓴다**, 남은 시간은 버린다 — 규칙을 주석에 적어라). 오류 `unknown_item`·`not_usable`·`missing_items`. 행동 간격은 **안 먹는다**.
- [ ] 지속: 약 = 게임 60분(실제 2.5분), 중 = 게임 180분(실제 7.5분). 시간 계산은 shared 의 시간 상수로(하드코딩 금지).
- [ ] RED→GREEN: 사용 시 사실이 공급된다 / 만료 후 사라진다 / 덮어쓰기 / 없는 아이템 / 사용 불가 아이템.
- [ ] 빌드 안내 "대사 N줄이 weather 를 기다린다"가 **사라지는지** 확인해 보고하라(잠든 대사가 깨어난 증거).
- [ ] 커밋.

### Task C4: 클라이언트 — 하늘과 사용 버튼

**Files:** Modify `apps/client/src/api/GameClient.ts`, `store/gameStore.ts`, `ui/BagPanel.tsx`, `game/scenes/WorldScene.ts`(연출), `styles/ui.css`

- [ ] 가방 재료 줄에 `useEffect` 가 있는 아이템만 **[사용]** 버튼(죽은 버튼 금지 규범 — 다른 재료엔 안 그린다). 사용 후 남은 개수·상단 표시 갱신.
- [ ] 하늘 연출: 비는 사선 입자, 눈은 느린 흰 점 — Phaser 파티클로 가볍게. 낮밤 명암과 겹쳐도 읽히게. 남은 시간은 상단바에 작게(맵 이름 옆).
- [ ] 브라우저(812×375, 로컬 서버, env 위생): 가루 제작 → 사용 → 하늘이 바뀌고 → **채집장노인의 비 오는 날 대사가 나온다**(잠든 대사가 깨어난 것을 눈으로). 스크린샷.
- [ ] 커밋.

### Task C5: 강화 개편 — 원작 UL4 (계열 회전 + 골드 + 티어)

**Files:** Create `packages/data/csv/enhance_costs.csv`, `packages/data/src/enhanceCosts.ts`(+test), Modify `packages/shared/src/types.ts`, `apps/server/src/services/equipService.ts`(+test), `routes/enhance.ts`, `app.ts`, `apps/client/src/ui/BagPanel.tsx`

**Interfaces:** `enhance_costs.csv (toolTier, level, itemId, count, gold)` → `GameData.enhanceCosts`.
**계열 회전**(§6-앞 11): +1 나무 · +2 허브 · +3 얼음 · +4 광물 · +5 네 계열 각 1 —
도구가 무엇이든 같은 사다리를 탄다(원작 그대로 "서로를 먹인다").
티어 배수(§6-앞 12): 1티어 ×1 · 2티어 ×4 · 3티어 ×12, 골드도 같은 배수.

- [ ] 표 작성: 원재료는 각 계열의 **2단 재료**(맑은 얼음·단단한 통나무·라벤더·철 원석 — 죽은 재료를 강화가 먹는다), 골드는 1티어 기준 +1 5,000 → +5 40,000.
- [ ] 검증: 티어 1~3 × 레벨 1~5 가 빠짐없이 있다 / 없는 아이템 / count·gold ≥ 0 / 레벨 연속.
- [ ] 서버: `performEnhance` 가 `items`·`costs` 를 받고 재료·골드를 검사·소모. 새 코드 `missing_enhance_materials`·`not_enough_gold`. 라우트가 GameData 를 받게 되며 **"GameData 를 받지 않는 유일한 라우트"라는 그 파일 주석도 고친다**.
- [ ] 가방 [강화] 버튼이 **무엇이 얼마나 필요한지** 말한다(부족분은 danger 색).
- [ ] 커밋.

### Task C6: 정제품이 도구를 먹인다 + 망치가 값어치를 갖는다

**Files:** Modify `packages/data/csv/recipes.csv`, `packages/shared/src/formulas/toolProfile.ts`(+test), `apps/server/src/services/craftService.ts`(+test), `apps/client/src/ui/craftCardModel.ts`

- [ ] 미스릴 도구 4종의 입력에서 raw `golden_fruit×2 + millennium_leaf×2 + aroma_herb×3` → **`leaf_extract×2 + sage_essence×2`**(정제품 수요가 도구 사슬에 영구히 붙는다, §6-앞 6). 돈복사 검증 재확인.
- [ ] **망치 강화가 제작 간격을 줄인다**(§6-앞 14): `craftIntervalMs(proficiency, hammer)` 를 shared 에 신설(강화 1당 ×0.97, 하한 클램프는 채집과 동일 규칙), craftService 의 스탬프가 그것을 쓴다. 제작 패널이 그 수치를 말한다.
- [ ] 커밋.

### Task C7: 정리·전 여정

- [ ] grep 잔존 0: 낡은 주석("GameData 를 받지 않는 유일한"), `supplied: false` 의 weather 흔적.
- [ ] 전 여정 브라우저: 얼음 캐기 → 가루 제작 → 사용 → 하늘·대사 변화 / 나무·허브 정제 3단 / 강화가 재료·골드를 먹는 것 / 미스릴 도구가 정제품을 요구하는 것.
- [ ] 전체 게이트 초록. 커밋.

## 자체 점검

| 스펙 | 태스크 |
|---|---|
| §6-앞 9·10 문턱 | C1 |
| §6-앞 5·7·8·15·17 데이터 | C2 |
| §6-앞 1~4 날씨 | C3·C4 |
| §6-앞 11·12·13 강화 | C5 |
| §6-앞 6·14 영구 수요·망치 | C6 |
| §7 성공 기준 | C7 |

**범위 밖:** 스펙 §6 훅 전부(포션·주문서·장비·가공장인 NPC·폭풍우 3단).
