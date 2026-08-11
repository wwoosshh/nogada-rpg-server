import { useGameStore } from '../store/gameStore.js'
import { ItemIcon } from './ItemIcon.js'

/**
 * 가방 전면 패널(DOM). TopBar 가 마운트한다 — App.tsx 가 불가침이라 게임 중
 * React 가 그릴 수 있는 자리가 상단 바뿐이라는 사정은 TopBar.tsx 상단 주석과
 * DeleteCharacterDialog 의 것과 같다.
 *
 * **v1 은 보기 전용이다** — 도구를 탭해도 아무 일도 일어나지 않는다. 서버에
 * 수동 착용 API 가 없어서다(설계 §5). 그래서 행은 `<li>` 이지 `<button>` 이
 * 아니다: 누르면 반응할 것처럼 보이는 어포던스(hover·active·테두리 강조)를
 * 일부러 주지 않는다 — 죽은 버튼으로 읽히면 사용자가 눌러보고 실망한다
 * (설계 §8-앞 13).
 *
 * **전체-빈 상태가 없다**: 신규 캐릭터도 시작 도구 4종을 들고 시작하므로
 * 도구 섹션이 비는 경우는 도달 불가능하다(설계 §8-앞 13) — 재료 섹션에만
 * 전용 빈 문구를 둔다.
 */
export function BagPanel(): JSX.Element | null {
  const open = useGameStore((s) => s.openPanel === 'bag')
  const player = useGameStore((s) => s.player)
  const data = useGameStore((s) => s.data)

  if (!open || player === null) return null

  // 재료는 items.csv 선언 순서(= data.items 의 키 순서)로 고정한다 — 제작
  // 패널의 행이 흔들리면 안 되는 것과 같은 이유로, 가방도 훑어보는 자리가
  // 매번 바뀌면 안 된다. 수량 0(스택에 키가 아예 없는 경우 포함)은 제외한다.
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
          <h3 className="bag__section">도구</h3>
          <ul className="bag__tools">
            {player.instances.map((inst) => {
              const def = data.items[inst.itemId]
              const skill = def?.toolSkill
              // 착용 여부는 이 도구의 기술(toolSkill)에 대해 equipped 가
              // 가리키는 instanceId 가 바로 이 인스턴스인지로 판정한다 — 다른
              // 기술 슬롯에 우연히 같은 instanceId 문자열이 있을 수는 없지만
              // (id 는 전역 유일), skill 이 없는 아이템(현재는 없음)은 애초에
              // 착용 대상이 아니므로 undefined 로 걸러진다.
              const equipped = skill !== undefined && player.equipped[skill] === inst.instanceId
              return (
                <li key={inst.instanceId} className="bag__tool">
                  <ItemIcon itemId={inst.itemId} />
                  <span className="bag__tool-name">{def?.name ?? inst.itemId}</span>
                  {inst.enhanceLevel > 0 && (
                    <span className="bag__enhance">+{inst.enhanceLevel}</span>
                  )}
                  {equipped && (
                    <span className="bag__badge">
                      <span className="bag__badge-dot" />
                      착용
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
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
