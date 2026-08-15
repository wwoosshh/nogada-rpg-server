# 전투 루프 봉합 구현 계획 (아크 D)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.
> 스펙: `docs/superpowers/specs/2026-08-15-combat-loop-seal-design.md` (61a1f8d 평가 반영본).

**Goal:** 배포된 전투 루프의 새는 곳 넷을 잇는다 — 강화→피해, 여관 기계, 예고 하한 강제, 좌표 상한.

**기준선:** 테스트 2,004 / 96 파일 (커밋 61a1f8d 시점). 관문 = `pnpm data:build && pnpm test && pnpm typecheck`.

## Global Constraints

- 판정 부등호는 shared 한 벌 — 피해 식(`swingDamageOf`)을 서버 판정·가방 표시가 같이 부른다.
- 거절 경로는 아무것도 저장하지 않는다. 죽은 버튼 금지(만혈 여관 버튼). 경합 거절은 describeError 한글 문구.
- 값은 데이터 소유: 여관비 1,500G 는 inns.csv 가 소유, innPricing.test 는 구운 데이터를 읽는다.
- `apps/client/src/ui/App.tsx` 불가침. git add 는 파일 명시. 에셋 커밋 금지.
- 새 검사 하한 = `JUDGE_EPSILON_MS + 700` (shared import, 문구도 상수 보간 — 리터럴 금지).
- 돌연변이로 각 검사·식이 무는 것을 증명하고 원복한다.

---

### Task D1: 강화가 피해를 산다

**Files:** `packages/shared/src/combatState.ts`(+test), `apps/client/src/ui/BagPanel.tsx`
**Interfaces:** 신설 `swingDamageOf(def: ItemDef, enhanceLevel: number): number` = `(def.damage ?? UNARMED_COMBAT_DAMAGE) + enhanceLevel`. 기존 `swingDamage(player, items)` 는 equippedToolInfo 인스턴스의 enhanceLevel 로 이 식을 부른다(맨손 = 상수 그대로). `toolSpeedLabel` combat 분기가 `def.damage ?? 0` 대신 이 식을 부른다.
**Tests:** +0=5, +3=8(늑대 8 → 1스윙 경계), +5=10, 맨손 무영향, 엉뚱한 슬롯 도구 = 맨손 유지. fightService 통합: +3 검으로 한 스윙 처치. 돌연변이: 식에서 `+ enhanceLevel` 제거 → red.
**스펙 §1 의 "열린 위험" 문장을 combatState 주석으로 옮겨 적는다** (+4·+5 는 현 몬스터에 죽은 단 — 다음 몬스터가 산다).

### Task D2: 여관 — 데이터·서버·화면

**Files:** `packages/data/csv/inns.csv`(new), `packages/data/src/inns.ts`(new, 파서+검증), `packages/data/src/build.ts`, `packages/shared/src/types.ts`(GameData.inns, TalkOutcome.inn?), `packages/shared/src/protocol.ts`(응답 스키마가 있으면), `apps/server/src/services/innService.ts`(new)+`talkService.ts`(inn 게이트)+`routes/inn.ts`(new)+`app.ts`, `apps/client/src/store/gameStore.ts`(pendingInn·describeError)+`apps/client/src/ui/InnPanel.tsx`(new)+마운트 지점(TopBar 가 BagPanel 을 마운트하는 그 자리), `packages/data/src/innPricing.test.ts`(구운 데이터 읽기로 개정, 1,500G 산술 기록)
**Interfaces:** `inns.csv` = `speakerId,gold` → `여관안주인,1500`. `performRest({player, inn, now})`: ① gold<price → `not_enough_gold` ② `currentHp(combat, now) === COMBAT_MAX_HP` → `already_full` ③ 수락: gold−=price, hp=COMBAT_MAX_HP, lastHitAt=now. talkService: 화자가 inns 에 있으면 `TalkOutcome.inn = speakerId`(상점 `shop` 필드와 같은 자리·같은 시점). 클라: `pendingInn` → 대사 종료 후 InnPanel 자동 오픈(pendingShop 쌍둥이), 버튼은 `쉬어간다 (1,500G)` — 만혈이면 안 그린다. describeError 에 `already_full`("이미 성한 몸이다")·`not_enough_gold` 기존 문구 재사용 확인.
**Tests:** 파서 거절(없는 화자·gold<1·중복 화자), performRest 세 갈래+거절 무변경, talk 응답에 inn 실림, gameStore pendingInn 흐름, innPricing 부등식(구운 값 1,500 ≤ 실측 천장). 돌연변이: already_full 검사 제거 → red(만혈 결제), 파서 검증 제거 → red.
**주의:** 여관안주인은 ice 달인(masters.csv)이기도 하다 — 달인 보상 대화와 inn 필드가 공존하는 테스트 하나.

### Task D3: 예고 하한 ε+700 기계 강제

**Files:** `packages/data/src/monsterChecks.ts`(+test)
**Interfaces:** 검사 3 에 `telegraphMs < JUDGE_EPSILON_MS + 700` 위반 추가(TELEGRAPH_MIN_MS=700 유지). 문구는 상수 보간: 예고 실측·ε·안전 예고 잔량·파생 하한 전부 변수.
**Tests:** 실측된 연쇄(8/18, 6 describe)를 수용 — 기본 attack() 을 1,800ms·간격 2,200ms·주기 재배열로 바꾸고 **각 픽스처의 단언 산술을 새 숫자로 다시 셈해** 고친다(기존 단언의 의도를 보존 — 무엇을 물던 테스트인지 주석으로 확인하며). 새 하한 자체의 red/green 테스트. 돌연변이: 출하 wolf telegraphMs 1,000 → 빌드 정지 확인 후 원복.

### Task D4: 주장 좌표 상한

**Files:** `apps/server/src/services/fightService.ts`(+test), `apps/client/src/store/gameStore.ts`(describeError)
**Interfaces:** FightErrorCode 에 `out_of_bounds` 추가. wrong_map 검사 다음: `claim.x >= map.width || claim.y >= map.height` (맵은 `data.maps[player.location.mapId]` — 없으면 기존 흐름 유지) → 거절. describeError: `out_of_bounds` → "그런 곳은 없다".
**Tests:** (10⁹,10⁹) 거절 + lastClaim 무기록(거절 무변경), 경계값(width−1 수락, width 거절). 돌연변이: 검사 제거 → red.

### Task D5: 닫음 (컨트롤러 직접)

브라우저(812×375): 강화 +3 검 1스윙 처치·가방 피해 숫자·여관 결제(골드 차감·만혈 버튼 부재·경합 문구)·죽음→여관 동선. 전체 브랜치 리뷰(61a1f8d..HEAD) → 수정파 → 푸시 → 미니PC health.sha.

## 실행 방식

D1→D2→D3→D4 순차(공유 파일: gameStore 를 D2·D4 가 만짐), 각 태스크 구현+적대 리뷰. 워크플로 하나로 태운다.
