import { useEffect, useRef } from 'react'
import { createPhaserGame } from '../game/PhaserGame.js'

export function App(): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const gameRef = useRef<Phaser.Game | null>(null)

  useEffect(() => {
    if (!hostRef.current || gameRef.current) return
    gameRef.current = createPhaserGame(hostRef.current)
    return () => {
      gameRef.current?.destroy(true)
      gameRef.current = null
      // Phaser 의 destroy(true) 는 다음 프레임까지 캔버스 제거를 미룬다(비동기).
      // React 18 StrictMode 의 개발 모드 마운트→언마운트→재마운트가 같은 틱에서
      // 동기적으로 일어나므로, 그대로 두면 새 게임을 만들기 전에 이전 캔버스가
      // 지워지지 않아 캔버스 두 개가 겹쳐 남는다. 즉시 비워 프로덕션·개발 모두
      // 호스트에 캔버스가 하나만 남도록 강제한다.
      hostRef.current?.replaceChildren()
    }
  }, [])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />
      {/* UI 오버레이는 Task 11 부터 여기에 들어간다 */}
    </div>
  )
}
