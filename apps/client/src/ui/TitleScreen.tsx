import { useGameStore } from '../store/gameStore.js'

/**
 * 게임의 문 — 타이틀.
 *
 * 버튼이 하나인 것이 요점이다. 저장된 토큰이 살아 있으면 "이어서 하기", 아니면
 * "시작" 이다 — 둘을 나란히 놓으면 앱을 켤 때마다 "나는 지금 로그인되어 있나"를
 * 사람이 먼저 판단해야 한다. 그 판단은 이미 부팅이 서버에 물어서 끝냈다.
 *
 * 만료 안내(`session === 'rejected'`)는 여기 뜬다. 토큰이 없는 것과 거절당한
 * 것은 다음에 할 일이 같지만(로그인) **왜 그런지가 다르다** — 방금까지
 * 플레이하던 사람에게 아무 말 없이 시작 화면을 내밀면 진행도가 사라진 줄 안다.
 */
export function TitleScreen(): JSX.Element {
  const session = useGameStore((s) => s.session)
  const gateError = useGameStore((s) => s.gateError)
  const gateBusy = useGameStore((s) => s.gateBusy)
  const showAuth = useGameStore((s) => s.showAuth)
  const resume = useGameStore((s) => s.resume)

  const canResume = session === 'ready'

  return (
    <div className="screen">
      <div className="screen__panel screen__panel--narrow">
        <h1 className="screen__title">노가다 RPG</h1>
        <p className="screen__sub">팬메이드</p>

        {gateError !== null && <p className="screen__error">{gateError}</p>}

        <button
          type="button"
          className="btn btn--primary"
          disabled={gateBusy}
          onClick={() => (canResume ? void resume() : showAuth())}
        >
          {gateBusy ? '…' : canResume ? '이어서 하기' : '시작'}
        </button>

        {canResume && (
          <button type="button" className="btn btn--ghost" disabled={gateBusy} onClick={showAuth}>
            다른 계정으로 로그인
          </button>
        )}
      </div>
    </div>
  )
}
