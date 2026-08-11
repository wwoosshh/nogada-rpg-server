import { startVillages, villageField } from '@nogada/data'
import {
  CHARACTER_NAME_MAX,
  CHARACTER_NAME_MIN,
  CharacterNameSchema,
  DEFAULT_APPEARANCE,
  SKILL_LABELS,
  type GameData,
} from '@nogada/shared'
import { useMemo, useState } from 'react'
import { useGameStore } from '../store/gameStore.js'

const NAME_RULE = `이름 ${CHARACTER_NAME_MIN}~${CHARACTER_NAME_MAX}자`

interface VillageCard {
  id: string
  name: string
  /** 이 마을을 고르면 처음 오르는 숙련도 — 화면에 적지 않고 세계에서 유도한다(설계 규범 14). */
  skill: string
  /** 그 숙련도가 어디서 오르는지. 마을이 데리고 있는 채집장의 이름이다. */
  field: string
}

/**
 * 고를 수 있는 마을과 그 마을이 뜻하는 숙련도.
 *
 * **어느 것도 여기 적혀 있지 않다.** 마을 목록은 전환표에서(`startVillages`),
 * 대표 숙련도는 그 마을이 데리고 있는 채집장에서(`villageField`) 나온다 —
 * 카드에 "눈의 마을 = 얼음" 이라고 적어 두면 채집장의 노드를 갈아끼우는 날
 * 화면만 옛말을 하고, 그 어긋남은 아무도 눈치채지 못한 채로 산다.
 */
function villageCards(data: GameData): VillageCard[] {
  return startVillages(data).map((village) => {
    const field = villageField(data, village.id)
    return {
      id: village.id,
      name: village.name,
      skill: SKILL_LABELS[field.skill],
      field: field.map.name,
    }
  })
}

/**
 * 캐릭터 생성 — 이름과 시작 마을.
 *
 * 마을 카드가 대표 숙련도를 말하는 것이 이 화면의 핵심이다(설계 §4):
 * "시작 마을 = 첫 숙련도" 라는 설계가 여기서 처음으로 플레이어에게 드러난다.
 */
export function CreateCharacterScreen(): JSX.Element {
  const data = useGameStore((s) => s.data)
  const gateError = useGameStore((s) => s.gateError)
  const gateBusy = useGameStore((s) => s.gateBusy)
  const createCharacter = useGameStore((s) => s.createCharacter)

  // 데이터는 실행 중에 바뀌지 않는다 — 마을 넷의 유도를 매 글자마다 다시 돌릴 이유가 없다.
  const villages = useMemo(() => villageCards(data), [data])

  const [name, setName] = useState('')
  // 아무것도 고르지 않은 채로 시작할 수 없다. 첫 칸을 미리 골라 두면 "고르는
  // 화면" 이 아니라 "바꾸는 화면" 이 되어, 마을이 곧 숙련도라는 사실을 읽지
  // 않고 지나치게 된다.
  const [village, setVillage] = useState<string | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)

  const submit = (): void => {
    if (!CharacterNameSchema.safeParse(name).success) return setLocalError(NAME_RULE)
    if (village === null) return setLocalError('시작할 마을을 고르세요.')
    setLocalError(null)
    void createCharacter({ name, appearance: DEFAULT_APPEARANCE, village })
  }

  return (
    <div className="screen">
      <form
        className="screen__panel"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <h1 className="screen__title screen__title--small">캐릭터 만들기</h1>

        <label className="field">
          <span className="field__label">이름</span>
          <input
            className="field__input"
            value={name}
            maxLength={CHARACTER_NAME_MAX}
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <p className="screen__hint">{NAME_RULE} · 고른 마을의 숙련도가 먼저 오릅니다</p>

        <div className="villages">
          {villages.map((v) => (
            <button
              key={v.id}
              type="button"
              className={v.id === village ? 'village village--on' : 'village'}
              onClick={() => setVillage(v.id)}
            >
              <span className="village__name">{v.name}</span>
              <span className="village__skill">{v.skill}</span>
              <span className="village__field">{v.field}이 가깝다</span>
            </button>
          ))}
        </div>

        {(localError ?? gateError) !== null && (
          <p className="screen__error">{localError ?? gateError}</p>
        )}

        <button type="submit" className="btn btn--primary" disabled={gateBusy}>
          {gateBusy ? '…' : '시작하기'}
        </button>
      </form>
    </div>
  )
}
