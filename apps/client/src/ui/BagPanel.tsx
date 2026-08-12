import {
  effectiveIntervalFactor,
  ENHANCE_CAP,
  hammerChanceBonus,
  SKILL_IDS,
  SKILL_LABELS,
  type ItemDef,
  type ItemInstance,
  type SkillId,
} from '@nogada/shared'
import { useGameStore } from '../store/gameStore.js'
import { ItemIcon } from './ItemIcon.js'
import { formatGold } from './shopModel.js'

/**
 * 도구 하나가 화면에 말할 속도 축 한 줄(§6-앞 13) — 채집 기술은 간격 절감률,
 * 조합(망치)은 성공률 보너스다(간격은 채집 도구만의 축이므로, §3). 둘 다
 * shared 의 공식(effectiveIntervalFactor·hammerChanceBonus)을 그대로 옮겨
 * 적을 뿐이라 서버 판정·다른 화면(craftCardModel, 숙련도 탭)과 다른 숫자가
 * 뜰 수 없다. def 는 호출자가 "착용/예비 도구가 실제로 있다"를 확인한 뒤에만
 * 넘긴다 — 빈 슬롯에는 말할 속도가 없다.
 */
function toolSpeedLabel(skill: SkillId, def: ItemDef, enhanceLevel: number): string {
  if (skill === 'crafting') {
    const bonusPct = hammerChanceBonus(def.toolTier ?? 0, enhanceLevel) * 100
    return `성공률 +${bonusPct.toFixed(1)}%p`
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
 * 예비 칩은 `착용` 버튼을 상시, `강화` 버튼을 같은 itemId 를 착용 중이고 그
 * 착용분이 아직 상한(+5) 아래일 때만 얻는다(비활성 노출은 여전히 금지 —
 * 조건을 못 채우면 버튼 자체를 그리지 않는다. 만강 도구 곁의 `강화` 는 눌러도
 * enhance_cap 만 돌아오는 죽은 버튼이다). **장비 슬롯과 재료 리스트는 여전히
 * 버튼이 아니다** — 슬롯은 착용 결과를 비추는 자리이지 조작하는 자리가
 * 아니고(조작은 예비 칩에서 온다), 재료는 애초에 눌러서 될 일이 없다.
 */
export function BagPanel(): JSX.Element | null {
  const open = useGameStore((s) => s.openPanel === 'bag')
  const player = useGameStore((s) => s.player)
  const data = useGameStore((s) => s.data)

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

  // 강화 버튼의 노출 조건을 itemId 집합으로 미리 계산한다(§6-앞 12) — 대상이
  // 없거나(no_target) 상한에 닿은(enhance_cap) 강화는 서버가 거절하니, 그 두
  // 조건을 화면이 먼저 걸러야 "눌러도 매번 거절만 돌아오는" 죽은 버튼이 생기지
  // 않는다. 상한을 보는 곳이 예비 칩 자신이 아니라 **착용 중인 대상**인 이유는
  // 강화의 규칙이 그렇기 때문이다(equipService: 재료는 예비, +1 은 착용분에
  // 붙고 ENHANCE_CAP 도 그 착용분에 걸린다).
  const enhanceableItemIds = new Set(
    Object.values(player.equipped)
      .map((instanceId) => player.instances.find((inst) => inst.instanceId === instanceId))
      .filter((inst): inst is ItemInstance => inst !== undefined && inst.enhanceLevel < ENHANCE_CAP)
      .map((inst) => inst.itemId),
  )

  // 재료는 items.csv 선언 순서(= data.items 의 키 순서)로 고정한다 — 제작
  // 패널의 행이 흔들리면 안 되는 것과 같은 이유. 수량 0(스택에 키가 아예
  // 없는 경우 포함)은 제외한다.
  const materials: { id: string; name: string; qty: number }[] = []
  for (const id of Object.keys(data.items)) {
    const def = data.items[id]
    if (def?.kind !== 'material') continue
    const qty = player.stacks[id] ?? 0
    if (qty <= 0) continue
    materials.push({ id, name: def.name, qty })
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
                  const canEnhance = enhanceableItemIds.has(inst.itemId)
                  const speedLabel =
                    def !== undefined && def.toolSkill !== undefined
                      ? toolSpeedLabel(def.toolSkill, def, inst.enhanceLevel)
                      : null
                  return (
                    <li key={inst.instanceId} className="bag__spare">
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
                        {/* 착용은 상시 — 예비는 정의상 미착용이니 대상이 늘 유효하다(§4). */}
                        <button
                          type="button"
                          className="bag__spare-btn"
                          onClick={() => void useGameStore.getState().equip(inst.instanceId)}
                        >
                          착용
                        </button>
                        {/* 강화는 같은 itemId 를 착용 중이고 그 착용분이 만강이 아닐 때만
                            그린다 — 비활성 노출 금지(설계 §8-앞 13, §6-앞 12). */}
                        {canEnhance && (
                          <button
                            type="button"
                            className="bag__spare-btn bag__spare-btn--enhance"
                            onClick={() => void useGameStore.getState().enhance(inst.instanceId)}
                          >
                            강화
                          </button>
                        )}
                      </div>
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
            <ul className="bag__materials">
              {materials.map((m) => (
                <li key={m.id} className="bag__material">
                  <ItemIcon itemId={m.id} />
                  <span className="bag__material-name">{m.name}</span>
                  <span className="bag__material-qty">×{m.qty}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  )
}
