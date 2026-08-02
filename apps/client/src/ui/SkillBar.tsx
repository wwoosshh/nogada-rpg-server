import { SKILL_IDS, xpToNext, type SkillId } from '@nogada/shared'
import { selectToolTier, useGameStore } from '../store/gameStore.js'

const SKILL_NAMES: Record<SkillId, string> = {
  mining: '광부',
  smithing: '대장',
}

export function SkillBar(): JSX.Element | null {
  const player = useGameStore((s) => s.player)
  if (!player) return null

  return (
    <div className="panel skillbar">
      {SKILL_IDS.map((id) => {
        const skill = player.skills[id]
        const need = xpToNext(skill.level)
        const pct = Math.min(100, Math.round((skill.xp / need) * 100))
        const tier = selectToolTier(id)

        return (
          <div className="skillbar__item" key={id}>
            <div>
              <span className="skillbar__name">{SKILL_NAMES[id]} </span>
              <span className="skillbar__level">Lv.{skill.level}</span>
              <span className="skillbar__name"> · 도구 {tier || '없음'}</span>
            </div>
            <div className="xpbar">
              <div className="xpbar__fill" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
