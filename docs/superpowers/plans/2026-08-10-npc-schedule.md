# NPC 일과 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** NPC 위치가 시간의 순수 함수가 되어, 여관안주인이 시각에 맞춰 눈의마을을 걸어 다니고 밤에는 실내로 사라진다.

**Architecture:** `packages/shared` 의 `npcStateAt` 하나를 서버·클라이언트가 같이 부른다. 지점은 맵의 `places` 오브젝트 레이어, 일과는 `schedules/*.sched`, 경로는 빌드가 A\*로 굽는다. 걷는 NPC는 차단하지 않는다(서 있을 때만 몸이 있다).

**Tech Stack:** TypeScript strict, Vitest, Fastify+zod, Phaser 3.90.

**설계 문서:** `docs/superpowers/specs/2026-08-10-npc-schedule-design.md` — 의미론의 유일한 원본. 계획과 어긋나면 설계 문서가 이긴다.

## Global Constraints

- 게임 규칙은 `packages/shared` 에만. 서버가 판정의 유일한 주인. 클라이언트는 결정하지 않는다.
- `NPC_STEP_MS = 400` (실측 ms/칸). 시간 축은 실측 ms — `minuteOfDay`(해상도 2.5초) 금지.
- 변주 시드는 **그 줄의 출발 시점이 속한 날** 로 귀속. `HH:MM` 은 **도착** 시각.
- import 는 `.js` 확장자; `strict: true`, `noUncheckedIndexedAccess: true`; 주석·테스트 이름은 왜.
- 검증 메시지는 일과를 쓰는 작가가 읽는다 — 무엇이 왜 틀렸고 무엇을 하면 되는지, 기존 결대로.
- **`apps/client/src/ui/App.tsx` 불가침. `git add -A`/`commit -a` 금지.** 커밋 후 `git status --short` 에 그 파일만.
- 커밋 메시지 한국어 + 왜, 트레일러 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- 매 태스크 `pnpm data:build && pnpm test && pnpm typecheck`, 클라이언트 태스크는 `pnpm --filter @nogada/client build` 추가.

---

### Task SC-1: `worldNow()` 단조화

**Files:** Modify `apps/client/src/game/clock.ts` (+test 신설 가능하면 순수부 분리)

**Interfaces:** Produces — `worldNow()` 가 뒤로 튀지 않는다. 재동기로 목표 시각이 과거로 이동하면 즉시 점프하지 않고 기울여(slew) 따라잡는다 (예: 실측 1초당 최대 200ms 보정). 전진 점프는 즉시 허용.

- [ ] 순수 slew 계산을 함수로 분리해 테스트: 뒤로 2초 재동기 시 반환값이 단조 유지, 수 초 안에 수렴; 앞으로 점프는 즉시.
- [ ] 기존 소비자(시계 표시, facts) 회귀 없음 확인. 커밋.

### Task SC-2: 일과 데이터 — 지점·`.sched`·검증·경로 굽기

**Files:** Create `packages/data/src/places.ts`(+test), `packages/data/src/schedule.ts`(+test), `packages/data/src/routeBake.ts`(+test), `packages/data/schedules/`(빈 디렉터리 + README 한 단락), Modify `packages/data/src/tmx.ts`(places 레이어 통과 확인), `maps.ts`, `validate.ts`, `build.ts`, `packages/shared/src/types.ts`

**Interfaces:**
- `PlaceDef { id, mapId, x, y, indoor: boolean, facing: Direction | null }` — 맵의 `places` objectgroup(오브젝트 이름=id, 속성 indoor·facing)에서 파싱. id 전역 유일.
- `ScheduleEntry { arriveMinute: number, placeIds: string[] }` (변주 후보 배열), `ScheduleDef { speakerId, entries }` — `schedules/<화자id>.sched` 파싱. 화자당 하나.
- `BakedLeg { fromPlace, toPlace, steps: { mapId, x, y }[] }` — A\* 결과. 변주 포함 모든 (이전지점→후보지점) 쌍 + 되감기 구간을 굽는다.
- `GameData.places: Record<string, PlaceDef>`, `GameData.schedules: Record<string, ScheduleDef>`, `GameData.routes: BakedLeg[]`.
- A\* 걷기 판정 = 벽 + 노드 배치 + 정적 화자 칸 + 지점 칸(standing NPC 자리), 맵 간선은 `transitions.csv` **양방향 확인**, **개발맵 제외**.

- [ ] 파서 테스트 RED→GREEN: 정상, `25:00`, 중복 시각(오류다 — 조용히 앞줄을 죽이므로), 역행, 없는 지점, 빈 파일, 한 줄 일과.
- [ ] 검증 테스트: 지점이 벽/노드/다른 지점/전환 칸/전환 도착 칸 위; 경로 부재(양방향); 도착 불가능 시간표(역산 출발 < 앞 줄 도착, 되감기 포함); 같은 시각 같은 지점 겹침은 경고.
- [ ] 빌드 통합: `데이터 빌드 완료` 에 `지점 N, 일과 N` 추가. 성공 시 생성물에 routes 포함. 커밋.

### Task SC-3: `npcStateAt` — 공유 순수 함수

**Files:** Create `packages/shared/src/npcSchedule.ts`(+test), Modify `packages/shared/src/index.ts`

**Interfaces:** `npcStateAt(schedule: ScheduleDef, places, routes, nowMs): NpcState` / `NpcState = { mapId, tile: {x,y}, facing, activity: 'standing'|'walking'|'indoor' }` / `NPC_STEP_MS = 400` / 변주 선택 `pickVariant(speakerId, dayIndex, entryIndex, candidates)` — 결정적 시드(기존 `rng.ts` 재사용).

- [ ] 테스트 RED→GREEN (설계 §9.6 전부): 자정 넘김(어제 마지막 줄 활성), 출발 직전/직후/도착 순간, 변주 시드의 날짜 귀속(자정 걸친 걸음이 목적지를 다시 뽑지 않음), 한 줄 일과(0길이 되감기 = 종일 그 지점), 빈 일과 없음(빌드가 막음 — 함수는 entries ≥ 1 가정 명시), walking 중 mapId 전환, indoor.
- [ ] 결정성 테스트: 같은 입력 1000회 같은 출력, 시각 미세 증가에 칸이 역행하지 않음. 커밋.

### Task SC-4: 서버 — 계산된 위치로 판정

**Files:** Modify `apps/server/src/services/talkService.ts`(+test), `packages/shared/src/protocol.ts`(`not_here` 코드)

- [ ] 테스트 RED→GREEN: 일과 NPC가 `indoor`/`walking` 시각이면 `not_here`; 다른 맵 `standing` 이면 `wrong_map`; 같은 맵 `standing` 이면 대화 성공; 일과 없는 화자는 기존 경로 그대로(회귀).
- [ ] `now` 는 라우트가 이미 주입 — 서비스는 그것으로 `npcStateAt` 호출(자체 시계 금지). 커밋.

### Task SC-5: 클라이언트 — 스케줄러와 표면

**Files:** Modify `apps/client/src/game/scenes/WorldScene.ts`, `NpcSprite.ts`, `store/gameStore.ts`, `scenes/DialogueScene.ts`, Create `apps/client/src/game/npcScheduler.ts`(+가능한 순수부 test)

- [ ] 스케줄러 틱: 현재 맵 일과 NPC를 `npcStateAt` 샘플링, `NpcSprite` 공급자로. 걷기 애니메이션은 칸 변화.
- [ ] 스폰·프리로드를 `npcStateAt` 기준으로 (일과가 이 맵에 데려올 수 있는 모든 NPC 시트 로드).
- [ ] `blocked`/`byTile` 은 `standing` 전이 시에만 갱신, `walking` 은 통과 장식(차단·대화 불가).
- [ ] facing 소유권: 스케줄러는 걷는 동안만. `standing` 은 기존 미세 동작 소유.
- [ ] `not_here` 표면: 스토어가 받아 대사창 자리에 "지금 여기 없는 것 같다" — DialogueScene 재사용.
- [ ] 브라우저 검증(812×375): 검증용 임시 `.sched`(현재 시각 부근으로 시간 조정)로 — 걷는 모습, 통과, standing 차단, indoor 후 `not_here` 표면 — 확인 후 **실제 시간표로 되돌려** 커밋. 순수 함수 테스트가 실제 시각 의미론을 보증한다.

### Task SC-6: 첫 콘텐츠 — 여관안주인과 노인의 하루

**Files:** Modify `packages/data/maps/눈의마을.tmx`(places 레이어: 여관앞·눈광장·여관안), `packages/data/maps/얼음채집장.tmx`(초소·심층광맥곁), Create `packages/data/schedules/여관안주인.sched`, `packages/data/schedules/채집장노인.sched`

- [ ] 설계 §8 대로: 여관안주인 = §2.2 예시 시간표(indoor 밤잠 포함, 변주 1곳). 채집장노인 = 맵 안 순찰만(06:00 초소, 12:00 심층 광맥 곁, 15:00 초소; indoor 없음 — 문턱 대사의 주인이 사라지면 안 된다).
- [ ] 지점 배치는 맵 렌더로 확인(scratchpad render-maps.ps1) — 문 앞·광장 가장자리, 길 폭을 다 막지 않는 자리.
- [ ] flood-fill 전 맵 재검증(standing 지점 차단 포함). 브라우저에서 여관안주인의 걷는 하루 한 구간 실관찰. 커밋.

---

## 자체 점검

| 설계 | 태스크 |
|---|---|
| §1 단조화 | SC-1 |
| §2 지점·일과 형식 | SC-2, SC-6 |
| §3 굽기·검증 | SC-2 |
| §4 의미론 | SC-3 |
| §5 서버·not_here 표면 | SC-4(판정), SC-5(표면) |
| §6 클라이언트 | SC-5 |
| §8 첫 콘텐츠 | SC-6 |
| §9 성공 기준 1·4 | SC-5 검증 / 2·3 | SC-6 / 5 | SC-2 / 6 | SC-3 |

**범위 밖:** 호감도 패널, `npc.activity` 사실, 실내 맵, 날씨 예외, `content npc` 도구.
