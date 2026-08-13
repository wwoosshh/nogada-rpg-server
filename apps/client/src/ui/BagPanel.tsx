import {
  effectiveIntervalFactor,
  ENHANCE_INTERVAL_FACTOR,
  hammerChanceBonus,
  SKILL_IDS,
  SKILL_LABELS,
  type CollectionThresholds,
  type ItemDef,
  type ItemInstance,
  type SkillId,
} from '@nogada/shared'
import { useState } from 'react'
import { useGameStore } from '../store/gameStore.js'
import {
  donateToThresholdCount,
  isCollectionSlot,
  maxDonateCount,
  nextThresholdOf,
} from './codexModel.js'
import { enhanceRequirementFor, type EnhanceRequirement } from './enhanceCostModel.js'
import { ItemIcon } from './ItemIcon.js'
import { QuantityPicker } from './QuantityPicker.js'
import { clampCount, formatGold } from './shopModel.js'

/**
 * 도구 하나가 화면에 말할 효과 한 줄(§6-앞 13) — shared 의 공식
 * (effectiveIntervalFactor·hammerChanceBonus·ENHANCE_INTERVAL_FACTOR)을 그대로
 * 옮겨 적을 뿐이라 서버 판정·다른 화면(craftCardModel, 숙련도 탭)과 다른 숫자가
 * 뜰 수 없다. def 는 호출자가 "착용/예비 도구가 실제로 있다"를 확인한 뒤에만
 * 넘긴다 — 빈 슬롯에는 말할 것이 없다.
 *
 * **채집 도구와 망치는 축이 다르되, 망치도 간격을 산다.** "간격은 채집 도구만의
 * 축"이라던 이 자리의 옛 문장은 제작 확장 §6-앞 14 가 망치 강화에 제작 간격
 * 절감을 붙이면서 거짓이 됐다. 지금 참인 것은 **무엇이 무엇을 사는가**이고,
 * 망치는 둘로 갈린다:
 *   - 성공률은 **티어**가 산다(승급 한 칸 +2.0%p) — 강화도 조금 얹는다(+0.3%p/단).
 *   - 제작 간격은 **강화만** 산다(×0.97^n). 티어는 여기에 한 푼도 안 낸다
 *     (craftIntervalMs 가 effectiveIntervalFactor 를 부르지 않는 이유).
 * 그래서 조합 슬롯은 두 숫자를 나란히 적는다. 하나만 적으면 네 계열을 다 먹는
 * 망치 강화가 무엇을 사 주는지 화면 어디에도 안 남는다 — 그 사다리를 아무도
 * 안 타던 이유가 바로 그것이었다.
 */
function toolSpeedLabel(skill: SkillId, def: ItemDef, enhanceLevel: number): string {
  if (skill === 'crafting') {
    const bonusPct = hammerChanceBonus(def.toolTier ?? 0, enhanceLevel) * 100
    // 강화 배수만 곱한다 — craftIntervalMs 와 같은 셈이라야 이 줄이 참이다.
    const cutPct = Math.round((1 - ENHANCE_INTERVAL_FACTOR ** enhanceLevel) * 100)
    const interval = cutPct > 0 ? `간격 −${cutPct}%` : '간격 변화 없음'
    return `성공률 +${bonusPct.toFixed(1)}%p · ${interval}`
  }
  const cutPct = Math.round((1 - effectiveIntervalFactor(def, enhanceLevel)) * 100)
  // 신품 구리(1티어, 미강화)는 배수가 정확히 1.0 이라 절감이 0 이다 — "−0%"
  // 대신 말로 적어 부호 오독을 막는다.
  return cutPct > 0 ? `간격 −${cutPct}%` : '간격 변화 없음'
}

/**
 * 가방 전면 패널(DOM). TopBar 가 마운트한다 — App.tsx 가 불가침이라 게임 중
 * React 가 그릴 수 있는 자리가 상단 바뿐이라는 사정은 TopBar.tsx 상단 주석과
 * DeleteCharacterDialog 의 것과 같다.
 *
 * **장비는 슬롯 격자다** — 도구를 행 리스트로 찍었던 첫 구현은 "장비는
 * 장비처럼 보여야 한다"는 사용자 지시로 기각됐다(설계 §8-뒤). 기술별 슬롯
 * 5칸이 "무엇을 차고 있는가"를 칸으로 말하고, 착용 안 된 도구는 슬롯 아래
 * 예비 줄로 물러난다. 재료는 리스트 유지 — 이건 사용자가 승인한 문법이다.
 *
 * **예비 도구 칩만 버튼이다** — v1 이 이 파일에 적어 두었던 "보기 전용" 전제는
 * 서버에 수동 착용 API 가 없던 시절의 것이었다(설계 §5 훅). 도구 루프 설계가
 * 그 API 를 만들면서 §6-앞 12 가 이 전제를 **예비 칩 한 곳에 한해** 의식적으로
 * 기각한다 — 죽은 버튼 금지 규범(설계 §8-앞 13)은 "될 수 없는 조작을 버튼으로
 * 보여주지 말라"는 것이지 "될 수 있는 조작을 숨기라"는 뜻이 아니었다. 그래서
 * 예비 칩은 `착용` 버튼을 상시, `강화` 버튼을 **그 강화를 지금 감당할 수 있을
 * 때만** 얻는다(비활성 노출은 여전히 금지 — 조건을 못 채우면 버튼 자체를 그리지
 * 않는다).
 *
 * **요구 readout 은 버튼과 다른 규칙으로 산다**(§6-앞 11·13). 강화가 원작 UL4 로
 * 돌아가면서 예비 도구 말고도 원재료와 골드를 먹게 됐는데, 그것을 화면이 안
 * 적으면 플레이어는 무엇을 얼마나 모아야 하는지 눌러 보고 거절받으며 알아내야
 * 한다. 그래서 요구 줄은 **대상이 있고 만강이 아니면 늘** 그린다 — 못 채운
 * 재료는 danger 색으로 자기가 모자라다고 말한다. 죽은 버튼 금지 규범이 막는
 * 것은 "눌러도 거절만 돌아오는 조작"이지 "요구치를 숫자로 말하는 문"이
 * 아니다(원작이 쓰던 그 장치가 여기서도 같은 일을 한다). 그 위에서 버튼만
 * `affordable` 로 다시 걸러진다: 요구를 다 적어 놓고도 못 채운 사람에게 버튼을
 * 내밀면 그건 규범이 금지한 바로 그 버튼이다.
 *
 * **재료 줄에도 버튼이 생겼다 — 단, 쓸 수 있는 재료에만**(설계 §6-앞 1~4).
 * "재료는 애초에 눌러서 될 일이 없다"는 v1 의 전제는 서버에 사용 API 가 없던
 * 시절의 것이었다. 날씨 가루가 그 전제를 깬다: 그것은 가지고 있는 것이 아니라
 * **쓰는 것**이고, 쓸 곳이 없으면 만들 이유도 없다. 자격은 `useEffect` 칸
 * 하나이고 없는 재료에는 버튼을 그리지 않는다 — 예비 칩의 `강화` 와 정확히
 * 같은 규칙이다(비활성 노출 금지). **장비 슬롯은 여전히 버튼이 아니다** —
 * 슬롯은 착용 결과를 비추는 자리이지 조작하는 자리가 아니다(조작은 예비 칩).
 *
 * **재료의 세 번째 용도가 여기서 열린다 — `[바치기]`**(수집의 방 설계 §5·§6-앞 1).
 * 팔기는 상점에서, 만들기는 제작 패널에서, 바치기는 여기다: 방은 결과를 보는
 * 곳이고 물건은 가방에 있다. 자격은 `isCollectionSlot` 한 줄(서버 performDonate 가
 * 보는 그 표)이라 주괴·증표·가루에는 버튼이 아예 안 붙는다 — [사용] 이 useEffect
 * 칸 하나로 자격을 정하는 것과 같은 규칙이고, 같은 죽은 버튼 금지다.
 */
export function BagPanel(): JSX.Element | null {
  const open = useGameStore((s) => s.openPanel === 'bag')
  const player = useGameStore((s) => s.player)
  const data = useGameStore((s) => s.data)
  // 왕복이 도는 동안 이 패널의 버튼 셋을 전부 잠근다 — 상점의 [팔기]·[사기]가
  // tradeBusy 로 하는 그 일이고 같은 이유다(gameStore 의 bagBusy 문서). 셋이
  // 한 신호를 나눠 쓰는 것은 셋이 같은 왕복이기 때문이다: 강화가 도는 동안
  // 가루를 쓰면 그 응답 둘이 서로의 player 를 덮어쓴다.
  const busy = useGameStore((s) => s.bagBusy)

  if (!open || player === null) return null

  // 슬롯은 SKILL_IDS 선언 순서로 5칸 고정 — 빈 칸도 자리를 지킨다. "조합
  // 도구가 아직 없다"는 사실은 점선 빈 슬롯이 말하는 정보지 숨길 결격이
  // 아니다(원작의 "잠긴 것까지 보이는 목록방"과 같은 태도).
  const slotOf = (skill: SkillId): ItemInstance | undefined => {
    const instanceId = player.equipped[skill]
    if (instanceId === undefined) return undefined
    return player.instances.find((inst) => inst.instanceId === instanceId)
  }

  // 예비 도구 = 어느 기술 슬롯에도 착용되지 않은 인스턴스. instances 배열
  // 순서(획득 순) 그대로 — 훑어보는 자리가 매번 바뀌면 안 된다.
  const equippedIds = new Set(Object.values(player.equipped))
  const spares = player.instances.filter((inst) => !equippedIds.has(inst.instanceId))

  // 재료는 items.csv 선언 순서(= data.items 의 키 순서)로 고정한다 — 제작
  // 패널의 행이 흔들리면 안 되는 것과 같은 이유. 수량 0(스택에 키가 아예
  // 없는 경우 포함)은 제외한다.
  //
  // `usable` 은 그 줄이 [사용] 버튼을 얻는가다. 자격은 `useEffect` 칸 하나뿐이고
  // (서버 performUse 가 보는 것과 같은 칸), 없는 재료에는 버튼을 아예 그리지
  // 않는다 — 눌러도 not_usable 만 돌아오는 죽은 버튼 금지(설계 §8-앞 13).
  const materials: Material[] = []
  for (const id of Object.keys(data.items)) {
    const def = data.items[id]
    if (def?.kind !== 'material') continue
    const qty = player.stacks[id] ?? 0
    if (qty <= 0) continue
    // 방의 칸인가 — [바치기] 의 유일한 자격이고, 서버가 not_collectable 을
    // 가르는 그 검사와 같은 검사다(codexModel 의 isCollectionSlot). 문턱을 꺼내기
    // **전에** 이 검사를 통과시키는 이유도 그 함수와 같다: `data.collection[id]` 를
    // 맨손으로 읽으면 `constructor` 같은 상속 키가 정의 행세를 한다.
    const thresholds = isCollectionSlot(data, id) ? data.collection[id] : undefined
    materials.push({
      id,
      name: def.name,
      qty,
      usable: def.useEffect !== undefined,
      slot:
        thresholds === undefined
          ? null
          : { donated: player.donated[id] ?? 0, thresholds },
    })
  }

  return (
    <div className="panel">
      <section className="panel__card">
        <header className="panel__header">
          <h2 className="panel__title">가방</h2>
          <button
            type="button"
            className="panel__close"
            aria-label="닫기"
            onClick={() => useGameStore.getState().setOpenPanel(null)}
          >
            ✕
          </button>
        </header>
        <BagError />
        <div className="bag__body">
          {/* 소지금 — 가방은 "내가 가진 것"의 화면이고, 골드도 가진 것이다.
              상점 밖에서 다음 증표까지의 거리를 재는 자리가 여기다(설계 §2). */}
          <p className="bag__gold">
            소지금 <span className="bag__gold-num">{formatGold(player.gold)}</span>
          </p>
          <h3 className="bag__section">장비</h3>
          <ul className="bag__slots">
            {SKILL_IDS.map((skill) => {
              const inst = slotOf(skill)
              const def = inst !== undefined ? data.items[inst.itemId] : undefined
              return (
                <li
                  key={skill}
                  className={inst === undefined ? 'bag__slot bag__slot--empty' : 'bag__slot'}
                >
                  <div className="bag__slot-box">
                    {inst !== undefined && <ItemIcon itemId={inst.itemId} />}
                    {inst !== undefined && inst.enhanceLevel > 0 && (
                      <span className="bag__slot-enhance">+{inst.enhanceLevel}</span>
                    )}
                  </div>
                  <span className="bag__slot-label">{SKILL_LABELS[skill]}</span>
                  {inst !== undefined && def !== undefined && (
                    <span className="bag__slot-speed">
                      {toolSpeedLabel(skill, def, inst.enhanceLevel)}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
          {spares.length > 0 && (
            <>
              <h3 className="bag__section">예비 도구</h3>
              <ul className="bag__spares">
                {spares.map((inst) => {
                  const def = data.items[inst.itemId]
                  // 요구는 예비 칩이 아니라 **그 itemId 의 착용분**이 정한다 —
                  // +1 이 붙는 곳이 착용분이므로 다음 단계도 그쪽 수치의 다음이다.
                  const req = enhanceRequirementFor(data, player, inst.itemId)
                  const speedLabel =
                    def !== undefined && def.toolSkill !== undefined
                      ? toolSpeedLabel(def.toolSkill, def, inst.enhanceLevel)
                      : null
                  return (
                    <li key={inst.instanceId} className="bag__spare">
                      <div className="bag__spare-top">
                        <div className="bag__spare-info">
                          <ItemIcon itemId={inst.itemId} />
                          <div className="bag__spare-text">
                            <span className="bag__spare-name-row">
                              <span className="bag__spare-name">{def?.name ?? inst.itemId}</span>
                              {inst.enhanceLevel > 0 && (
                                <span className="bag__enhance">+{inst.enhanceLevel}</span>
                              )}
                            </span>
                            {speedLabel !== null && (
                              <span className="bag__spare-speed">{speedLabel}</span>
                            )}
                          </div>
                        </div>
                        <div className="bag__spare-actions">
                          {/* 착용은 상시 — 예비는 정의상 미착용이니 대상이 늘 유효하다(§4).
                              "상시"는 조건 이야기이고, 왕복 잠금은 그것과 다른 축이다. */}
                          <button
                            type="button"
                            className="bag__spare-btn"
                            disabled={busy}
                            onClick={() => void useGameStore.getState().equip(inst.instanceId)}
                          >
                            착용
                          </button>
                          {/* 요구를 다 채웠을 때만 그린다 — 재료·골드가 모자란 채로
                              누르면 서버는 missing_enhance_materials·not_enough_gold
                              만 돌려준다(죽은 버튼 금지, 설계 §8-앞 13). 무엇이
                              모자란지는 아래 요구 줄이 말한다. */}
                          {req?.affordable === true && (
                            <button
                              type="button"
                              className="bag__spare-btn bag__spare-btn--enhance"
                              disabled={busy}
                              onClick={() => void useGameStore.getState().enhance(inst.instanceId)}
                            >
                              강화
                            </button>
                          )}
                        </div>
                      </div>
                      {req !== null && <EnhanceRequirementRow req={req} />}
                    </li>
                  )
                })}
              </ul>
            </>
          )}
          <h3 className="bag__section">재료</h3>
          {materials.length === 0 ? (
            <p className="bag__empty">아직 모은 재료가 없다.</p>
          ) : (
            <MaterialList materials={materials} busy={busy} />
          )}
        </div>
      </section>
    </div>
  )
}

/** 재료 줄 하나가 아는 것 — 무엇을 몇 개 가졌고, 그것으로 무엇을 할 수 있는가. */
interface Material {
  id: string
  name: string
  qty: number
  /** 쓸 수 있는가(`useEffect` 칸) — [사용] 의 자격. */
  usable: boolean
  /**
   * 방의 칸이면 그 칸의 형편, 아니면 null — **[바치기] 의 자격이자 확인 줄의 재료**다.
   *
   * 자격을 boolean 하나로 따로 들지 않는 이유: 그러면 "바칠 수 있다"와 "문턱이
   * 얼마다"가 서로를 모르는 두 값이 되어, 한쪽만 채워진 줄이 언젠가 생긴다.
   */
  slot: { donated: number; thresholds: CollectionThresholds } | null
}

/**
 * 재료 목록 — 줄마다 [사용]·[바치기] 가 붙고, 헌납 확인은 그 줄 아래에서 펼쳐진다.
 *
 * **본체에서 떼어낸 이유는 "지금 어느 줄이 확인 중인가"라는 상태 하나 때문이다.**
 * 그 상태를 BagPanel 이 들면 패널이 닫혀도(컴포넌트가 null 을 돌려줄 뿐 언마운트
 * 되지 않는다) 살아남아, 다시 열었을 때 아무도 누르지 않은 확인 줄이 펼쳐진 채로
 * 보인다. 여기 있으면 패널이 닫히는 순간 이 컴포넌트가 통째로 언마운트되며 함께
 * 버려진다 — 상점의 탭·선택·수량이 ShopView 에 사는 것과 같은 수법이다.
 *
 * 한 번에 한 줄만 펼친다(문자열 하나). 여러 줄을 동시에 열어 두면 "지금 무엇을
 * 태우려는 중인가"가 흐려지는데, 그것은 되돌릴 수 없는 행위에서 가장 나쁜 흐림이다.
 */
function MaterialList({ materials, busy }: { materials: Material[]; busy: boolean }): JSX.Element {
  const [donating, setDonating] = useState<string | null>(null)

  return (
    <ul className="bag__materials">
      {materials.map((m) => (
        <li key={m.id} className="bag__material-item">
          <div className="bag__material">
            <ItemIcon itemId={m.id} />
            <span className="bag__material-name">{m.name}</span>
            <span className="bag__material-qty">×{m.qty}</span>
            {/* 쓸 수 있는 재료에만 붙는다 — 날씨 가루 4종이 지금 유일한
                소지자다. 누른 뒤에도 패널은 열려 있고, 줄어든 개수가 이
                줄에서 그대로 갱신된다(스토어가 돌아온 player 를 갈아 끼운다).
                그 갱신이 오기 전까지는 화면이 눌린 티를 아예 안 내므로,
                잠그지 않으면 두 번 누른 사람이 가루 둘을 태운다. */}
            {m.usable && (
              <button
                type="button"
                className="bag__material-btn"
                disabled={busy}
                onClick={() => void useGameStore.getState().use(m.id)}
              >
                사용
              </button>
            )}
            {/* 방의 칸인 재료에만 붙는다 — 주괴·증표·가루는 여기 없다.
                **이 버튼은 바치지 않는다. 확인 줄을 펼칠 뿐이다**(아래 문서). */}
            {m.slot !== null && (
              <button
                type="button"
                className="bag__material-btn bag__material-btn--donate"
                aria-expanded={donating === m.id}
                onClick={() => setDonating(donating === m.id ? null : m.id)}
              >
                바치기
              </button>
            )}
          </div>
          {donating === m.id && m.slot !== null && (
            <DonateConfirm
              // 줄마다 새로 마운트한다 — 고른 수량은 그 줄의 것이다(상점 상세가
              // key 로 하는 그 일).
              key={m.id}
              material={m}
              slot={m.slot}
              busy={busy}
              onCancel={() => setDonating(null)}
              onDone={() => setDonating(null)}
            />
          )}
        </li>
      ))}
    </ul>
  )
}

/**
 * 헌납 확인 줄 — 그 재료 줄 바로 아래에서 펼쳐진다.
 *
 * **왜 확인이 있는가:** 바친 물건은 돌아오지 않는다(설계 §3). 이 저장소에서
 * 확인을 요구하는 다른 한 곳이 캐릭터 삭제인데, 그쪽은 이름을 타이핑하게 한다 —
 * 수십 시간이 오타 하나에 사라지는 무게라서다. 헌납은 그 무게가 아니다: 사라지는
 * 것은 다시 캘 수 있는 재료 N개이고, 그 대신 칸이 영구히 남는다. 그래서 확인은
 * **한 번**이되 가볍다.
 *
 * **왜 창이 아니라 줄인가:** 가방은 이미 전면 패널이다. 그 위에 확인 창을 또
 * 띄우면 창 위의 창이 되어 닫는 순서가 두 겹이 되고, 812×375 에서는 뒤의 목록이
 * 통째로 가려져 "무엇을 바치는 중인지"가 오히려 안 보인다. 대신 확인은 그 줄
 * 아래에서 펼쳐진다 — 위에 아이콘·이름·보유 개수가 그대로 남아 있어, 확인이
 * 가리키는 물건이 화면에서 한 번도 사라지지 않는다.
 *
 * 확정 버튼이 개수를 품는 것(`12개 바친다`)도 같은 이유다: 누르는 순간 무엇이
 * 얼마나 사라지는지를 버튼 자신이 말한다. 수량 고르개는 상점의 그것을 그대로
 * 쓴다(§6-앞 1) — 같은 조작이 두 화면에서 다른 모양이면 안 된다.
 */
function DonateConfirm({
  material,
  slot,
  busy,
  onCancel,
  onDone,
}: {
  material: Material
  slot: { donated: number; thresholds: CollectionThresholds }
  busy: boolean
  onCancel: () => void
  onDone: () => void
}): JSX.Element {
  const max = maxDonateCount(material.qty)
  const [pick, setPick] = useState(1)
  const count = clampCount(pick, max)
  const next = nextThresholdOf(slot.donated, slot.thresholds)
  const toThreshold = donateToThresholdCount(slot.donated, material.qty, slot.thresholds)

  const donate = async (): Promise<void> => {
    await useGameStore.getState().donate(material.id, count)
    // 거절이면 줄을 열어 둔다 — 왜 안 됐는지는 패널 위 한 줄(BagError)이 말하고,
    // 고른 수량이 살아 있어야 다시 시도할 수 있다. 성공했으면 접는다: 그 줄의
    // 보유 개수가 이미 줄어 있어 같은 수량이 더는 뜻이 없다.
    if (useGameStore.getState().bagError === null) onDone()
  }

  return (
    <div className="bag__donate">
      <p className="bag__donate-warn">바친 것은 돌아오지 않는다.</p>
      {/* 목표를 확인 줄 안에 적는다 — 이 숫자는 방(CodexPanel)에도 있지만, 방은
          다른 패널이라 여기서는 볼 수 없다. 되돌릴 수 없는 행위 앞에서 "얼마가
          필요한지"를 보려고 화면을 나갔다 와야 한다면, 그 확인은 확인이 아니다. */}
      <p className="bag__donate-goal">
        {next === null
          ? `지금까지 ${slot.donated.toLocaleString('ko-KR')}개 — 이미 가득 찼다.`
          : `지금까지 ${slot.donated.toLocaleString('ko-KR')}개 · 다음 등급까지 ${next.remaining.toLocaleString('ko-KR')}개`}
      </p>
      <QuantityPicker count={count} max={max} onChange={setPick} />
      {/* 고르개의 셋(−·+·전부)만으로는 문턱에 정확히 못 선다 — 그 사연은
          donateToThresholdCount 에 적혀 있다. 없을 때는 아예 안 그린다(죽은 버튼 금지). */}
      {toThreshold !== null && (
        <button
          type="button"
          className="bag__spare-btn bag__spare-btn--to-threshold"
          disabled={busy}
          onClick={() => setPick(toThreshold)}
        >
          문턱까지 {toThreshold.toLocaleString('ko-KR')}개
        </button>
      )}
      <div className="bag__donate-actions">
        <button type="button" className="bag__spare-btn" disabled={busy} onClick={onCancel}>
          그만두기
        </button>
        <button
          type="button"
          className="bag__spare-btn bag__spare-btn--donate"
          disabled={busy}
          onClick={() => void donate()}
        >
          {count.toLocaleString('ko-KR')}개 바친다
        </button>
      </div>
    </div>
  )
}

/**
 * 다음 강화가 요구하는 것 — 예비 도구 줄 아래의 한 줄.
 *
 * **이 줄이 강화 개편의 화면 쪽 전부다**(§6-앞 11·13). 예비 도구 하나만 먹던
 * 시절에는 화면이 적을 것이 없었다(재료가 곧 그 칩 자신이었다). 이제는 단계마다
 * 다른 계열의 원재료와 골드를 먹으므로, 무엇을 얼마나 모아야 하는지 화면이
 * 말하지 않으면 플레이어가 알아낼 방법은 눌러 보고 거절받는 것뿐이다.
 *
 * `have/need` 꼴과 모자람의 danger 색은 제작 패널의 재료 칩(.craft__mat)과 같다 —
 * 두 화면이 "가진 것 대 필요한 것"을 다른 글자로 적으면 플레이어는 같은 것을
 * 가리키는지 매번 다시 확인해야 한다.
 */
function EnhanceRequirementRow({ req }: { req: EnhanceRequirement }): JSX.Element {
  return (
    <div className="bag__enhance-req">
      <span className="bag__enhance-req-label">+{req.nextLevel} 요구</span>
      <ul className="bag__enhance-mats">
        {req.materials.map((m) => (
          <li
            key={m.item}
            className={`bag__enhance-mat ${m.ok ? 'bag__enhance-mat--ok' : 'bag__enhance-mat--missing'}`}
          >
            {/* 아이콘이 없는 것이 의도다 — 이 줄은 예비 도구 줄 **아래**에
                끼는 부속이라 375px 폭에서 칩 다섯이 나란해야 하고, 이름이
                이미 무엇인지 말한다(제작 패널의 재료 칩은 상세 화면 전체를
                쓰므로 아이콘을 놓을 자리가 있었다). */}
            <span className="bag__enhance-mat-name">{m.name}</span>
            <span className="bag__enhance-mat-num">
              {m.have}/{m.need}
            </span>
          </li>
        ))}
        {/* 골드도 요구의 하나다 — 재료와 같은 줄에 두어야 "이것도 든다"가
            한눈에 보인다(원작 UL4 는 둘을 함께 먹었다). */}
        <li
          className={`bag__enhance-mat ${req.goldOk ? 'bag__enhance-mat--ok' : 'bag__enhance-mat--missing'}`}
        >
          <span className="bag__enhance-mat-name">골드</span>
          <span className="bag__enhance-mat-num">
            {formatGold(req.goldHave)}/{formatGold(req.goldNeed)}
          </span>
        </li>
      </ul>
    </div>
  )
}

/**
 * 방금 누른 가방 버튼이 거절된 이유 — 헤더와 본문 사이의 한 줄.
 *
 * **이 자리가 이 컴포넌트의 존재 이유다**(상점의 TradeError 와 같은 사정).
 * 착용·강화·사용은 가방 패널이 화면을 덮은 상태에서만 일어나므로, 거절을 머리 위
 * 글자로 보내면 그 문구는 패널 뒤 캔버스에서 뜨고 사라져 아무도 못 본다 —
 * 마지막 한 개를 두 번 눌러 둘째가 거절돼도 화면에는 아무 일도 안 일어난 것처럼
 * 보인다. 스크롤되는 본문(.bag__body) 밖에 두는 이유는 하나 더 있다: 재료는
 * 목록 맨 아래라 그 옆에 두면 스크롤 위치에 따라 문구가 화면 밖에 있을 수 있다.
 *
 * `role="status"` 인 이유도 상점과 같다 — 초점을 빼앗지 않고(alert 가 아니다)
 * 스크린 리더에게 "방금 누른 것이 왜 아무 일도 안 했는가"를 전한다.
 */
function BagError(): JSX.Element | null {
  const text = useGameStore((s) => s.bagError)
  if (text === null) return null
  return (
    <p className="bag__error" role="status">
      {text}
    </p>
  )
}
