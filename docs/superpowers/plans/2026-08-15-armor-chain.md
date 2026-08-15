# 방어구 사슬 구현 계획 (아크 E)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.
> 스펙: `docs/superpowers/specs/2026-08-15-armor-chain-design.md` (평가 반영본).

**Goal:** 경감 식 하나 + 검이 증명한 기계의 재사용으로 방어구 사슬을 열고, 사냥 판로(씨앗 ⑧)를 닫는다.

**기준선:** 테스트 2,047 / 98 (커밋 4e87765 시점). 관문 = `pnpm data:build && pnpm test && pnpm typecheck`.

## Global Constraints

- 경감 부등호는 shared `armorDefenseOf` 한 벌 — 서버 판정(fightService)·자동 착용(isBetterTool)·가방 표시가 같이 부른다. **하한 1**: 피해 = `max(1, sweepDamage − 경감)`.
- 새 문은 기존 문의 술어를 상속한다: 상점 해금·진열 해금의 combat 분기는 `combat.proficiency` 를 읽는다(둘 다 — stockUnlock 도).
- 값은 데이터 소유(defense 5·드랍 0.35·해금 1,000·가죽 8장 전부 CSV). 거절 무저장·죽은 버튼 금지·세이브 마이그레이션 0.
- App.tsx 불가침. git add 파일 명시. 에셋 파일 커밋 금지(설치는 끝났다: `sprites/npc_hunter.png`(Male 17-1)·`icons/wolf_pelt.png`(icon673)·`icons/wolf_hide_armor.png`(icon677)).
- 돌연변이로 각 식·검사가 무는 것을 증명하고 원복.

---

### Task E1: 방어구 기계 — 슬롯·경감 식·화면

**Files:** `packages/shared/src/types.ts`(EquipSlot·EQUIP_SLOTS·ItemDef.defense), `packages/shared/src/combatState.ts`(+test — armorDefenseOf), `packages/data/src/parse.ts`(toEquipSlot 을 EQUIP_SLOTS 기반으로, armor↔defense 대칭 검증), `apps/server/src/services/fightService.ts`(+test — ④ 루프 경감), `apps/server/src/services/craftService.ts`(+test — isBetterTool armor 분기), `apps/client/src/ui/BagPanel.tsx`(슬롯 7칸·slotLabelOf 헬퍼·toolSpeedLabel armor 분기 `피해 −N`)
**Interfaces:** `armorDefenseOf(def, enhanceLevel) = (def.defense ?? 0) + enhanceLevel`. fightService ④: `tookDamage += Math.max(1, p.sweepDamage − armorDefenseOf(착용))` — 착용 조회는 `equippedToolInfo(player, 'armor', data.items)` 한 번(루프 밖). `slotLabelOf(slot: EquipSlot): string` 은 shared 에 두고 SKILL_LABELS + 전투/방어를 소유한다(BagPanel 삼항 은퇴 — 컴파일 브레이크 해소).
**Tests:** armorDefenseOf(+0=5·+5=10·defense 없음=강화만), fightService 경감(-15/-10)·하한 1(경감≥sweepDamage 픽스처)·맨몸 무영향·표적 무관 다중 구역에서 각 배치 개별 클램프, isBetterTool(+2 가죽옷 vs 신품 defense 6 유지 — 실효 비교), 파서(armor 에 defense 없음 거절·armor 아닌 defense 거절·toEquipSlot 이 armor 수락). **돌연변이**: 하한 1 제거 → 피해 0 재현 red, `+ enhanceLevel` 제거 → red, toEquipSlot 하드코딩 복귀 → 파서 테스트 red.

### Task E2: 사냥 판로 — combat 계열·사냥꾼·상점

**Files:** `packages/shared/src/types.ts`(ItemDef.skill·ShopDef.skill 을 `SkillId | 'combat'`), `packages/data/src/parse.ts`(SkillId∨combat 새 변환기), `packages/shared/src/shopAccess.ts`(+test — 해금 combat 분기 = combat.proficiency), `packages/shared/src/stockUnlock.ts`(+test — 같은 분기), `apps/client/src/ui/shopModel.ts`(unlockLabelOf 브레이크 해소 — slotLabelOf 또는 지역 분기)·`apps/client/src/ui/codexModel.ts`(인덱싱 가드)·`apps/client/src/ui/ShopPanel.tsx`(사기 탭 빈 상태 문구 — 팔기 탭과 대칭), `packages/data/csv/speakers.csv`(사냥꾼 — 눈의마을 동쪽 문 곁 걷는 칸, sprite `npc_hunter`)·`shops.csv`(`사냥상점,사냥꾼의 계산대,사냥꾼,combat,1000`)·화자 대사(기존 화자 문법 그대로 한두 줄), `apps/client/src/game/npcSprites.ts`(npc_hunter 행)
**Tests:** 해금 전 combat 상점 잠금(proficiency 999 → 잠김·1,000 → 열림 — undefined 비교 함정을 무는 돌연변이: 분기 제거 → "항상 열림" red), wolf_fang 매도 관통(tradeService — skill=combat 아이템을 사냥상점이 사고 얼음상점은 거절), 사기 탭 빈 상태(모델 수준). **주의**: items 의 skill=combat 기입은 E3 이 한다 — 여기서는 픽스처로 문다.
**CREDITS**(같은 커밋): 화자 스프라이트 대장에 사냥꾼 행(`npc_hunter` / `Male/Male 17-1` / 챙모자·수염·망토 — 플레이어·기존 여섯과 겹치지 않는 유일한 모자 노인) + 복원 NPCS heredoc 에 `npc_hunter:Male/Male 17-1`.

### Task E3: 데이터 — 가죽·가죽옷·드랍·분-자

**Files:** `packages/data/csv/items.csv`(wolf_pelt: 늑대 가죽·skill=combat·매도가 20·icon wolf_pelt / wolf_hide_armor: 늑대 가죽옷·toolSkill=armor·tier 1·defense 5·icon wolf_hide_armor / **wolf_fang 에 skill=combat 추가**)·`monster_drops.csv`(wolf,wolf_pelt,0.35)·`recipes.csv`(가죽옷 = wolf_pelt:8|copper_ingot:1, category 도구, requiredSkill 0), `packages/data/src/armorBootstrap.test.ts`(new), `assets/CREDITS.md`(아이콘 2행: wolf_pelt:673·wolf_hide_armor:677 + 머리글 개수 갱신 — itemIcons.test 가 검산한다)
**Tests:** 분-자 — 첫 가죽옷 증분(시작 숙련 = combatBootstrap 종료 숙련을 그 테스트의 모형에서 유도, 미강화 검 2스윙/처치) **2~6분** 대역, 수치는 전부 CSV·shared 유도. **돌연변이**: 드랍 0.35→0.05 → 대역 밖 red, 레시피 8→2 → 하한 밖 red. 매도가 20 이 sellPrice(매도 절반) 규칙과 어떻게 만나는지 확인해 주석.

### Task E4: 닫음 (컨트롤러 직접)

브라우저: 가죽옷 제작·자동 착용(가방 방어 칸 "피해 −5")·피격 -15 플로트·+5 주입 -10·사냥꾼 대화→상점 해금 전 잠금 문구→(숙련 주입) 매도 골드 증가·사기 탭 빈 상태 문구·여관 회귀 확인(사냥꾼과 분리됐으니 안주인 여관은 그대로). 전체 브랜치 리뷰 → 푸시 → health.sha.

## 실행 방식

E1→E2→E3 순차(types.ts·parse.ts 공유), 각 구현+적대 리뷰 — 워크플로 하나.
