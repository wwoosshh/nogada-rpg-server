import {
  gameTimeAt,
  metricValue,
  nextMilestone,
  SEASON_LABELS,
  SKILL_LABELS,
  type GameData,
  type PlayerState,
} from '@nogada/shared'
import { useEffect, useState } from 'react'
import { useGameStore } from '../store/gameStore.js'
import { worldNow } from '../time/clock.js'
import { DeleteCharacterDialog } from './DeleteCharacterDialog.js'

/** 게임 1분 = 현실 2.5초. 초 단위로 갱신해봐야 읽는 사람에게 의미가 없다. */
const TICK_MS = 2500

const pad = (n: number): string => String(n).padStart(2, '0')
const fmt = (n: number): string => n.toLocaleString('ko-KR')

/**
 * 상단 바에 띄울 "다음 이정표" 한 줄. 규칙(어느 것이 다음인지, 지표가 얼마인지)은
 * 전부 shared 의 nextMilestone·metricValue 가 계산한다 — 여기서는 그 결과를
 * 문구로 조립하기만 한다.
 *
 * skill 이정표는 SKILL_LABELS 로 어느 기술인지 밝힌다. every 이정표는 기술이
 * 아니라 다른 이정표 달성 개수를 세므로 "3 / 4" 만 보여주면 무엇의 3/4인지
 * 알 길이 없다 — 그 이정표의 name 자체가 이미 "고르게 손에 익다" 처럼 무엇을
 * 세는지 설명하도록 데이터에 쓰여 있으므로, 새 문구를 짓지 않고 그걸 주어로 쓴다.
 */
function describeNextMilestone(data: GameData, player: PlayerState): string | null {
  const next = nextMilestone(data.milestones, player)
  if (!next) return null
  // every 분기: 지금 데이터로는 실제로 뽑히지 않는다 — 구성 이정표가 항상 같은 비율을 먼저 내며 동점에서 파일 순서로 이긴다(milestoneRatio 문서 참고). 그래도 타입상 반드시 있어야 하고, 데이터가 바뀌면 그대로 살아난다.
  const subject = next.metric.kind === 'skill' ? SKILL_LABELS[next.metric.skill] : next.name
  const value = metricValue(next, player, data.milestones)
  return `다음 · ${subject} ${fmt(value)} / ${fmt(next.threshold)}`
}

export function TopBar(): JSX.Element {
  const [now, setNow] = useState(() => worldNow())

  useEffect(() => {
    const id = window.setInterval(() => setNow(worldNow()), TICK_MS)
    return () => window.clearInterval(id)
  }, [])

  const t = gameTimeAt(now)

  // 셀렉터가 문자열(또는 null) 자체를 고른다. player 는 채집·제작마다
  // 성패와 무관하게 새 객체로 바뀌지만(서버가 매번 nextActionAt 을 갱신한
  // structuredClone 을 돌려준다), 그렇다고 이 문구까지 매번 바뀌는 것은
  // 아니다 — 기본 비교자 Object.is 는 문자열을 값으로 비교하므로, 실패한
  // 채집처럼 문구가 그대로면 재렌더가 일어나지 않는다. lastAction·milestone
  // 같은 스토어의 다른 필드가 바뀔 때도(머리 위 피드백 등) player 참조
  // 자체는 그대로이므로 이 셀렉터는 다시 불리지 않는다.
  const milestoneLine = useGameStore((s) =>
    s.player ? describeNextMilestone(s.data, s.player) : null,
  )

  return (
    <>
      {/*
        캐릭터 삭제 확인 창. 여는 곳은 설정 탭(Phaser)이고 그리는 곳이 여기인
        이유는 App.tsx 때문이다 — 게임 중에 그 파일이 그리는 DOM 은 이 상단
        바뿐이라, 이름을 타이핑할 입력을 붙일 수 있는 자리도 여기뿐이다.
        (App.tsx 를 건드리지 않는 이유는 아래 톱니 주석 참고.)
      */}
      <DeleteCharacterDialog />
      <div className="topbar">
        <span className="topbar__clock">
          {SEASON_LABELS[t.season]} {t.dayOfSeason}일 · {pad(t.hour)}:{pad(t.minute)}
        </span>
        {milestoneLine !== null && <span className="topbar__milestone">{milestoneLine}</span>}
        {/*
          상세 메뉴(Phaser 의 PanelScene)를 설정 탭으로 여는 두 번째 입구다 — B 와
          같은 목적지를 가리킨다. 메뉴 자체는 React 가 아니라 Phaser 씬이라 여기서
          직접 그리지 않는다(App.tsx 에 커밋되면 안 되는 개발용 훅이 있어 그 파일을
          건드리지 않기로 했고, 그것이 메뉴를 Phaser 씬으로 만든 이유이기도 하다) —
          대신 gameStore 의 openMenu() 로 요청만 남기고, PanelScene 이 그 요청을
          구독해서 연다(gameStore.ts 의 MenuRequest 문서 참고).
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
