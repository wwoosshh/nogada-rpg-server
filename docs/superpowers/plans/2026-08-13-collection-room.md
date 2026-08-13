# 수집의 방 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 채집물 25칸이 보이는 방이 생기고, 바치면 칸이 등급을 올리며, 총점이 되사기 진열을 연다. 그리고 최고 장비가 최하위 재료를 못 뽑던 채집 버그를 고친다.

**설계 문서:** `docs/superpowers/specs/2026-08-13-collection-room-design.md` — **§6-앞(규범 14개)이 다른 절보다 우선한다.**

## Global Constraints

- 게임 규칙은 `packages/shared` 에만. 서버가 판정의 유일한 주인. 확률표는 클라 번들 금지(문턱표 `collection.csv` 는 **싣는다** — 화면이 요구치를 적어야 한다).
- **`apps/client/src/ui/App.tsx` 불가침. `git add -A`/`commit -a` 금지.** 커밋 후 `git status --short` 에 그 파일만.
- import `.js`; strict; 주석·테스트 이름은 왜; 검증 메시지는 CSV 작가가 읽는다.
- 커밋 한국어 + 왜, 트레일러 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- 매 태스크 `pnpm data:build && pnpm test && pnpm typecheck`(+클라 태스크는 client build).
- 기존 세이브 무이행(`donated` 는 `.default(() => ({}))`).

---

### Task K1: 채집 버그 — 어떤 손으로도 모든 티어가 나온다

**Files:** Modify `packages/data/csv/gather_brackets.csv`(또는 `packages/shared/src/formulas/gatherTable.ts`), `packages/data/src/validate.ts`(+test), `packages/data/src/gatherSimulation.test.ts`

**문제(§6-앞 14):** 미스릴(rollFactor 0.8)+선별증표(×0.95)=0.76 이라 roll 최대가 76,000 인데 광물 ∞ 브라켓 꼬리는 78,065 부터다 — 그 손으로 은·철·구리 원석이 **확률 정확히 0**. 허브도 같은 모양.

- [ ] 먼저 **전수로 재현**하라: 각 표·각 브라켓·각 손(맨손/구리/철/미스릴 × 증표 유무 × 강화 0/5)에서 확률 0 인 티어를 모두 찾아 보고한다(이것이 RED 증거다).
- [ ] 고침 두 안 중 **하나를 고르고 이유를 적어라**: (a) ∞ 브라켓 누적 꼬리를 최소 배수 안으로 접는다(데이터 수정 — 원작 수치에서 멀어진다), (b) `gatherOutcome` 이 표를 넘어선 roll 을 **가장 흔한 티어**로 떨어뜨린다(코드 수정 — 표는 원작 그대로 남는다). 판단 근거: 이 저장소는 원작 수치 보존을 반복해서 규범으로 삼아 왔다.
- [ ] **불변식 테스트**: 모든 (표, 브라켓, 손) 조합에서 그 브라켓의 모든 티어가 확률 > 0 이다. 손 목록은 `gatherHandOf` 로 실제로 만든다.
- [ ] 커밋.

### Task K2: 칸과 문턱 — collection.csv 와 순수 함수

**Files:** Create `packages/data/csv/collection.csv`, `packages/data/src/collection.ts`(+test), `packages/shared/src/collection.ts`(+test), Modify `packages/shared/src/types.ts`·`protocol.ts`, `packages/data/src/build.ts`, `validate.ts`(+test), `apps/server/src/state/newCharacter.ts`, `packages/data/src/emptyPlayer.ts`, 픽스처

**Interfaces:**
```ts
// shared
export interface CollectionThresholds { itemId: string; steps: [number, number, number, number] }
export type CollectionTable = Record<string, CollectionThresholds>
export function collectionGrade(donatedCount: number, t: CollectionThresholds): number  // 0..4
export function collectionScore(donated: Record<string, number>, table: CollectionTable): number
export const COLLECTION_MAX_GRADE = 4
// PlayerState.donated: Record<string, number>  — .default(() => ({}))
```
`GameData.collection: CollectionTable` (클라도 본다 — 화면이 요구치를 적는다).

- [ ] `collection.csv (itemId,t1,t2,t3,t4)` — **칸은 `gather_tiers.csv` 의 25종 전부**(§6-앞 4). 값은 §6-앞 6 대로 1단을 낮게. 초기값 제안: 각 티어의 희소도에 반비례하게 두되 **형평 검증이 통과하는 값**으로 맞춘다(아래).
- [ ] 검증: 칸 목록이 `gather_tiers.csv` 와 **정확히 일치**(빠짐·잉여 둘 다 위반), 문턱 4개가 순증가, t1 > 0, 채집물이 아닌 아이템 금지.
- [ ] **형평 검증**(§6-앞 5): 각 칸의 4단 문턱을 "그 아이템이 최적손·자기 최종 브라켓에서 나오는 비율"로 나눈 기대 시간이 목표 대역 안(예: 15~45분). 목표 대역과 근거를 주석에 적어라. `enhanceCosts` 의 계열 회전 검증과 같은 자세.
- [ ] `donated` 필드 추가 — **18곳**(§6-앞 10)을 전부. 커밋.

### Task K3: 헌납 — 서버 판정과 이정표

**Files:** Create `apps/server/src/services/donateService.ts`(+test), `routes/donate.ts`, Modify `packages/shared/src/protocol.ts`, `apps/server/src/app.ts`

- [ ] `DonateRequestSchema { itemId, count }` — 상한은 헌납 전용(§6-앞 12, 스택 상한이 없으므로 거래의 999 를 쓰지 않는다). 이유를 스키마 주석에.
- [ ] `performDonate`: 아이템이 칸인가(`collection` 에 있는가) → 보유 충분한가 → `stacks` 차감(0 이면 키 삭제 — 기존 관례) → `donated[itemId] += count` → **`newlyAchieved` 판정 후 응답에 `achieved`**(§6-앞 9). 오류 `unknown_item`·`not_collectable`·`missing_items`. 행동 간격 없음.
- [ ] **불변식 3종**(§6-앞 13): 바친 만큼만 줄고 늘며 다른 상태 불변 / 부족하면 상태가 전혀 안 바뀜 / 도구·증표·정제품은 `not_collectable`.
- [ ] 커밋.

### Task K4: 이정표가 총점을 본다 + 되사기 진열

**Files:** Modify `packages/shared/src/milestones.ts`(+test), `packages/data/src/milestones.ts`(+test), `packages/data/csv/milestones.csv`, `packages/data/csv/shop_stock.csv`, `packages/data/src/shops.ts`(+test), `validate.ts`(+test), `apps/client/src/ui/shopModel.ts`(+test), `apps/server/src/services/tradeService.ts`(+test)

- [ ] `metricKind='collection'` 신규(§6-앞 8): shared 유니온 + `metricValue` + `milestoneRatio` + 파서 + 검증. **`metricValue` 가 문턱표를 볼 수 있어야 한다** — 시그니처 확장 경로를 정하고 모든 호출부를 갱신한다(지금 `GameData` 를 못 받는 것이 이 태스크의 실제 일이다).
- [ ] `milestones.csv` 에 수집 문턱 4행(총점 100 만점 기준 — 예 10/30/60/100), effectKind 는 **되사기 해금이 붙는 것**과 `title` 을 나눠 준다.
- [ ] **되사기 진열**(§6-앞 7): `shop_stock.csv` 에 `unlockCollection` 칸 추가 — 그 계열 상점이 자기 계열 채집물을 **정가에 되판다**. 매수는 이미 있으므로 진열 행만 늘고, 잠금 조건이 숙련이 아니라 총점인 행이 생긴다. `shopModel`·`tradeService` 가 그 조건을 본다.
- [ ] RED→GREEN: 총점 미달이면 `item_locked`, 넘으면 살 수 있다. 사는 값이 파는 값의 2배라 왕복이 손해임을 테스트로 못박는다(기존 왕복 단조성과 같은 자리).
- [ ] 커밋.

### Task K5: CodexPanel — 25칸이 보이는 방

**Files:** Create `apps/client/src/ui/CodexPanel.tsx`, `apps/client/src/ui/codexModel.ts`(+test), Modify `apps/client/src/store/gameStore.ts`, `apps/client/src/ui/TopBar.tsx`, `apps/client/src/ui/BagPanel.tsx`, `apps/client/src/api/GameClient.ts`, `styles/ui.css`

- [ ] `OpenPanel` 에 `'codex'` 추가(값 하나라 ESC·잠금·컨트롤러가 공짜로 따라온다). 상단바에 **도감 버튼**(톱니 옆) — 새 입력 키를 파지 않는다(§6-앞 2).
- [ ] 방 화면: **계열 4묶음 × 칸**. 각 칸은 아이콘·이름·`바친 개수`·등급(별 4단). **잠긴 칸도 이름·아이콘을 보여준다**(회색조 + `0/N`) — 숨기는 것은 없다(§6-앞 3). 상단에 `총점 N/100`. 812×375 에서 세로 스크롤.
- [ ] 가방 재료 줄에 **`[바치기]`** 버튼(칸인 아이템만 — 죽은 버튼 금지). 수량 선택은 상점의 그것을 재사용하고, **되돌릴 수 없음을 한 번 확인**한다(태우는 행위다 — 이 저장소에서 확인창을 쓰는 유일한 다른 곳이 캐릭터 삭제다).
- [ ] `codexModel.ts` 순수부 테스트: 계열 묶기, 등급 계산, 다음 문턱까지 남은 개수, 총점.
- [ ] 브라우저 검증(812×375, 로컬 서버, env 위생): 방 열기 → 잠긴 칸이 이름과 함께 흐리게 보임 → 가방에서 바치기 → 칸이 채워지고 총점이 오름 → 되사기 진열이 열리는 것(총점을 시드로 조작해 확인). 스크린샷.
- [ ] 커밋.

### Task K6: 정리·전 여정

- [ ] grep 잔존 0: 낡은 주석("22종"), 죽은 참조.
- [ ] 전 여정: 신규 캐릭터 → 채집 → 방 열기(빈 칸 25개) → 바치기 → 등급·총점 → 되사기 해금.
- [ ] 전체 게이트 초록. 커밋.

## 자체 점검

| 스펙 | 태스크 |
|---|---|
| §6-앞 14 채집 버그 | K1 |
| §6-앞 4·5·6·10·11 칸·문턱·상태 | K2 |
| §6-앞 9·12·13 헌납 | K3 |
| §6-앞 7·8 게이트·지표 | K4 |
| §6-앞 1·2·3 화면 | K5 |
| §8 성공 기준 | K6 |

**범위 밖:** 스펙 §7 훅 전부(보관소·수집 상점 아이템·석비·도구 헌납·헌납 취소).
