import { gameTimeAt, SEASON_LABELS } from '@nogada/shared'
import { useEffect, useState } from 'react'
import { useGameStore } from '../store/gameStore.js'
import { worldNow } from '../time/clock.js'
import { BagPanel } from './BagPanel.js'
import { CraftPanel } from './CraftPanel.js'
import { DeleteCharacterDialog } from './DeleteCharacterDialog.js'
import { ShopPanel } from './ShopPanel.js'
import { formatGold } from './shopModel.js'

/** 게임 1분 = 현실 2.5초. 초 단위로 갱신해봐야 읽는 사람에게 의미가 없다. */
const TICK_MS = 2500

const pad = (n: number): string => String(n).padStart(2, '0')

export function TopBar(): JSX.Element {
  const [now, setNow] = useState(() => worldNow())

  useEffect(() => {
    const id = window.setInterval(() => setNow(worldNow()), TICK_MS)
    return () => window.clearInterval(id)
  }, [])

  const t = gameTimeAt(now)

  // 셀렉터가 문자열(또는 null) 자체를 고른다. player 는 채집·제작마다
  // 성패와 무관하게 새 객체로 바뀌지만(서버가 매번 nextActionAt 을 갱신한
  // structuredClone 을 돌려준다), 그렇다고 이 이름까지 매번 바뀌는 것은
  // 아니다 — 기본 비교자 Object.is 는 문자열을 값으로 비교하므로, 맵을
  // 옮기지 않는 한(mapId 가 그대로면) 재렌더가 일어나지 않는다. lastAction
  // 같은 스토어의 다른 필드가 바뀔 때도(머리 위 피드백 등) 이 셀렉터는
  // 다시 불리지 않는다.
  const mapName = useGameStore((s) =>
    s.player ? (s.data.maps[s.player.location.mapId]?.name ?? null) : null,
  )

  // 골드도 같은 이유로 숫자 하나만 고른다 — 채집·제작마다 player 객체는 새로
  // 오지만 이 값이 안 바뀌면 상단 바는 다시 그려지지 않는다. 맵 이름 옆이
  // 자리인 이유(설계 §6-앞 20 의 배선): 상점 밖에서도 "지금 얼마 있나"가
  // 보여야 캐는 동안 다음 증표까지의 거리가 읽힌다.
  const gold = useGameStore((s) => s.player?.gold ?? null)

  return (
    <>
      {/*
        캐릭터 삭제 확인 창. 여는 곳은 설정 탭(Phaser)이고 그리는 곳이 여기인
        이유는 App.tsx 때문이다 — 게임 중에 그 파일이 그리는 DOM 은 이 상단
        바뿐이라, 이름을 타이핑할 입력을 붙일 수 있는 자리도 여기뿐이다.
        (App.tsx 를 건드리지 않는 이유는 아래 톱니 주석 참고.)
      */}
      {/* 삭제 확인 창이 패널보다 뒤(위)다 — 설정 탭에서 삭제를 여는 순간 패널 값은 이미 'menu' 라 겹칠 일은 없지만, DOM 순서로도 확인 창이 이긴다. */}
      <BagPanel />
      <CraftPanel />
      <ShopPanel />
      <DeleteCharacterDialog />
      <div className="topbar">
        <span className="topbar__clock">
          {SEASON_LABELS[t.season]} {t.dayOfSeason}일 · {pad(t.hour)}:{pad(t.minute)}
        </span>
        {mapName !== null && <span className="topbar__map">{mapName}</span>}
        {gold !== null && (
          <span className="topbar__gold" aria-label="소지금">
            {formatGold(gold)}
          </span>
        )}
        {/*
          상세 메뉴(Phaser 의 PanelScene)를 설정 탭으로 여는 두 번째 입구다 — B 와
          같은 목적지를 가리킨다. 메뉴 자체는 React 가 아니라 Phaser 씬이라 여기서
          직접 그리지 않는다(App.tsx 에 커밋되면 안 되는 개발용 훅이 있어 그 파일을
          건드리지 않기로 했고, 그것이 메뉴를 Phaser 씬으로 만든 이유이기도 하다) —
          대신 gameStore 의 openMenu() 로 요청만 남기고, PanelScene 이 그 요청을
          구독해서 연다(gameStore.ts 의 MenuRequest 문서 참고). openMenu 는
          openPanel 을 'menu' 로 함께 덮으므로, 열려 있던 가방·제작(DOM) 패널은
          그 교체 한 번으로 닫힌다.
        */}
        <button
          type="button"
          className="topbar__gear"
          aria-label="설정"
          onClick={() => useGameStore.getState().openMenu('settings')}
        >
          ⚙
        </button>
      </div>
    </>
  )
}
