import { COMBAT_MAX_HP, currentHp, type InnDef, type PlayerState } from '@nogada/shared'
import { useEffect, useState } from 'react'
import { ALREADY_FULL_TEXT, innIdOf, useGameStore } from '../store/gameStore.js'
import { worldNow } from '../time/clock.js'
import { formatGold } from './shopModel.js'

/**
 * 여관 전면 패널(DOM) — 상점 패널의 동생이다(아크 D §2). TopBar 가 마운트한다:
 * App.tsx 가 불가침이라 게임 중 React 가 그릴 수 있는 자리가 상단 바뿐이라는
 * 사정은 Bag·Craft·Shop 과 같다. 문을 여는 것은 이 컴포넌트가 아니라 대사가
 * 끝나는 순간이다(pendingInn — pendingShop 의 쌍둥이).
 *
 * **값은 데이터가 말한다**: 버튼의 1,500G 는 inns.csv 가 구운 `data.inns` 에서
 * 읽는다 — 요구치를 숫자로 말하는 문이고, 코드에 값 사본이 없다.
 *
 * **만혈이면 버튼을 안 그린다**(죽은 버튼 금지, §8-앞 13): 눌러도 서버가
 * already_full 로 거절만 하는 버튼이다. 만혈 판정은 서버(performRest)와 같은
 * shared 술어(currentHp)를 같은 게으른 셈으로 부른다 — 부등호 한 벌 규범.
 * 그래도 회복 완료 직전에 누른 경합 창은 화면이 못 막고, 그 거절은 패널 안
 * (innError)에서 한국어로 말한다.
 */

/**
 * HP 는 저장칸이 아니라 시각의 함수다(전투 §6) — 자연 회복이 차오르는 것을
 * 이 패널도 그려야 만혈이 되는 순간 버튼이 제때 사라진다. 회복이 3초에 1 이라
 * (HP_REGEN_MS_PER_HP) 1초면 경계를 놓치지 않는다 — TopBar 의 2.5초보다 촘촘한
 * 이유는 여기서는 숫자 표시가 아니라 **버튼의 존재**가 갈리기 때문이다.
 */
const TICK_MS = 1_000

const fmt = (n: number): string => n.toLocaleString('ko-KR')

/**
 * 서버가 이번 회복을 거절한 이유 — 값 줄과 버튼 사이의 한 줄. 상점의
 * TradeError 와 같은 자리·같은 이유이고 role="status" 인 이유도 같다.
 */
function InnError(): JSX.Element | null {
  const text = useGameStore((s) => s.innError)
  if (text === null) return null
  return (
    <p className="shop__error" role="status">
      {text}
    </p>
  )
}

/**
 * 열려 있는 동안만 마운트되는 본체 — 시계(tick)가 여기 사는 이유다: 바깥에
 * 두면 패널이 닫혀 있는 동안에도 매초 깨어난다(ShopView 가 탭·선택을 안으로
 * 들인 그 모양).
 */
function InnView({ inn, player }: { inn: InnDef; player: PlayerState }): JSX.Element {
  const [now, setNow] = useState(() => worldNow())
  const busy = useGameStore((s) => s.innBusy)

  useEffect(() => {
    const id = window.setInterval(() => setNow(worldNow()), TICK_MS)
    return () => window.clearInterval(id)
  }, [])

  const hp = currentHp(player.combat, now)
  const full = hp === COMBAT_MAX_HP

  return (
    <section className="craft__detail">
      <div className="craft__info">
        <p className="shop__stat">
          HP{' '}
          <span className="craft__owned-num">
            {hp}/{COMBAT_MAX_HP}
          </span>
        </p>
        {/* 값은 만혈에도 남는다 — 요구치를 숫자로 말하는 문은 잠겨 있어도 숫자를 말한다. */}
        <p className="shop__stat">
          하룻밤 <span className="shop__unit">{formatGold(inn.gold)}</span>
        </p>
        {full && <p className="shop__stat">{ALREADY_FULL_TEXT} — 쉴 것이 없다.</p>}
        <InnError />
      </div>
      {/* 만혈이면 실행 발판을 아예 두지 않는다 — 비활성 버튼도 그리지 않는다
          (§8-앞 13). 골드가 모자라면 버튼만 잠긴다: 위의 값 숫자가 이유를 말한다. */}
      {!full && (
        <div className="craft__actions">
          <button
            type="button"
            className="btn btn--primary shop__confirm"
            disabled={busy || player.gold < inn.gold}
            onClick={() => void useGameStore.getState().rest(inn.speakerId)}
          >
            쉬어간다 ({fmt(inn.gold)}G)
          </button>
        </div>
      )}
    </section>
  )
}

export function InnPanel(): JSX.Element | null {
  const innId = useGameStore((s) => innIdOf(s.openPanel))
  const player = useGameStore((s) => s.player)
  const data = useGameStore((s) => s.data)

  if (innId === null || player === null) return null
  // 등록부에 없는 여관은 서버가 보낼 수 없다(TalkOutcome.inn 은 등록부 조회의
  // 결과다). 그래도 조용히 넘어간다 — 데이터를 갈아엎는 중에 화면이 통째로
  // 죽는 것보다 낫다(ShopPanel 의 그 자세).
  const inn = Object.hasOwn(data.inns, innId) ? data.inns[innId] : undefined
  if (inn === undefined) return null

  return (
    <div className="panel">
      <section className="panel__card">
        <header className="panel__header">
          <h2 className="panel__title">여관</h2>
          {/* 지금 가진 돈 — 값과 나란히 있어야 "잘 수 있는가"가 한눈에 읽힌다. */}
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
        {/* key 로 여관마다 본체를 새로 마운트한다 — 시계·잔상은 그 여관의 것이다. */}
        <InnView key={inn.speakerId} inn={inn} player={player} />
      </section>
    </div>
  )
}
