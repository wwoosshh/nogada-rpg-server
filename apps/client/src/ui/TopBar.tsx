import { SEASON_LABELS, gameTimeAt } from '@nogada/shared'
import { useEffect, useState } from 'react'
import { worldNow } from '../time/clock.js'

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

  return (
    <div className="topbar">
      <span className="topbar__clock">
        {SEASON_LABELS[t.season]} {t.dayOfSeason}일 · {pad(t.hour)}:{pad(t.minute)}
      </span>
      {/* 설정 버튼이 들어올 자리. 지금은 비워 두되 공간은 잡아 둔다. */}
      <span className="topbar__actions" />
    </div>
  )
}
