import { useEffect, useRef } from 'react'
import { createPhaserGame } from '../game/PhaserGame.js'
import { useGameStore } from '../store/gameStore.js'
import { startClockSync } from '../time/clock.js'
import { ConnectionGate } from './ConnectionGate.js'
import { TopBar } from './TopBar.js'
import './ui.css'

export function App(): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const gameRef = useRef<Phaser.Game | null>(null)
  const connection = useGameStore((s) => s.connection)

  // 연결된 뒤에야 게임을 만든다. 서버 없이 월드를 띄워두면 아무 행동도 되지 않는
  // 화면을 보여주게 되고, 끊긴 동안에는 정리해서 세계 시각이 로컬 시계로
  // 흘러가는 것도 막는다.
  useEffect(() => {
    if (connection !== 'online') return
    if (!hostRef.current || gameRef.current) return
    gameRef.current = createPhaserGame(hostRef.current)
    // 개발 빌드에서만 창에 매단다. 브라우저 검증이 씬·카메라·표시목록을 들여다볼
    // 통로가 필요한데(아크 A·B 의 마무리 태스크가 이것으로 다섯 맵을 돌았다),
    // 가드가 없으면 출하 번들에도 그대로 남는다 — 판정은 서버가 하므로 치트가
    // 되지는 않지만, 내보낼 이유가 없는 것을 내보내는 것은 그 자체로 부채다.
    if (import.meta.env.DEV) {
      ;(window as unknown as { __debugGame?: Phaser.Game }).__debugGame = gameRef.current
    }
    return () => {
      gameRef.current?.destroy(true)
      gameRef.current = null
      // Phaser 의 destroy(true) 는 캔버스를 동기적으로 지우지 않는다 — pendingDestroy
      // 플래그만 세우고, 실제 정리(캔버스 제거·렌더러/씬/리스너 해제)는
      // requestAnimationFrame 으로 구동되는 다음 step() 의 runDestroy() 에서 일어난다
      // (phaser/src/core/Game.js). 이미 예약된 rAF 는 취소되지 않으므로, 정상적으로
      // 컴포지팅되는 탭이라면 다음 프레임에 저절로 정리된다 — 지속되는 누수가 아니라
      // 한 프레임짜리 잔상이다.
      // 다만 React 18 StrictMode 의 개발 모드 마운트→언마운트→재마운트는 같은 틱에서
      // 동기적으로 일어나므로, 그 한 프레임의 틈에 새 게임이 만들어지면 이전 캔버스와
      // 겹쳐 보일 수 있다. 즉시 비워서 그 프레임이 실제로 도착하는지에 기대지 않고
      // 개발 모드 언마운트를 결정적으로 만든다 — 이 호출은 DOM 증상만 지울 뿐,
      // Phaser 의 렌더러/씬/리스너 정리는 여전히 다음 프레임의 runDestroy() 에서 이루어진다.
      hostRef.current?.replaceChildren()
    }
  }, [connection])

  // 서버 시계를 맞추고 플레이어 상태를 받아온다. 성공해야 게임에 들어간다.
  useEffect(() => {
    void useGameStore.getState().connect()
  }, [])

  // 이후의 주기·복귀 재동기. 최초 동기화는 connect() 가 이미 했다.
  useEffect(() => startClockSync(), [])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />
      {connection === 'online' ? (
        <div className="overlay">
          <TopBar />
          {/* 인벤토리·제작 패널은 온스크린 컨트롤러 버튼으로 여닫는다 (별도 작업) */}
        </div>
      ) : (
        <ConnectionGate />
      )}
    </div>
  )
}
