import { Fragment, useState } from 'react'
import { useGameStore } from '../store/gameStore.js'
import {
  buildCraftCards,
  defaultCraftSelection,
  type CraftCard,
  type CraftCardSection,
} from './craftCardModel.js'
import { ItemIcon } from './ItemIcon.js'
import { useCraftHold } from './useCraftHold.js'

/**
 * 제작 전면 패널(DOM) — 좌 목록 · 우 상세 · 제작 버튼(설계 §8-뒤).
 * TopBar 가 마운트한다 — App.tsx 가 불가침이라 게임 중 React 가 그릴 수 있는
 * 자리가 상단 바뿐이라는 사정은 BagPanel.tsx 와 같다.
 *
 * **선택과 실행이 분리돼 있다** — 행 전체가 버튼이던 첫 구현은 "리스트에
 * 행클릭 방식은 게임에서 쓰이는 방식이 아니다"라는 사용자 지시로 기각됐다.
 * 왼쪽 목록의 행 탭은 **선택만** 한다(절대 제작하지 않는다). 실행은 오른쪽
 * 상세 하단의 제작 버튼 하나 — 탭 1회, 해금 후엔 홀드 반복. 그 규칙은 전부
 * useCraftHold 에 있고 여기는 그리기만 한다.
 *
 * 잠긴 레시피도 목록·상세 양쪽에 그대로 보인다 — 원작의 "요구치를 숫자로
 * 말하는 문" 장치를 흐림 + 풀 콘트라스트 요구치 숫자로 잇는다(§8-앞 11).
 * 컴팩트한 목록 행에서도 요구치 숫자는 숨기지 않는다 — 그 숫자가 당근이다.
 *
 * **점멸이 없다**(§8-앞 3·4): 피드백은 버튼 곁 고정 슬롯의 누적 카운터
 * (+N · 실패 M)와 상세의 보유 N 이 올라가는 것 — 그게 전부이고, 그거면 된다.
 *
 * **키보드 리스너를 두지 않는다** — I/C/ESC 는 전부 InputHub →
 * PanelScene.applyInput 이 라우팅한다(설계 §8-앞 7). 이 컴포넌트는 openPanel
 * 을 구독해 그리고, ✕ 로 스토어 액션을 부르는 것이 전부다.
 */

const fmt = (n: number): string => n.toLocaleString('ko-KR')

/**
 * 목록 행 우측의 상태 표시 — 한눈에 훑는 자리라 기호 하나로 말한다:
 * ✓(제작 가능) / 점(재료 부족) / 요구치 숫자(잠김). 잠김만 숫자를 그대로
 * 두는 이유: 컴팩트한 행에서도 문이 요구치를 말해야 한다(원작 장치).
 */
function RowMark({ card }: { card: CraftCard }): JSX.Element {
  if (card.state === 'locked') {
    return (
      <span className="craft__row-req">
        {fmt(card.proficiency)}/{fmt(card.requiredSkill)}
      </span>
    )
  }
  if (card.state === 'no_materials') {
    return <span className="craft__row-dot" role="img" aria-label="재료 부족" />
  }
  return <span className="craft__row-ok">✓</span>
}

function RecipeRow({
  card,
  selected,
  onSelect,
}: {
  card: CraftCard
  selected: boolean
  onSelect: (recipeId: string) => void
}): JSX.Element {
  const modifier = `${selected ? ' craft__row--on' : ''}${
    card.state === 'locked' ? ' craft__row--locked' : ''
  }`
  return (
    <li>
      {/* 행 탭 = 선택만. 잠긴 행도 선택은 된다 — 상세에서 요구치를 크게
          보여주는 것이 목적이라 선택을 막을 이유가 없다. */}
      <button
        type="button"
        className={`craft__row${modifier}`}
        aria-pressed={selected}
        onClick={() => onSelect(card.recipeId)}
      >
        {/* 커서 글리프 — 선택이 hover 회색이 아니라 게임 커서로 읽히게 한다.
            자리를 항상 잡아 두어 선택이 옮겨도 텍스트가 밀리지 않는다. */}
        <span className="craft__cursor" aria-hidden="true">
          {selected ? '▶' : ''}
        </span>
        <ItemIcon itemId={card.icon} />
        <span className="craft__row-name">{card.name}</span>
        <RowMark card={card} />
      </button>
    </li>
  )
}

/** 오른쪽 상세 — 선택된 레시피 하나를 크게 편다. 실행 버튼이 여기 산다. */
function RecipeDetail({ card }: { card: CraftCard }): JSX.Element {
  const hold = useCraftHold(card.recipeId, card.state === 'ready')
  const locked = card.state === 'locked'

  return (
    <section className="craft__detail">
      <div className={`craft__info${locked ? ' craft__info--locked' : ''}`}>
        <div className="craft__head">
          <div className="craft__frame">
            <ItemIcon itemId={card.icon} size={64} />
          </div>
          <div className="craft__head-text">
            <h4 className="craft__detail-name">{card.name}</h4>
            {/* 반복 200회 동안 시선이 쉴 숫자(§8-앞 4) — 결과마다 올라간다. */}
            <span className="craft__owned">
              보유 <span className="craft__owned-num">{fmt(card.ownedOutput)}</span>
            </span>
          </div>
        </div>
        <ul className="craft__mats">
          {card.materials.map((m) => (
            <li
              key={m.item}
              className={`craft__mat ${m.ok ? 'craft__mat--ok' : 'craft__mat--missing'}`}
            >
              <ItemIcon itemId={m.item} />
              <span className="craft__mat-num">
                {fmt(m.have)}/{fmt(m.need)}
              </span>
            </li>
          ))}
        </ul>
        {/* 고정 상태 슬롯 — 성공률 또는 요구치 중 하나가 상주한다. 잠긴
            상세에서는 요구치 카운터가 가장 밝은 요소다(§8-앞 11): 흐림은
            위(craft__info--locked)의 아이콘·이름·재료까지만이다. */}
        {locked ? (
          <p className="craft__stat">
            {card.skillLabel} 숙련도{' '}
            <span className="craft__req">
              {fmt(card.proficiency)}/{fmt(card.requiredSkill)}
            </span>
          </p>
        ) : (
          <p className="craft__stat">
            성공 <span className="craft__chance">{card.chancePct}%</span>
          </p>
        )}
      </div>
      <div className="craft__actions">
        {/* 실행은 이 버튼 하나다. disabled 는 시각이자 기능이다 — 눌러도
            pointerdown 이 발생하지 않아 서버로 아무것도 가지 않는다(useCraftHold
            의 enabled 가드와 이중). 홀드 반복 게이트는 전부 컨트롤러에 있다. */}
        <button
          type="button"
          className="btn btn--primary craft__craft"
          disabled={card.state !== 'ready'}
          {...hold}
        >
          제작
        </button>
        {/* 누적 카운터의 고정 슬롯(§8-앞 3) — 이 숫자가 오르는 것이 피드백의
            전부다. 잠긴 레시피는 이번 열림에 결과가 있을 수 없으므로 슬롯만
            비워 둔다(자리를 없애면 선택을 옮길 때마다 버튼이 튄다). */}
        <p className="craft__tally">
          {!locked && (
            <>
              <span className="craft__tally-good">+{fmt(card.tally.success)}</span>
              {' · 실패 '}
              {fmt(card.tally.fail)}
            </>
          )}
        </p>
      </div>
    </section>
  )
}

/**
 * 열려 있는 동안만 마운트되는 본체. 선택 상태가 여기(React state) 사는 이유:
 * 뷰 로컬이다 — 서버도 다른 화면도 이 값을 모른다. 패널을 닫으면 언마운트로
 * 자연히 버려지고, 다시 열면 초기화가 "첫 제작 가능(없으면 첫)"부터 다시
 * 시작한다(설계 §8-뒤의 선택 계약이 마운트 수명과 정확히 일치한다).
 */
function CraftView({ sections }: { sections: CraftCardSection[] }): JSX.Element {
  const [selectedId, setSelectedId] = useState(() => defaultCraftSelection(sections))

  const flat = sections.flatMap((s) => s.cards)
  const selected = flat.find((c) => c.recipeId === selectedId) ?? flat[0]

  return (
    <div className="craft__body">
      <nav className="craft__list">
        {sections.map((section) => (
          <Fragment key={section.category}>
            <h3 className="craft__section">{section.category}</h3>
            <ul className="craft__rows">
              {section.cards.map((card) => (
                <RecipeRow
                  key={card.recipeId}
                  card={card}
                  selected={card.recipeId === selected?.recipeId}
                  onSelect={setSelectedId}
                />
              ))}
            </ul>
          </Fragment>
        ))}
      </nav>
      {selected !== undefined && <RecipeDetail card={selected} />}
    </div>
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
        <CraftView sections={sections} />
      </section>
    </div>
  )
}
