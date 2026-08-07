import { useGameStore } from '../store/gameStore.js'

/**
 * 서버에 연결되기 전까지 게임을 덮는 화면.
 *
 * 반쯤 동작하는 상태를 보여주지 않는 것이 목적이다. 서버가 모든 판정을 하므로
 * 연결이 없으면 채집도 제작도 되지 않는데, 월드만 그려두면 플레이어는 게임이
 * 고장난 줄 알게 된다.
 */
export function ConnectionGate(): JSX.Element {
  const connection = useGameStore((s) => s.connection)
  const connect = useGameStore((s) => s.connect)
  const connecting = connection === 'connecting'

  return (
    <div className="gate">
      <div className="gate__box">
        <div className="gate__title">
          {connecting ? '서버에 연결하는 중' : '서버에 연결할 수 없습니다'}
        </div>
        <p className="gate__body">
          {connecting
            ? '잠시만 기다려 주세요.'
            : '이 게임은 채집과 제작을 서버가 판정합니다. 연결된 뒤에 플레이할 수 있습니다.'}
        </p>
        <button className="gate__retry" onClick={() => void connect()} disabled={connecting}>
          {connecting ? '연결 중…' : '다시 시도'}
        </button>
      </div>
    </div>
  )
}
