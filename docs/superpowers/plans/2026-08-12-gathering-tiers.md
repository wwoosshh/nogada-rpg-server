# 채집 티어 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 채집 판정이 "성공/실패"에서 "숙련 브라켓별 티어 분포"로 바뀌고, 네 채집장이 5~7단 사다리(신규 17종)를 갖는다.

**Architecture:** 표(브라켓 누적 확률)는 CSV 3파일이 소유하고 빌드가 **서버 전용 산출물**로 굽는다(클라이언트에 실으면 숨은 문턱이 스포일된다). `packages/shared`의 `gatherOutcome` 하나가 판정하고 서버만 표를 가진 채 부른다. 판정 순서: 티어 → 숙련(무조건) → 이정표(무조건) → 지급(성공 시).

**Tech Stack:** TypeScript strict, Vitest(결정적 N=100,000 시뮬), Fastify, CSV→JSON 빌드.

**설계 문서:** `docs/superpowers/specs/2026-08-12-gathering-tiers-design.md` — 의미론의 유일한 원본. **§7-앞(평가 반영 규범 19개)이 다른 절보다 우선한다.**

**원작 수치 원본(구현 태스크가 읽는다):** 분석 스크래치패드
`C:\Users\user\AppData\Local\Temp\claude\C--Users-user-Desktop------nogadaRPG-fanmade--claude-worktrees-game-project-structure-ccd670\248133a1-5d23-4e36-8add-abd6866daacf\scratchpad\`
의 `prob_261.txt`(얼음) `prob_262.txt`(허브) `prob_263.txt`(나무) `prob_264.txt`(광물).

## Global Constraints

- 게임 규칙은 `packages/shared` 에만. 서버가 판정의 유일한 주인.
- **확률표는 클라이언트 번들 금지**(§7-앞 9) — GameData 에 넣지 않는다.
- **`apps/client/src/ui/App.tsx` 불가침. `git add -A`/`commit -a` 금지.** 커밋 후 `git status --short` 에 그 파일(` M`)만.
- import 는 `.js` 확장자; strict; 주석·테스트 이름은 왜. 검증 메시지는 CSV 작가가 읽는다.
- 커밋 한국어 + 왜, 트레일러 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- 매 태스크 `pnpm data:build && pnpm test && pnpm typecheck`, 클라 태스크는 `pnpm --filter @nogada/client build` 추가.
- 라이선스 에셋은 git 밖(CREDITS 레시피로만).
- 기존 8종 아이템 id 불변(세이브 호환 = id·소지품·착용 보존, §7-앞 17).

---

### Task G1: 아이템 20종과 아이콘 — 사다리의 얼굴

**Files:** Modify `packages/data/csv/items.csv`, `assets/CREDITS.md`, `apps/client/src/game/itemIcons.test.ts`(필요 시), 복사 `apps/client/public/icons/*.png`(git 밖)

**확정 아이콘 배정 (컨트롤러가 4배 대조 시트로 승인 — 변경 금지):**

| item id | 이름 | kind | icon(새 파일명) | 원본 |
|---|---|---|---|---|
| ice_crystal | 얼음 결정 | material | crystal_pale | icon918 |
| pure_ice_crystal | 맑은 얼음 결정 | material | gem_blue | icon982 |
| ice_gem | 얼음의 보석 | material | gem_ice | icon999 |
| tea_leaf | 찻잎 | material | leaf_tea | icon289 |
| golden_leaf | 금빛 잎 | material | leaf_gold | icon290 |
| tree_fruit | 나무 열매 | material | fruit_red | icon304 |
| golden_fruit | 금빛 열매 | material | fruit_gold | icon305 |
| lavender | 라벤더 | material | flower_lavender | icon301 |
| lime | 라임 | material | fruit_lime | icon306 |
| sage | 세이지 | material | herb_sage | icon294 |
| aroma_herb | 아로마 | material | herb_aroma | icon296 |
| millennium_leaf | 천년초 잎 | material | herb_millennium | icon297 |
| silver_ore | 은 원석 | material | ore_silver | icon969 |
| gold_ore | 금 원석 | material | ore_gold | icon970 |
| sapphire_ore | 사파이어 원석 | material | ore_sapphire | icon909 |
| ruby_ore | 루비 원석 | material | ore_ruby | icon910 |
| mithril_ore | 미스릴 원석 | material | ore_mithril(재사용) | — |
| silver_ingot | 은 주괴 | material | ingot_silver | icon960 |
| gold_ingot | 금 주괴 | material | ingot_gold | icon965 |
| mithril_ingot | 미스릴 주괴 | material | ingot_mithril(재사용) | — |

(mithril_pickaxe 는 G5 에서 tool 로 추가 — icon `pickaxe_reinforced` 재사용.)

- [ ] items.csv 에 20행 추가(id·이름·kind=material·icon — 위 표 그대로. 순서는 §4 사다리 순으로 스킬별 묶음).
- [ ] CREDITS.md: 표 18행 + 복원 heredoc 18쌍 추가, 예비 목록 갱신(ore_mithril·ingot_mithril·pickaxe_reinforced 가 주인을 얻는다).
- [ ] 원본에서 18개 PNG 복사(`assets/licensed/icons_8.13.20/fullcolor/individual_32x32/`). 라이선스 파일 커밋 금지 확인.
- [ ] 기존 3중 유일성 테스트가 그대로 확장 통과(행 추가만으로 — RED 는 items.csv 먼저 고치고 CREDITS 안 고친 상태로 확인 가능). `pnpm data:build` — **주의: 이 시점 신규 아이템은 어느 노드·레시피도 참조 안 하므로 도달 가능성 검사가 막을 수 있다** — validate 의 obtainable/도달 검사가 실패하면 그 검사에 "표 시스템 이행 중" 임시 허용을 넣지 말고, **G2 가 끝날 때까지 이 태스크의 커밋을 items+CREDITS 준비 커밋으로 좁히고 검증 실패 여부를 보고하라** (실패하면 G1·G2 를 한 커밋으로 합치는 재량 허용).
- [ ] 커밋.

### Task G2: 표 3파일 — 데이터·파서·검증·서버 전용 산출물

**Files:** Create `packages/data/csv/gather_tables.csv`, `gather_tiers.csv`, `gather_brackets.csv`, `packages/data/src/gatherTables.ts`(+test), Modify `packages/data/src/parse.ts`(필요 시 헬퍼), `validate.ts`(+test), `build.ts`, `packages/shared/src/types.ts`

**Interfaces:** Produces —
```ts
// shared/types.ts
export interface GatherTierDef { itemId: string }            // 표 순서 = 희귀→흔함
export interface GatherBracketDef { bracketMax: number | null; cumulative: number[] } // null = ∞
export interface GatherTableDef {
  id: string; skill: SkillId
  skillGainMin: number; skillGainMax: number
  tiers: GatherTierDef[]; brackets: GatherBracketDef[]
}
export type GatherTables = Record<string, GatherTableDef>
```
빌드 산출물: `packages/data/src/generated/gather-tables.json` — **GameData 에 넣지 않는다.** `loadGatherTables()` 별도 export(서버만 import).

- [ ] CSV 3파일 작성 — 스펙 §3.1·§7-앞 3. 수치는 스크래치패드 prob 덤프에서 옮긴다: 얼음=prob_261 그대로(5티어), 허브=prob_262 그대로(7티어), 나무=prob_263 그대로(6티어·8브라켓), 광물=prob_264 에서 **§7-앞 6 규칙**(유지 티어 누적값 그대로, 황동·에메랄드·다이아 행 삭제 → 질량은 다음 행에 자동 흡수; 브라켓별 마지막 누적 20000/25000/70000/80000/90000/100000 보존). skillGain 은 전 표 1~2.
- [ ] RED: 파서·검증 테스트 — ∞ 브라켓 없음/두 개/중간 위치, 없는 tableId 참조(노드), 고아 표, 두 기술이 한 표 공유, 누적 같은 값(폭 0), cum 칸 수 ≠ 티어 수, 없는 itemId, skillGainMin>Max, bracketMax 역순. 전부 작가용 한국어 메시지.
- [ ] 검증 경고: 마지막 브라켓 실패 0% 아님 / 첫 브라켓에 최상 티어 부재(잭팟 소실).
- [ ] build.ts: gather-tables.json 별도 산출 + "데이터 빌드 완료" 에 `채집표 4` 추가. GameData 미포함 확인(클라 번들 grep).
- [ ] `nodes.csv` 개조: `yieldItem/yieldMin/yieldMax/baseChance/tier/skillGainMin/skillGainMax` → `tableId,variant` (variant: `normal`|`deep` — 표시 전용). 기존 8개 node id 유지(.tmx 무수정). parse·validate 의 노드 검사 개조(§7-앞 11: 도달 가능성 = "기술 도구 도달 가능 → 표의 전 아이템 도달 가능", obtainable 동반 개조).
- [ ] `requiredSkill > 0 레시피 ⊆ recipes-이정표` 역방향 검증 추가(§7-앞 5).
- [ ] 커밋 (G1 이 검증에 막혔다면 여기서 합류 — G1 항목 참조).

### Task G3: shared 판정 교체 — gatherOutcome 과 시뮬 증명

**Files:** Create `packages/shared/src/formulas/gatherTable.ts`(+test), Modify `packages/shared/src/formulas/gather.ts`(+test), `packages/shared/src/proficiency.ts`(+test), `packages/shared/src/equipment.ts`(필요 시), `packages/shared/src/index.ts`, `packages/data/src/content-cli.ts`

**Interfaces:** Produces —
```ts
export function toolGatherFactor(def: ItemDef): number      // 1티어 1.0 / 2티어 0.9 / 3티어 0.8
export function jackpotFlatBonus(def: ItemDef): number      // 1티어 0 / 2티어 2 / 3티어 3 (roll≤10 밴드 평감산)
export interface GatherRollResult { itemId: string | null; roll: number }
export function gatherOutcome(table: GatherTableDef, proficiency: number, tool: ItemDef, rng: () => number): GatherRollResult
// rawRoll = floor(rng()*100001); rawRoll<=10(잭팟 밴드) 이면 roll = rawRoll - jackpotFlatBonus
// (음수 방지 clamp 0), 아니면 roll = floor(rawRoll*factor) — 곱과 평감산은 배타적이다(스펙 §7-앞 13)
// 브라켓: 첫 번째 bracketMax >= proficiency (∞=null 은 항상 매치, 마지막)
// 티어: 첫 번째 cumulative >= roll... 정확한 부등호는 원작 준용: roll <= cumulative[i] 첫 매치. 어디에도 안 걸리면 실패.
export function canGather(equippedTier: number): boolean    // > 0 — 맨손 거부 명시 조건 (§7-앞 8)
```

- [ ] RED→GREEN: gatherOutcome 경계 테스트 — 브라켓 경계값(500/501), ∞ 브라켓, roll=0(최상 티어), roll=100000(최종 브라켓에서 tier1 = 실패 0%), 잭팟 밴드 평감산, factor 적용, 맨손 거부.
- [ ] **결정적 시뮬 테스트(N=100,000, createRng 고정 시드)** — §8 성공 기준 1·2·4·5: 숙련 0 얼음 분포(t1≈45%·실패≈40%·t2≈15%·잭팟>0), 브라켓 경계 전후 분포 계단(표별 실제 경계 — 나무는 70k), 전 표 전 티어 드랍 > 0, 구리 vs 철 vs 미스릴 희귀 티어 유의차. 허용 오차는 이항 표준편차 3σ.
- [ ] 은퇴(§7-앞 2): `calcGatherChance`(채집 한정 — 제작 쪽 함수 확인), `yieldBonus`·`MAX_YIELD_BONUS`·`YIELD_DECADES`, `toolCoversNode`·`toolAppliesTo` 의 tier 게이트, effect kind `nodes`(타입·파서·테스트). 관련 테스트 개조.
- [ ] content-cli 에 `gather <tableId> --prof N --tool <itemId> --n N` 부명령 — 분포 표 출력(엔진 함수 그대로).
- [ ] 커밋.

### Task G4: 서버 통합 — 판정 순서가 바뀐다

**Files:** Modify `apps/server/src/services/gatherService.ts`(+test), `apps/server/src/app.ts`(테이블 로드), `apps/server/src/routes/gather.ts`(필요 시), `packages/shared/src/protocol.ts`(DTO)

- [ ] RED: 새 판정 순서 테스트 — 실패 롤에서도 숙련이 오르고 문턱을 넘기면 `achieved` 가 찬다(§7-앞 7); 성공 롤은 해당 itemId 1개 지급; 맨손 400; `too_fast` 불변; rng 소비 횟수 변화가 재시도 재롤(applyToCharacter)과 무해함 확인.
- [ ] `loadGatherTables()` 를 앱 조립에서 주입(서버만 import — 클라 번들에 안 실리는 것 grep 증명). DTO: `chance` 제거, `gained` → `{ itemId, count: 1 } | null` 형태(기존 클라 소비처와 함께 — 클라 컴파일은 G6 에서 마감되므로 이 태스크는 protocol+server 만 초록이면 된다: 클라가 깨지면 최소 수정만).
- [ ] gatherService.test 픽스처 전면 개조(`alwaysSucceed=()=>0` 의 의미가 "최상 티어 잭팟"으로 바뀜 — 이름도 사실대로).
- [ ] routes/gather.ts 의 낡은 주석(시드 재생성 운운) 정정(§7-앞 평가 참조). 커밋.

### Task G5: 레시피 4종과 이정표 — 사다리의 문

**Files:** Modify `packages/data/csv/recipes.csv`, `packages/data/csv/milestones.csv`, `packages/data/csv/items.csv`(mithril_pickaxe 1행)

- [ ] items.csv: `mithril_pickaxe,미스릴 곡괭이,tool,mineral,3,pickaxe_reinforced` 추가.
- [ ] recipes.csv: 스펙 §5 갱신표 그대로 4행(은/금/미스릴 주괴=제련, 미스릴 곡괭이=도구; requiredSkill·baseChance·skillGain 명기값).
- [ ] milestones.csv: recipes-이정표 4행(threshold = requiredSkill, crafting_10000 과 별도 id). G2 의 역방향 검증이 초록.
- [ ] 자동 착용 확인 테스트: 미스릴 곡괭이 제작 성공 시 tier 3 > 2 로 자동 착용(기존 로직 무수정 통과 — 테스트로 못박기). 커밋.

### Task G6: 대사 문턱 — 소문으로만 발견되는 숫자들

**Files:** Modify `packages/data/dialogues/*.dlg` (채집장 화자 4 + 눈의마을 주민 일부)

- [ ] 각 채집장 화자(채집장노인 등 4명)에 **@greet 계열 조건부 대사**(§7-앞 16 — 이정표 금지):
  - 해당 스킬 5,000↑: 거래를 암시하는 대사 변화(상점 훅 — "물건을 좀 보여줄 수도 있는데" 류).
  - 해당 스킬 85,000↑: 결계/심층을 예고하는 대사("이 숙련이면 저 안쪽 결계도…").
- [ ] 달인 문턱 4종(§7-앞 16): 얼음 63,235 / 나무 7,587 / 광물 21,345 / 허브 33,526 — 눈의마을·각 마을 주민의 자랑 대사가 그 숫자를 말하고, 플레이어가 넘어서면 감탄으로 바뀐다(조건 미충족/충족 두 갈래).
- [ ] `pnpm data:build` 검증 통과(대사 조건 문법은 기존 검증기 준수 — 형식은 기존 .dlg 의 조건부 대사 전례를 따른다). content-cli 로 두 갈래 대사 확인 출력 첨부. 커밋.

### Task G7: 클라이언트 표면과 전 여정 검증

**Files:** Modify `apps/client/src/store/gameStore.ts`, `apps/client/src/game/NodeMarker.ts`, `apps/client/src/game/scenes/WorldScene.ts`, 죽은 코드 정리(`selectGatherChance` 등)

- [ ] 채집 피드백이 아이템 이름을 말한다: 성공 "얼음 결정 +1", 실패는 기존 문구 유지하되 숙련이 오른 사실이 보이게(기존 ActionFeedback 채널 안에서 — 새 채널 금지). 서버 DTO 변경(G4)에 맞춰 gather 액션 개조.
- [ ] NodeMarker: tier 색 → `variant` 색(normal/deep 2색 — tokens 주석 규칙 유지).
- [ ] 죽은 코드 정리: `selectGatherChance`, DTO `chance` 잔재, gather 관련 낡은 주석.
- [ ] 브라우저(812×375, **로컬 서버** — .env.development.local 임시 사용 후 삭제): 채집 연타로 t1 위주 드랍 + 아이템명 피드백, 가방에 새 재료 아이콘, 제작 패널에 잠긴 새 레시피 4종(요구치 표시), content-cli 분포와 실플레이 체감 대조. 스크린샷.
- [ ] `pnpm data:build && pnpm test && pnpm typecheck && pnpm --filter @nogada/client build` 전부 초록. 잔존 grep(`yieldItem`, `calcGatherChance`, `yieldBonus`) 0. 커밋.

---

## 자체 점검

| 스펙 | 태스크 |
|---|---|
| §2 판정 모델 / §7-앞 2·7·8·13·18 | G3·G4 |
| §3.1 표·검증 / §7-앞 3·4·5·6·9 | G2 |
| §3.2 노드 / §7-앞 10·11 | G2·G7 |
| §3.3 도구 | G3 |
| §4 사다리 / §7-앞 1 | G1 |
| §5 레시피 문 / §7-앞 15 | G5 |
| §6 문턱 / §7-앞 16 | G6 |
| §8 성공 기준 1~5 = G3 시뮬 / 6 = G1·G5 / 7 = G2 / 8 = §7-앞 17 |
| §7-앞 12 시뮬 주체 | G3(vitest+cli) |
| §7-앞 14 페이싱 수용 | 스펙 선언(태스크 없음) |

**범위 밖:** 상점·가공·수집가의방·결계 통로·광산의방·소비 효과·광물 8~10단.
