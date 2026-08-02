import { estimateServerNow, needsResync } from '@nogada/shared'
import { GameClient, setServerTimeObserver } from '../api/GameClient.js'

interface Anchor {
  /** 앵커를 잡은 순간의 서버 시각 추정값 */
  serverMs: number
  /** 같은 순간의 performance.now() */
  perfMs: number
}

let anchor: Anchor | null = null
let syncing = false

/**
 * 세계 시각.
 *
 * 앵커가 없으면(오프라인·동기화 전) 로컬 시계로 물러난다. 오프라인에는 공유할
 * 세계가 없으므로 로컬 시계로 충분하고, 온라인으로 붙는 순간 서버 시각으로
 * 스냅된다.
 *
 * 경과를 Date.now() 가 아니라 performance.now() 로 재는 이유는 세션 도중
 * 사용자가 기기 시계를 바꿔도 세계 시각이 튀지 않게 하기 위해서다.
 */
export function worldNow(): number {
  if (!anchor) return Date.now()
  return anchor.serverMs + (performance.now() - anchor.perfMs)
}

/** 서버에 한 번 물어 앵커를 다시 잡는다. */
export async function syncClock(): Promise<void> {
  if (syncing) return
  syncing = true
  try {
    const sentAt = performance.now()
    const { serverNowMs } = await GameClient.getTime()
    const receivedAt = performance.now()
    anchor = {
      serverMs: estimateServerNow(sentAt, serverNowMs, receivedAt),
      perfMs: receivedAt,
    }
  } catch {
    // 서버에 닿지 못하면 앵커를 건드리지 않는다. 기존 앵커가 있으면 그대로
    // 쓰고, 없으면 worldNow() 가 로컬 시계로 물러난다.
  } finally {
    syncing = false
  }
}

/**
 * 일반 API 응답 헤더로 받은 서버 시각을 확인한다.
 *
 * 여기서 앵커를 바로 갈아끼우지 않는 이유는 이 값에 왕복 보정이 없기
 * 때문이다. 매 응답마다 앵커를 교체하면 왕복 시간의 흔들림이 그대로 시계
 * 떨림으로 나타난다. 어긋남이 임계값을 넘을 때만 제대로 된 재동기를 부른다.
 */
export function observeServerTime(serverNowMs: number): void {
  if (!anchor) {
    void syncClock()
    return
  }
  if (needsResync(serverNowMs, worldNow())) void syncClock()
}

const PERIODIC_SYNC_MS = 5 * 60 * 1000

/**
 * 시계 동기화를 시작한다. 정리 함수를 돌려준다.
 *
 * 복귀 시 재동기가 가장 중요하다 — 모바일에서 화면이 꺼지면 JS 실행이 멈추고,
 * 그동안 performance.now() 기반 추정이 실제와 벌어질 수 있다.
 */
export function startClockSync(): () => void {
  setServerTimeObserver(observeServerTime)
  void syncClock()

  const onVisible = (): void => {
    if (document.visibilityState === 'visible') void syncClock()
  }
  document.addEventListener('visibilitychange', onVisible)

  const timer = window.setInterval(() => void syncClock(), PERIODIC_SYNC_MS)

  return () => {
    document.removeEventListener('visibilitychange', onVisible)
    window.clearInterval(timer)
    setServerTimeObserver(() => {})
  }
}

/** 테스트·개발용. 앵커를 버려 로컬 시계로 되돌린다. */
export function resetClock(): void {
  anchor = null
}
