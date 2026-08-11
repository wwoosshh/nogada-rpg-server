import { SKILL_IDS, SKILL_LABELS, type ItemInstance, type SkillId } from '@nogada/shared'
import { useGameStore } from '../store/gameStore.js'
import { ItemIcon } from './ItemIcon.js'

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
 * **v1 은 보기 전용이다** — 슬롯도 예비 칩도 눌러서 되는 일이 없다. 서버에
 * 수동 착용 API 가 없어서다(설계 §5 훅). 그래서 어느 것도 `<button>` 이
 * 아니고, 눌림·hover 어포던스를 일부러 주지 않는다(설계 §8-앞 13) —
 * 죽은 버튼으로 읽히면 사용자가 눌러보고 실망한다.
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
          <h3 className="bag__section">장비</h3>
          <ul className="bag__slots">
            {SKILL_IDS.map((skill) => {
              const inst = slotOf(skill)
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
                </li>
              )
            })}
          </ul>
          {spares.length > 0 && (
            <>
              <h3 className="bag__section">예비 도구</h3>
              <ul className="bag__spares">
                {spares.map((inst) => (
                  <li key={inst.instanceId} className="bag__spare">
                    <ItemIcon itemId={inst.itemId} />
                    <span className="bag__spare-name">
                      {data.items[inst.itemId]?.name ?? inst.itemId}
                    </span>
                    {inst.enhanceLevel > 0 && (
                      <span className="bag__enhance">+{inst.enhanceLevel}</span>
                    )}
                  </li>
                ))}
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
