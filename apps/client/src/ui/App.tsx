import { useEffect, useRef } from 'react'
import { createPhaserGame } from '../game/PhaserGame.js'
import { useGameStore } from '../store/gameStore.js'

export function App(): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const gameRef = useRef<Phaser.Game | null>(null)

  useEffect(() => {
    if (!hostRef.current || gameRef.current) return
    gameRef.current = createPhaserGame(hostRef.current)
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
  }, [])

  // 서버에서 플레이어 상태를 한 번 불러온다. 이후 갱신은 채집·제작 응답이 담당한다.
  useEffect(() => {
    void useGameStore.getState().refresh()
  }, [])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />
      {/* UI 오버레이는 Task 11 부터 여기에 들어간다 */}
    </div>
  )
}
