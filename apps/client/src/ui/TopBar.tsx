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
    <div className="topbar">
      <span className="topbar__clock">
        {SEASON_LABELS[t.season]} {t.dayOfSeason}일 · {pad(t.hour)}:{pad(t.minute)}
      </span>
      {milestoneLine !== null && <span className="topbar__milestone">{milestoneLine}</span>}
      {/* 설정 버튼이 들어올 자리. 지금은 비워 두되 공간은 잡아 둔다. */}
      <span className="topbar__actions" />
    </div>
  )
}
