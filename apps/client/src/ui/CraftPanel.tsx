import { Fragment } from 'react'
import { useGameStore } from '../store/gameStore.js'
import { buildCraftCards, type CraftCard } from './craftCardModel.js'
import { ItemIcon } from './ItemIcon.js'
import { useCraftHold } from './useCraftHold.js'

/**
 * 제작 전면 패널(DOM). TopBar 가 마운트한다 — App.tsx 가 불가침이라 게임 중
 * React 가 그릴 수 있는 자리가 상단 바뿐이라는 사정은 BagPanel.tsx 와 같다.
 *
 * 가방과 달리 **카드 전체가 버튼이다**(설계 §6) — 탭 1회 제작, 해금 후에는
 * 누르고 있으면 반복. 그 규칙은 전부 useCraftHold 에 있고 여기는 그리기만
 * 한다. 잠긴 카드도 그대로 보인다 — 원작의 "요구치를 숫자로 말하는 문"
 * 장치를 카드 흐림 + 풀 콘트라스트 요구치 숫자로 잇는다(§8-앞 11).
 *
 * **점멸이 없다**(§8-앞 3·4): 결과가 초당 여러 번 오는 화면에서 성공!/실패
 * 점멸은 상시 플리커다. 피드백은 2행 끝의 누적 카운터(+N · 실패 M)와 1행의
 * 보유 N 이 올라가는 것 — 그게 전부이고, 그거면 된다.
 *
 * **키보드 리스너를 두지 않는다** — I/C/ESC 는 전부 InputHub →
 * PanelScene.applyInput 이 라우팅한다(설계 §8-앞 7). 이 컴포넌트는 openPanel
 * 을 구독해 그리고, ✕ 로 스토어 액션을 부르는 것이 전부다.
 */

const fmt = (n: number): string => n.toLocaleString('ko-KR')

/**
 * 1행 우측의 고정 상태 슬롯 — 성공률 / 재료 부족 / 요구치 중 하나만 말한다.
 * 결과에 따라 깜빡이는 자리가 아니라, 카드 상태가 바뀔 때만 내용이 바뀐다.
 */
function StatusSlot({ card }: { card: CraftCard }): JSX.Element {
  if (card.state === 'locked') {
    return (
      <span className="craft__status">
        {card.skillLabel} 숙련도{' '}
        {/* 요구치 숫자는 흐림 밖이다 — 카드에서 가장 밝은 것(§8-앞 11). */}
        <span className="craft__req">
          {fmt(card.proficiency)}/{fmt(card.requiredSkill)}
        </span>
      </span>
    )
  }
  if (card.state === 'no_materials') {
    return <span className="craft__status craft__status--missing">재료 부족</span>
  }
  return (
    <span className="craft__status">
      성공 <span className="craft__chance">{card.chancePct}%</span>
    </span>
  )
}

function CardRow({ card }: { card: CraftCard }): JSX.Element {
  // 잠긴/재료 부족 카드는 pointerdown 자체를 무시한다 — 서버로 아무것도
  // 보내지 않는다(옛 tryCraft 게이트, useCraftHold 문서 참고).
  const hold = useCraftHold(card.recipeId, card.state === 'ready')
  const modifier =
    card.state === 'locked'
      ? ' craft__card--locked'
      : card.state === 'ready'
        ? ' craft__card--ready'
        : ''

  // 누적 카운터는 누를 수 있는 카드에 항상 놓는다(0 이어도) — 반복을 쥔 채
  // 응시하는 자리라 숫자가 갑자기 나타나는 것보다 0 에서 오르는 편이 낫다.
  // 잠긴 카드는 이번 열림에 결과가 있을 수 없으므로 자리 자체가 없다.
  const showTally = card.state !== 'locked'

  return (
    <li className={`craft__card${modifier}`} {...hold}>
      <div className="craft__row1">
        <ItemIcon itemId={card.icon} />
        <span className="craft__name">{card.name}</span>
        <span className="craft__owned">
          보유 <span className="craft__owned-num">{fmt(card.ownedOutput)}</span>
        </span>
        <StatusSlot card={card} />
      </div>
      <div className="craft__row2">
        <span className="craft__mats">
          {card.materials.map((m) => (
            <span
              key={m.name}
              className={`craft__mat ${m.ok ? 'craft__mat--ok' : 'craft__mat--missing'}`}
            >
              {m.name}{' '}
              <span className="craft__mat-num">
                {fmt(m.have)}/{fmt(m.need)}
              </span>
            </span>
          ))}
        </span>
        {showTally && (
          <span className="craft__tally">
            <span className="craft__tally-good">+{fmt(card.tally.success)}</span>
            {' · 실패 '}
            {fmt(card.tally.fail)}
          </span>
        )}
      </div>
    </li>
  )
}

export function CraftPanel(): JSX.Element | null {
  const open = useGameStore((s) => s.openPanel === 'craft')
  const player = useGameStore((s) => s.player)
  const data = useGameStore((s) => s.data)
  const tally = useGameStore((s) => s.craftTally)

  if (!open || player === null) return null

  const sections = buildCraftCards(data, player, tally)

  return (
    <div className="panel">
      <section className="panel__card">
        <header className="panel__header">
          <h2 className="panel__title">제작</h2>
          {/* 닫기는 ✕ 하나다 — 스크림 탭 닫기를 두지 않는 이유는 ui.css 의 .panel 주석 참고. */}
          <button
            type="button"
            className="panel__close"
            aria-label="닫기"
            onClick={() => useGameStore.getState().setOpenPanel(null)}
          >
            ✕
          </button>
        </header>
        <div className="craft__body">
          {sections.map((section) => (
            <Fragment key={section.category}>
              <h3 className="craft__section">{section.category}</h3>
              <ul className="craft__cards">
                {section.cards.map((card) => (
                  <CardRow key={card.recipeId} card={card} />
                ))}
              </ul>
            </Fragment>
          ))}
        </div>
      </section>
    </div>
  )
}
