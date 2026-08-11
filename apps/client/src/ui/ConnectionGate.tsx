import { useGameStore } from '../store/gameStore.js'
import { AuthScreen } from './AuthScreen.js'
import { CreateCharacterScreen } from './CreateCharacterScreen.js'
import { TitleScreen } from './TitleScreen.js'

/**
 * 게임에 들어가기 전의 모든 화면.
 *
 * App.tsx 는 `connection !== 'online'` 일 때 이것 하나만 그린다(그 파일은
 * 불가침이다). 그래서 타이틀·로그인·캐릭터 생성이 전부 이 안에서 갈라진다 —
 * 화면을 늘리는 일은 App.tsx 가 아니라 여기서 `boot` 국면을 늘리는 일이다.
 *
 * 반쯤 동작하는 상태를 보여주지 않는다는 원래 목적은 그대로다: 서버가 모든
 * 판정을 하므로 연결도 로그인도 없이 월드만 그려두면 플레이어는 게임이
 * 고장난 줄 알게 된다.
 */
export function ConnectionGate(): JSX.Element {
  const boot = useGameStore((s) => s.boot)

  switch (boot) {
    case 'checking':
      return <CheckingScreen />
    case 'unreachable':
      return <UnreachableScreen />
    case 'title':
      return <TitleScreen />
    case 'auth':
      return <AuthScreen />
    case 'creating':
      return <CreateCharacterScreen />
    case 'playing':
      // App.tsx 가 이미 세계를 그리고 있으므로 여기까지 오지 않는다. 빈 화면을
      // 돌려주는 것은 그 한 프레임의 어긋남(스토어가 먼저 바뀌고 React 가 아직
      // 다시 그리기 전)에 게이트가 세계를 덮지 않게 하기 위해서다.
      return <></>
    default: {
      // BootPhase 에 국면이 늘었는데 여기서 못 따라가면 컴파일이 깨진다 —
      // 화면 없는 국면은 "아무것도 안 뜨는 검은 화면" 으로만 드러난다.
      const exhaustive: never = boot
      throw new Error(`화면이 없는 부팅 국면: ${String(exhaustive)}`)
    }
  }
}

/** 토큰이 아직 유효한지 서버에 묻는 동안. 부팅 호출에는 시한이 걸려 있어 여기 영원히 머물지 않는다. */
function CheckingScreen(): JSX.Element {
  return (
    <div className="gate">
      <div className="gate__box">
        <div className="gate__title">서버에 연결하는 중</div>
        <p className="gate__body">잠시만 기다려 주세요.</p>
      </div>
    </div>
  )
}

/**
 * 서버와 **말 자체를 못 걸었다.**
 *
 * 로그인이 만료된 화면(타이틀)과 반드시 달라야 한다(설계 규범 12): 저기서
 * 할 일은 다시 로그인하는 것이고 여기서 할 일은 서버가 살아나기를 기다리는
 * 것이다. 둘을 한 화면에 뭉치면 할 수 없는 일을 하라고 안내하게 된다.
 */
function UnreachableScreen(): JSX.Element {
  const connect = useGameStore((s) => s.connect)
  const gateError = useGameStore((s) => s.gateError)

  return (
    <div className="gate">
      <div className="gate__box">
        <div className="gate__title">서버에 연결할 수 없습니다</div>
        <p className="gate__body">
          {gateError}
          <br />이 게임은 채집과 제작을 서버가 판정합니다. 연결된 뒤에 플레이할 수 있습니다.
        </p>
        <button className="gate__retry" onClick={() => void connect()}>
          다시 시도
        </button>
      </div>
    </div>
  )
}
