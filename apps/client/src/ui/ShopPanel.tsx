import type { GameData, PlayerState, ShopDef } from '@nogada/shared'
import { useState } from 'react'
import { shopIdOf, useGameStore } from '../store/gameStore.js'
import { ItemIcon } from './ItemIcon.js'
import {
  buyRows,
  clampCount,
  formatGold,
  maxBuyCount,
  maxSellCount,
  sellRows,
  tradeTotal,
  type ShopBuyRow,
  type ShopSellRow,
} from './shopModel.js'

/**
 * 상점 전면 패널(DOM) — 제작 패널의 형제다. 좌 목록 · 우 상세 · 큰 버튼(설계
 * §8-뒤)에 **탭 둘(팔기·사기)** 을 얹은 것이 전부이고, 그래서 두 패널은 같은
 * 화면처럼 읽힌다. TopBar 가 마운트한다 — App.tsx 가 불가침이라 게임 중 React
 * 가 그릴 수 있는 자리가 상단 바뿐이라는 사정은 BagPanel·CraftPanel 과 같다.
 *
 * **선택과 실행이 분리돼 있다**(제작 패널의 그 계약 그대로): 왼쪽 행 탭은
 * 선택만 하고, 파는 것도 사는 것도 오른쪽 상세 하단의 큰 버튼 하나가 한다.
 * 홀드 반복은 없다 — 거래는 쥐고 있을 일이 아니라 수량을 골라 한 번 누르는
 * 일이라, 반복 대신 `−`/`+`/`전부` 가 그 자리를 대신한다.
 *
 * **잠긴 진열은 그대로 보이고 요구치를 숫자로 말한다**(원작의 그 문, §8-앞 11):
 * 흐림은 아이콘·이름까지만이고 요구치 카운터는 상세에서 가장 밝다. 이미 가진
 * 증표는 `보유 중` 이라 적고 버튼을 그리지 않는다 — 눌러도 서버가 거절만 하는
 * 죽은 버튼을 만들지 않는다(§8-앞 13).
 *
 * **키보드 리스너를 두지 않는다** — I/C/ESC·B 는 전부 InputHub →
 * PanelScene.applyInput 이 라우팅한다(§8-앞 7). 이 컴포넌트는 openPanel 을
 * 구독해 그리고, ✕ 로 스토어 액션을 부르는 것이 전부다.
 *
 * 열림 값은 `'shop:<id>'` 문자열 키다 — 그 이유는 gameStore 의 ShopPanelKey
 * 문서에 있다. 문을 여는 것은 이 컴포넌트가 아니라 대사가 끝나는 순간이다
 * (§6-앞 20, DialogueScene).
 */

type ShopTab = 'sell' | 'buy'

/** 이번에 고른 줄과 수량. 수량은 줄마다 다르므로 선택이 옮겨지면 함께 버린다. */
interface Pick {
  itemId: string
  count: number
}

const fmt = (n: number): string => n.toLocaleString('ko-KR')

/** 팔기 목록 행 — 오른쪽에 보유 수량. 판 만큼 줄어드는 그 숫자가 피드백이다. */
function SellRow({
  row,
  selected,
  onSelect,
}: {
  row: ShopSellRow
  selected: boolean
  onSelect: (itemId: string) => void
}): JSX.Element {
  return (
    <li>
      <button
        type="button"
        className={`craft__row${selected ? ' craft__row--on' : ''}`}
        aria-pressed={selected}
        onClick={() => onSelect(row.itemId)}
      >
        <span className="craft__cursor" aria-hidden="true">
          {selected ? '▶' : ''}
        </span>
        <ItemIcon itemId={row.itemId} />
        <span className="craft__row-name">{row.name}</span>
        <span className="shop__row-num">×{fmt(row.held)}</span>
      </button>
    </li>
  )
}

/**
 * 사기 목록 행. 오른쪽 표시가 상태를 그대로 말한다 — 값(살 수 있다) / 🔒+요구치
 * (잠김) / 보유 중(증표). 컴팩트한 행에서도 요구치 숫자를 숨기지 않는다.
 */
function BuyRow({
  row,
  selected,
  onSelect,
}: {
  row: ShopBuyRow
  selected: boolean
  onSelect: (itemId: string) => void
}): JSX.Element {
  const modifier = `${selected ? ' craft__row--on' : ''}${
    row.state === 'locked' ? ' craft__row--locked' : ''
  }`
  return (
    <li>
      <button
        type="button"
        className={`craft__row${modifier}`}
        aria-pressed={selected}
        onClick={() => onSelect(row.itemId)}
      >
        <span className="craft__cursor" aria-hidden="true">
          {selected ? '▶' : ''}
        </span>
        <ItemIcon itemId={row.itemId} />
        <span className="craft__row-name">{row.name}</span>
        {row.state === 'locked' ? (
          <span className="craft__row-req">
            {/* 자물쇠는 장식이라 aria-hidden — 잠김은 이미 이 숫자가 말한다. */}
            <span aria-hidden="true">🔒</span>
            {fmt(row.proficiency)}/{fmt(row.unlockSkill)}
          </span>
        ) : row.state === 'owned' ? (
          <span className="shop__row-owned">보유 중</span>
        ) : (
          <span className="shop__row-num">{fmt(row.unitPrice)}</span>
        )}
      </button>
    </li>
  )
}

/**
 * 수량 고르개 — `−` / 큰 숫자 / `+` / `전부`.
 *
 * **고를 것이 하나뿐이면(max ≤ 1) 버튼을 그리지 않는다**: 증표는 하나로 충분하고
 * (§6-앞 16) 한 개 남은 재료도 고를 여지가 없다 — 눌러도 아무 일 없는 버튼 셋을
 * 그리는 대신 숫자만 남긴다(죽은 버튼 금지, §8-앞 13). 숫자 자리는 그대로라
 * 선택을 옮겨도 화면이 튀지 않는다.
 */
function QuantityPicker({
  count,
  max,
  onChange,
}: {
  count: number
  max: number
  onChange: (next: number) => void
}): JSX.Element {
  return (
    <div className="shop__qty">
      {/* 라벨을 늘 둔다 — 증표처럼 고를 것이 하나뿐인 칸에서는 버튼이 없어
          큰 숫자 하나만 남는데, 그것만으로는 그 숫자가 수량인지 값인지 읽히지
          않는다(개당 값이 바로 위에 있다). */}
      <span className="shop__qty-label">수량</span>
      {max > 1 && (
        <button
          type="button"
          className="shop__step"
          aria-label="하나 줄이기"
          disabled={count <= 1}
          onClick={() => onChange(count - 1)}
        >
          −
        </button>
      )}
      <span className="shop__qty-num">{fmt(count)}</span>
      {max > 1 && (
        <>
          <button
            type="button"
            className="shop__step"
            aria-label="하나 늘리기"
            disabled={count >= max}
            onClick={() => onChange(count + 1)}
          >
            +
          </button>
          <button type="button" className="shop__step shop__step--all" onClick={() => onChange(max)}>
            전부
          </button>
        </>
      )}
    </div>
  )
}

/** 상세 하단의 총액 한 줄 — 골드보다 크면 붉다(그게 곧 버튼이 잠긴 이유다). */
function TotalLine({ total, short }: { total: number; short: boolean }): JSX.Element {
  return (
    <p className="shop__stat">
      합계{' '}
      <span className={`shop__total${short ? ' shop__total--short' : ''}`}>{formatGold(total)}</span>
    </p>
  )
}

/** 오른쪽 상세 — 파는 쪽. 큰 아이콘 · 개당 값 · 보유 · 수량 · 총액 · [팔기]. */
function SellDetail({ shopId, row }: { shopId: string; row: ShopSellRow }): JSX.Element {
  const max = maxSellCount(row)
  const [pick, setPick] = useState(1)
  const count = clampCount(pick, max)

  return (
    <section className="craft__detail">
      <div className="craft__info">
        <div className="craft__head">
          <div className="craft__frame">
            <ItemIcon itemId={row.itemId} size={64} />
          </div>
          <div className="craft__head-text">
            <h4 className="craft__detail-name">{row.name}</h4>
            <span className="craft__owned">
              보유 <span className="craft__owned-num">{fmt(row.held)}</span>
            </span>
          </div>
        </div>
        <p className="shop__stat">
          개당 <span className="shop__unit">{formatGold(row.unitPrice)}</span>
        </p>
        <QuantityPicker count={count} max={max} onChange={setPick} />
      </div>
      <div className="craft__actions">
        <TotalLine total={tradeTotal(row.unitPrice, count)} short={false} />
        <button
          type="button"
          className="btn btn--primary shop__confirm"
          onClick={() => void useGameStore.getState().sell(shopId, row.itemId, count)}
        >
          팔기
        </button>
      </div>
    </section>
  )
}

/**
 * 오른쪽 상세 — 사는 쪽. 잠긴 칸은 요구치 카운터가 이 화면에서 가장 밝고
 * (§8-앞 11), 이미 가진 증표는 `보유 중` 만 남는다. 둘 다 버튼이 없다.
 */
function BuyDetail({
  shopId,
  row,
  gold,
}: {
  shopId: string
  row: ShopBuyRow
  gold: number
}): JSX.Element {
  const max = maxBuyCount(row, gold)
  const [pick, setPick] = useState(1)
  const count = clampCount(pick, max)
  const total = tradeTotal(row.unitPrice, count)
  const locked = row.state === 'locked'

  return (
    <section className="craft__detail">
      <div className={`craft__info${locked ? ' craft__info--locked' : ''}`}>
        <div className="craft__head">
          <div className="craft__frame">
            <ItemIcon itemId={row.itemId} size={64} />
          </div>
          <div className="craft__head-text">
            <h4 className="craft__detail-name">{row.name}</h4>
            <span className="craft__owned">
              개당 <span className="craft__owned-num">{formatGold(row.unitPrice)}</span>
            </span>
          </div>
        </div>
        {locked ? (
          <p className="craft__stat">
            {row.skillLabel} 숙련도{' '}
            <span className="craft__req">
              {fmt(row.proficiency)}/{fmt(row.unlockSkill)}
            </span>
          </p>
        ) : row.state === 'owned' ? (
          <p className="craft__stat">
            <span className="shop__owned-mark">보유 중</span>
          </p>
        ) : (
          <QuantityPicker count={count} max={max} onChange={setPick} />
        )}
      </div>
      {/* 잠긴 칸·보유한 증표에는 실행 발판을 아예 두지 않는다 — 비활성 버튼도
          그리지 않는다는 뜻이다(§8-앞 13). 살 수 있는 칸에서만 총액과 버튼이
          나타나고, 골드가 모자라면 버튼만 잠긴 채 붉은 총액이 이유를 말한다. */}
      {row.state === 'ready' && (
        <div className="craft__actions">
          <TotalLine total={total} short={total > gold} />
          <button
            type="button"
            className="btn btn--primary shop__confirm"
            disabled={total > gold}
            onClick={() => void useGameStore.getState().buy(shopId, row.itemId, count)}
          >
            사기
          </button>
        </div>
      )}
    </section>
  )
}

/**
 * 열려 있는 동안만 마운트되는 본체. 탭·선택·수량이 전부 여기(React state)
 * 사는 이유는 제작 패널과 같다 — 뷰 로컬이고, 패널을 닫으면 언마운트로 자연히
 * 버려진다.
 */
function ShopView({
  shop,
  data,
  player,
}: {
  shop: ShopDef
  data: GameData
  player: PlayerState
}): JSX.Element {
  const [tab, setTab] = useState<ShopTab>('sell')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const sells = sellRows(data, player, shop)
  const buys = buyRows(data, player, shop)

  // 고른 줄이 사라졌으면(다 팔았다) 첫 줄로 돌아온다 — 상세가 빈 채로 남으면
  // 방금 판 사람이 "다음 물건"을 다시 손으로 찾아야 한다.
  const selectedSell = sells.find((r) => r.itemId === selectedId) ?? sells[0]
  const selectedBuy = buys.find((r) => r.itemId === selectedId) ?? buys[0]

  const selectTab = (next: ShopTab): void => {
    setTab(next)
    // 탭이 바뀌면 선택도 그 탭의 첫 줄에서 시작한다 — 팔기에서 고른 아이템 id
    // 가 사기 목록에 우연히 있으면 엉뚱한 줄이 잡힌다.
    setSelectedId(null)
  }

  return (
    <>
      <div className="shop__tabs">
        <button
          type="button"
          className={`screen__tab${tab === 'sell' ? ' screen__tab--on' : ''}`}
          aria-pressed={tab === 'sell'}
          onClick={() => selectTab('sell')}
        >
          팔기
        </button>
        <button
          type="button"
          className={`screen__tab${tab === 'buy' ? ' screen__tab--on' : ''}`}
          aria-pressed={tab === 'buy'}
          onClick={() => selectTab('buy')}
        >
          사기
        </button>
      </div>
      <div className="craft__body">
        <nav className="craft__list">
          <ul className="craft__rows">
            {tab === 'sell'
              ? sells.map((row) => (
                  <SellRow
                    key={row.itemId}
                    row={row}
                    selected={row.itemId === selectedSell?.itemId}
                    onSelect={setSelectedId}
                  />
                ))
              : buys.map((row) => (
                  <BuyRow
                    key={row.itemId}
                    row={row}
                    selected={row.itemId === selectedBuy?.itemId}
                    onSelect={setSelectedId}
                  />
                ))}
          </ul>
          {tab === 'sell' && sells.length === 0 && (
            // 이 상점은 자기 계열만 산다 — 빈 목록은 결격이 아니라 "그건 저쪽
            // 마을에서 팔아라"라는 안내다(설계 §4).
            <p className="bag__empty">이 상점에 팔 것이 없다.</p>
          )}
        </nav>
        {tab === 'sell'
          ? selectedSell !== undefined && (
              // key 로 줄마다 상세를 새로 마운트한다 — 수량(useState)이 그
              // 줄의 것이라, 선택을 옮겼는데 앞 줄에서 고른 12 가 따라오면
              // 안 된다.
              <SellDetail key={selectedSell.itemId} shopId={shop.id} row={selectedSell} />
            )
          : selectedBuy !== undefined && (
              <BuyDetail
                key={selectedBuy.itemId}
                shopId={shop.id}
                row={selectedBuy}
                gold={player.gold}
              />
            )}
      </div>
    </>
  )
}

export function ShopPanel(): JSX.Element | null {
  const shopId = useGameStore((s) => shopIdOf(s.openPanel))
  const player = useGameStore((s) => s.player)
  const data = useGameStore((s) => s.data)

  if (shopId === null || player === null) return null
  // 등록부에 없는 상점은 서버가 보낼 수 없다(TalkOutcome.shop 은 shopAccess 가
  // 통과한 id 다). 그래도 조용히 넘어간다 — 데이터를 갈아엎는 중에 화면이
  // 통째로 죽는 것보다 낫다.
  const shop = data.shops[shopId]
  if (shop === undefined) return null

  return (
    <div className="panel">
      <section className="panel__card">
        <header className="panel__header">
          <h2 className="panel__title">{shop.name}</h2>
          {/* 지금 가진 돈 — 파는 동안 오르고 사는 순간 준다. 이 화면에서
              가장 자주 보는 숫자라 헤더에 상주한다. */}
          <span className="shop__gold" aria-label="소지금">
            {formatGold(player.gold)}
          </span>
          <button
            type="button"
            className="panel__close"
            aria-label="닫기"
            onClick={() => useGameStore.getState().setOpenPanel(null)}
          >
            ✕
          </button>
        </header>
        {/* key 로 상점마다 본체를 새로 마운트한다 — 탭·선택은 그 상점의 것이다. */}
        <ShopView key={shop.id} shop={shop} data={data} player={player} />
      </section>
    </div>
  )
}
