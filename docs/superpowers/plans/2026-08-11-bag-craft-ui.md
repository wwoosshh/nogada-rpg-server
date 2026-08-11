# 가방·제작 UI 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 가방 버튼이 내 물건을 그림으로 보여주고, 제작 패널이 분류된 카드가 되고, 상단에 지금 서 있는 곳의 이름이 뜬다.

**Architecture:** 가방·제작 패널을 Phaser(`PanelScene`)에서 React DOM 으로 이전한다. 열림 상태의 주인은 스토어의 `openPanel: 'bag'|'craft'|'menu'|null` 하나, 입력 라우팅은 기존 applyInput 체인 한 곳(DOM 에 키보드 리스너 금지). 분류는 `recipes.csv`의 `category` 칼럼이 소유하고, 18개 아이템 전부가 전용 아이콘을 갖는다.

**Tech Stack:** TypeScript strict, Vitest, React 18 + Zustand, Phaser 3.90, CSV→JSON 빌드.

**설계 문서:** `docs/superpowers/specs/2026-08-11-bag-craft-ui-design.md` — 의미론의 유일한 원본. **§8-앞(평가 반영 규범)이 다른 절보다 우선한다.** 계획과 어긋나면 설계 문서가 이긴다.

## Global Constraints

- 게임 규칙은 `packages/shared` 에만. 서버가 판정의 유일한 주인 — 클라이언트는 결정하지 않는다.
- **`apps/client/src/ui/App.tsx` 불가침. `git add -A`/`commit -a` 금지.** 커밋 후 `git status --short` 에 그 파일(` M`)만 남아야 한다.
- import 는 `.js` 확장자; `strict: true`, `noUncheckedIndexedAccess: true`; 주석·테스트 이름은 왜.
- DOM 색은 `tokens.css` 변수만, 폰트는 Neo둥근모(`--font-ui`), 아이콘은 `image-rendering: pixelated` + 32px 정수 배율. 오래 들여다보는 숫자(수량·요구치·누적)는 16px.
- 검증 메시지는 CSV 를 쓰는 작가가 읽는다 — 무엇이 왜 틀렸고 무엇을 하면 되는지, 기존 결대로.
- 커밋 메시지 한국어 + 왜, 트레일러 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- 매 태스크 `pnpm data:build && pnpm test && pnpm typecheck`, 클라이언트 태스크는 `pnpm --filter @nogada/client build` 추가.
- 라이선스 에셋(`assets/licensed/`, `apps/client/public/icons/`)은 절대 git 에 넣지 않는다 — CREDITS.md 레시피로만.

---

### Task B1: 레시피 카테고리 — 데이터가 분류를 소유한다

**Files:** Modify `packages/data/csv/recipes.csv`, `packages/data/src/parse.ts`(+`parse.test.ts`), `packages/shared/src/types.ts`

**Interfaces:** Produces — `RecipeDef.category: string`(trim 완료, 비지 않음). 아이템·레시피 id 에 정수형(`/^\d+$/`) 금지(Record 키 순서가 JSON 왕복에서 깨지는 것을 빌드가 막는다).

- [ ] `recipes.csv` 헤더에 `category` 추가, 값: `copper_ingot`→`제련`, 나머지 5개(`copper_hammer`,`iron_chisel`,`iron_axe`,`iron_pickaxe`,`iron_sickle`)→`도구`.
- [ ] RED: parse.test — category 칸 없는 행(칸 수 불일치), 공백만 있는 category 셀(`" "`), 정수형 id(`"2"`)가 각각 작가용 한국어 메시지로 거부되는지. 공백 셀 케이스는 지금 `requireCell`이 `=== ''`만 봐서 통과하는 구멍 — trim 후 검사로 막는다.
- [ ] `parseRecipes`: `category: requireCell(row, 'category', ctx).trim()` + trim 후 빈 값 거부. `parseItems`/`parseRecipes` 공통으로 id 정수형 금지 검사(`/^\d+$/` → "id 는 숫자만으로 만들 수 없다 — 목록 순서가 깨진다" 류 메시지).
- [ ] `RecipeDef`(types.ts)에 `category: string` 추가. GREEN 확인, `pnpm data:build` 로 gamedata.json 재생성. 커밋.

### Task B2: 헤더 — 이정표 티커 대신 맵 이름

**Files:** Modify `apps/client/src/ui/TopBar.tsx`, `packages/shared/src/milestones.ts`(+`milestones.test.ts`), 주석 정리: `packages/shared/src/types.ts`, `packages/data/src/milestones.ts`, `apps/client/src/game/detailMenuTabs.ts`

**Interfaces:** Consumes — `s.data.maps[s.player.location.mapId]?.name`(둘 다 이미 TopBar 스코프에 있음). Produces — `nextMilestone` 삭제(전 저장소 프로덕션 사용처가 TopBar 뿐임을 grep 으로 확인하고 지운다).

- [ ] TopBar: `describeNextMilestone` 티커 제거, 같은 자리(`.topbar__milestone` 스타일 재사용 가능)에 현재 맵 이름. 셀렉터는 문자열을 고른다(기존 재렌더 억제 패턴 유지).
- [ ] shared: `nextMilestone` 함수 + 그 테스트 블록 삭제. `metricValue`·`milestoneRatio`·`achievedIds`는 이정표 탭이 쓰므로 **남긴다**. "동점 처리가 이 순서를 쓴다" 류의 nextMilestone 근거 주석들(types.ts, data/milestones.ts, detailMenuTabs.ts — 편집 전 각 위치 실물 확인)을 정리.
- [ ] 브라우저(812×375): 맵 이름 표시, 맵 이동 시 갱신, 이정표 탭은 여전히 동작. 커밋.

### Task B3: 아이콘 — 18개 전부 전용 그림 (컨트롤러 승인 완료된 배정)

**Files:** Modify `assets/CREDITS.md`, `packages/data/csv/items.csv`, Create `apps/client/src/game/itemIcons.test.ts`, 복사 `apps/client/public/icons/*.png` (git 밖)

**Interfaces:** Produces — 모든 `items.csv` icon 값이 CREDITS 복원 레시피에 있고 유일하다는 테스트 보증.

**확정 배정 (컨트롤러가 4배 확대 대조 시트로 승인 — 변경 금지):**

| item id | icon 값(새 파일명) | 원본 번호 |
|---|---|---|
| ice_shard | shard_ice | icon880 |
| pure_ice | crystal_ice | icon914 |
| soft_log | log_soft | icon958 |
| hard_log | log_hard | icon959 |
| common_herb | herb_common | icon288 |
| rare_herb | herb_rare | icon293 |
| copper_chisel | chisel_copper | icon930 |
| iron_chisel | chisel_iron | icon931 |
| copper_axe | axe_copper | icon453 |
| iron_axe | axe_iron | icon452 |
| copper_sickle | sickle_copper | icon459 |
| iron_sickle | sickle_iron | icon935 |

유지: copper_ore=ore_copper, iron_ore=ore_iron, copper_ingot=ingot_copper, copper_pickaxe=pickaxe_copper, iron_pickaxe=pickaxe_iron, copper_hammer=hammer_copper.

- [ ] RED: `itemIcons.test.ts` — (a) `loadGameData()` 모든 아이템의 icon 값이 CREDITS.md 복원 heredoc 의 이름 집합에 포함(줄 단위 정규식 `/^([a-z_]+):(\d+)$/` 파싱 — `toContain` 부분 문자열 금지: 접두사 오탐), (b) icon 값 Set 크기 = 아이템 수(같은 그림 돌려쓰기 금지), (c) heredoc 번호 Set 크기 = 이름 수(두 이름이 같은 원본을 가리키는 것 금지). CREDITS 는 repoRoot 상대경로로 읽는다(`playerSprites.test.ts` 전례). 현재 items.csv 는 중복투성이라 (b)가 즉시 RED — 이것이 RED 증거다.
- [ ] CREDITS.md: 아이콘 표에 12행 추가(번호→이름→그림 설명), 복원 heredoc 에 12쌍 추가, **본문 갱신** — "13종 수동 개명·확장 계획 없음" 문구를 "수십 종까지는 수동 개명 유지, 수백 종 시점에 형태×재질 팔레트 스왑 전환"으로.
- [ ] `assets/licensed/icons_8.13.20/fullcolor/individual_32x32/` 에서 위 표대로 `apps/client/public/icons/` 에 복사(기존 13개 파일은 그대로 둔다 — 유지분이 쓴다).
- [ ] items.csv 의 icon 값 12개 갱신 → 테스트 GREEN, `pnpm data:build`. 커밋(에셋 제외 확인 — `git status` 에 public/icons 가 나타나면 안 된다).

### Task B4: 열림 상태의 주인은 스토어 하나 — PanelScene 격하

**Files:** Modify `apps/client/src/store/gameStore.ts`(+test), `apps/client/src/game/scenes/PanelScene.ts`, `apps/client/src/game/scenes/ControlScene.ts`, `apps/client/src/ui/TopBar.tsx`

**Interfaces:** Produces —
```ts
// gameStore
openPanel: 'bag' | 'craft' | 'menu' | null       // 열림 상태의 유일한 주인
setOpenPanel(panel: OpenPanel): void              // 같은 값이면 무시, 다른 값이면 교체(상호배제는 값 하나라 공짜)
craftTally: Record<string, { success: number; fail: number }>  // 제작 패널 열릴 때 리셋
```
`craft()` 액션이 서버 응답 `outcome.success` 로 `craftTally[recipeId]` 를 갱신한다(반환값 변경 없음).

- [ ] RED: gameStore 테스트 — setOpenPanel 상호배제(craft 열고 menu 열면 craft 닫힘), craft 성공/실패가 tally 를 올림, 제작 패널 재오픈 시 tally 리셋, **logout·401 처리에서 `openPanel: null` 리셋**(`confirmingDelete` 전례 옆).
- [ ] 구현. PanelScene: `bag`/`craft` 렌더링·콘텐츠 제거, 자체 `open` 필드의 권위 폐지 — `applyInput` 은 그대로 입력 라우터로 남되 `store.openPanel` 을 읽고 쓴다: I→bag 토글, C→craft 토글, ESC/B(cancel)→ 무엇이든 열려 있으면 `null`, 아니면 menu 열기(현행 규칙 유지). 대사창 가드(대화 중 applyInput 미호출)는 건드리지 않는다. **DOM 패널에 키보드 리스너 금지.**
- [ ] 세계 잠금·컨트롤러 숨김을 Phaser 쪽 스토어 구독 **한 곳**으로: `lockedBy.panel = (openPanel !== null)`, `setControllerVisible(openPanel === null)`, bind 시점 초기값에도 적용. menu 패널 그리기는 `openPanel === 'menu'` 구독으로.
- [ ] ControlScene 가방/제작 버튼 → `setOpenPanel` 토글. TopBar 톱니(`openMenuTab`) → 열려 있던 DOM 패널을 닫고 menu 를 여는 스토어 경로로.
- [ ] 브라우저: I/C/ESC 라우팅 매트릭스(가방 열고 ESC→닫힘만, 메뉴 열고 I→메뉴 닫히고 가방, 대화 중 I 무시, 톱니→가방 닫히고 메뉴), 이동 잠금·컨트롤러 숨김 확인. 이 시점에 bag/craft 는 빈 DOM 패널(제목+✕)이어도 된다 — 배선이 이 태스크의 산출물이다. 커밋.

### Task B5: 가방 패널 (DOM)

**Files:** Create `apps/client/src/ui/BagPanel.tsx`, Modify `apps/client/src/ui/TopBar.tsx`(마운트 지점), `apps/client/src/styles/ui.css`, 재사용 `apps/client/src/ui/ItemIcon.tsx`

**마운트:** `App.tsx` 는 불가침이므로 건드리지 않는다. `DeleteCharacterDialog` 전례를 그대로 따른다 — `TopBar.tsx` 안에서 `<BagPanel/>`(뒤 태스크에서 `<CraftPanel/>`)을 조건부 렌더. 패널은 `position: fixed` 오버레이라 부모가 상단바여도 상관없다(DeleteCharacterDialog 가 이미 그렇게 동작).

**Interfaces:** Consumes — `openPanel === 'bag'`, `player.instances/equipped/stacks`, `data.items`, `ItemIcon`.

- [ ] 도구 섹션: `instances` 배열 순서대로 한 줄 행 — 아이콘+이름, 착용 중이면 조용한 배지(`--c-accent` 작은 점+글자), `enhanceLevel > 0` 일 때만 `+N`. **행은 버튼이 아니다** — 눌림·테두리 어포던스 금지(§8-앞 13).
- [ ] 재료 섹션: `stacks` 를 `items.csv` 선언 순서(= `Object.keys(data.items)` 순서)로 아이콘+이름+`×N` 2열 그리드. 비면 "아직 모은 재료가 없다." 한 줄(전체-빈 상태는 만들지 않는다).
- [ ] 스타일: `.modal` 관례 확장(스크림+카드, 상단바 아래 전체, 내부 `overflow-y:auto`), 닫기는 ✕ 버튼만(스크림 탭 닫기 없음 — 스크롤 오조작 방지). 수량 숫자 16px.
- [ ] 브라우저(812×375): 채집으로 재료 몇 개 모아 실물 아이콘·수량 확인, 빈 재료 문구, 스크롤. 전체 화면 스크린샷 저장(컨트롤러 검수용). 커밋.

### Task B6: 제작 패널 (DOM) — 카드·홀드 반복·누적 카운터

**Files:** Create `apps/client/src/ui/CraftPanel.tsx`, `apps/client/src/ui/craftCardModel.ts`(+test), `apps/client/src/ui/useCraftHold.ts`(+가능한 순수부 test), Modify `apps/client/src/styles/ui.css`, Delete `apps/client/src/game/craftPanelContent.ts`(+test — 이 태스크에서 대체 완료 시)

**Interfaces:**
- `buildCraftCards(data, player, tally) → { category: string, cards: CraftCard[] }[]` — 카테고리 순서 = recipes 순회의 첫 등장 순서, 카드 순서 = 선언 순서 고정. `CraftCard = { recipeId, name, icon, ownedOutput, state: 'ready'|'no_materials'|'locked', chancePct, proficiency, requiredSkill, materials: {name, have, need, ok}[], tally: {success, fail} }` — shared 의 `canCraft`/`calcCraftSuccess`/현행 afford 로직 재사용(판정 복제 금지).
- `useCraftHold(recipeId, enabled)` — pointerdown: 즉시 1회 `store.craft`; **반복 타이머는 `craftRepeatUnlocked` 참일 때만 arm**(§8-앞 1). 루프는 rAF(≤50ms) 폴링 + 세 게이트: 패널 전역 pending 하나 · `nextActionAt` · afford(§8-앞 2). pointerup/pointercancel/이동 10px 초과 → 중단. 카드 CSS `touch-action: pan-y`(§8-앞 10).

- [ ] RED→GREEN: craftCardModel 테스트 — 카테고리 그룹화·순서, locked/no_materials/ready 판정이 shared 판정과 일치, ownedOutput, tally 반영.
- [ ] RED→GREEN: 홀드 게이트 순수부 테스트 — repeat 미해금이면 타이머 안 돎(탭 1회만), pending 중 재발화 없음, 멀티 카드 동시 홀드에도 pending 하나.
- [ ] 카드 렌더: 1행 아이콘+이름+`보유 N`+상태 슬롯(성공률 고정 슬롯/재료 부족/`조합 숙련도 현재/필요`), 2행 재료 칩(충족 `--c-success`·부족 `--c-danger`) + 누적 `+N · 실패 M`. **잠긴 카드: 아이콘·이름·재료만 흐림, 요구치 카운터는 `--c-accent` + `tabular-nums` 풀 콘트라스트**(§8-앞 11). 카드 높이 ≤72px, 숫자 16px.
- [ ] 점멸 없음 — 피드백은 tally 숫자 증가와 보유 N 증가가 전부(§8-앞 3·4).
- [ ] `craftPanelContent.ts` 사용처가 0이 됐으면 테스트와 함께 삭제(ScrollList 는 menu 가 쓰면 남긴다 — 확인 후).
- [ ] 브라우저: 탭 제작 성공/실패 → tally·보유 N 증가, 잠긴 카드 요구치가 카드에서 가장 밝은 요소인지, 카드 2.5장+ 가시, 드래그 스크롤 vs 탭 오발 없음. 스크린샷 저장. 커밋.

### Task B7: 정리·전 여정 검증

**Files:** 잔여 죽은 코드 정리(전 태스크에서 못 지운 것), 검증 산출물은 scratchpad

- [ ] grep 으로 잔존 참조 0 확인: `buildCraftLines`, `BAG_BODY`, `nextMilestone`, `describeNextMilestone`.
- [ ] 브라우저 전 여정(812×375): 로그인→맵 이름 헤더→채집→가방(아이콘·수량)→제작(카드·tally)→맵 이동(헤더 갱신)→대화 중 I/C 무시→메뉴/DOM 상호배제→ESC 라우팅. 각 단계 스크린샷을 scratchpad 에 저장(컨트롤러 검수용).
- [ ] `pnpm data:build && pnpm test && pnpm typecheck && pnpm --filter @nogada/client build` 전부 초록. 커밋(정리분).

---

## 자체 점검

| 스펙 | 태스크 |
|---|---|
| §2 DOM 이전·배선 / §8-앞 6~10 | B4 |
| §3 category / §8-앞 14·15 | B1 |
| §4 아이콘 / §8-앞 16~19 | B3 |
| §5 가방 / §8-앞 13 | B5 |
| §6 카드·반복 / §8-앞 1~5·11·12 | B6 |
| §7 헤더 / §8-앞 20 | B2 |
| §9 성공 기준 1·2 | B5·B6·B7 / 3 | B3 / 4 | B2 / 5 | B1·B3 / 6 | B5·B6·B7 |

**범위 밖:** 수동 착용 API, 아이템 상세, menu 패널 DOM 이전, 판매/버리기, 팔레트 스왑 파이프라인.
