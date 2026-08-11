import { useState } from 'react'
import { useGameStore } from '../store/gameStore.js'

/**
 * 캐릭터를 지우기 전에 이름을 직접 타이핑하게 하는 창(설계 규범 7).
 *
 * **왜 버튼 하나가 아닌가:** 슬롯이 하나뿐이라 삭제가 없으면 잘못 고른 외형·
 * 마을이 영구히 갇힌다. 그렇다고 버튼 하나로 지우면 수십 시간이 오타 하나에
 * 사라진다 — 이름을 적게 하는 것이 그 둘 사이의 답이고, 서버도 같은 이름을
 * 다시 견준다(routes/me.ts).
 *
 * **왜 DOM 인가:** 이름을 받는 입력이기 때문이다. Phaser 캔버스 위에 만들면
 * 모바일 키보드·IME·한글 조합을 전부 직접 다시 만들어야 한다. 여는 곳은
 * 설정 탭(Phaser)이고 그리는 곳은 여기다 — 스토어가 그 사이를 잇는다.
 */
export function DeleteCharacterDialog(): JSX.Element | null {
  const open = useGameStore((s) => s.confirmingDelete)
  const name = useGameStore((s) => s.player?.name ?? '')
  const gateError = useGameStore((s) => s.gateError)
  const gateBusy = useGameStore((s) => s.gateBusy)
  const cancel = useGameStore((s) => s.cancelDeleteCharacter)
  const remove = useGameStore((s) => s.deleteCharacter)

  const [typed, setTyped] = useState('')

  if (!open) return null

  return (
    <div className="modal">
      <form
        className="modal__box"
        onSubmit={(e) => {
          e.preventDefault()
          void remove(typed)
        }}
      >
        <div className="modal__title">캐릭터를 지웁니다</div>
        <p className="screen__hint">
          진행도·가방·숙련도가 모두 사라지고 되돌릴 수 없습니다. 계정은 남습니다.
          <br />
          지우려면 캐릭터 이름 <b>{name}</b> 을 그대로 적으세요.
        </p>
        <label className="field">
          <span className="field__label">캐릭터 이름</span>
          <input
            className="field__input"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
        </label>
        {gateError !== null && <p className="screen__error">{gateError}</p>}
        <div className="modal__buttons">
          <button type="button" className="btn btn--ghost" disabled={gateBusy} onClick={cancel}>
            그만두기
          </button>
          {/*
            이름이 맞을 때에만 눌린다. 서버가 어차피 다시 견주므로 안전을 위한
            것이 아니라, 틀린 채로 누르고 실패 문구를 읽는 왕복을 없애기 위해서다.
          */}
          <button type="submit" className="btn btn--danger" disabled={gateBusy || typed !== name}>
            {gateBusy ? '…' : '지운다'}
          </button>
        </div>
      </form>
    </div>
  )
}
