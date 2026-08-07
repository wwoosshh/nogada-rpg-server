import { estimateServerNow, needsResync } from '@nogada/shared'
import { GameClient, setServerTimeObserver } from '../api/GameClient.js'

interface Anchor {
  /** 앵커를 잡은 순간의 서버 시각 추정값 */
  serverMs: number
  /** 같은 순간의 performance.now() */
  perfMs: number
}

let anchor: Anchor | null = null
/** 진행 중인 동기화. 동시 호출자는 새 요청을 내지 않고 이것을 함께 기다린다. */
let inFlight: Promise<boolean> | null = null

/**
 * 세계 시각.
 *
 * 앵커가 없으면 로컬 시계로 물러난다. 이건 **최초 동기화 전** 상태이지 오프라인
 * 모드가 아니다 — 서버에 닿지 못하면 접속 게이트가 게임 진입 자체를 막으므로,
 * 이 폴백값이 실제 플레이 중에 쓰이는 일은 없다.
 *
 * 경과를 Date.now() 가 아니라 performance.now() 로 재는 이유는 세션 도중
 * 사용자가 기기 시계를 바꿔도 세계 시각이 튀지 않게 하기 위해서다.
 *
 * 단조 증가하지 않는다 — 재동기화가 앵커를 새 왕복 추정치로 통째로 갈아끼우므로,
 * 재동기 직후 값이 최대 재동기 임계값만큼 뒤로 튈 수 있다. 시간을 판정하는 로직은
 * 전부 서버 쪽에 있으므로 무해하다.
 */
export function worldNow(): number {
  if (!anchor) return Date.now()
  return anchor.serverMs + (performance.now() - anchor.perfMs)
}

/**
 * 동기화 요청 하나가 버틸 수 있는 최대 시간.
 *
 * fetch 는 연결은 됐지만 응답이 영영 오지 않는 상황(모바일 네트워크·사내망에서
 * 흔하다)에는 스스로 실패하지 않고 그냥 멈춰 있는다. 타임아웃이 없으면 그런
 * 요청 하나가 syncing 을 영원히 true 로 묶어놓고, 그 뒤로는 주기 재동기·화면
 * 복귀 재동기·어긋남 감지 재동기가 전부 조용히 아무것도 안 하게 된다.
 */
const SYNC_TIMEOUT_MS = 10_000

/**
 * 서버에 한 번 물어 앵커를 다시 잡는다. 성공 여부를 돌려준다.
 *
 * 이미 진행 중이면 **그 요청을 함께 기다린다.** 그냥 false 로 빠지면 안 되는데,
 * 접속 게이트가 이 반환값으로 서버 연결 여부를 판단하기 때문이다 — 다른 곳에서
 * 먼저 시작한 동기화와 겹쳤을 뿐인데 "서버에 못 닿았다" 로 읽히면 멀쩡한 상태에서
 * 게임 진입이 막힌다.
 */
export function syncClock(): Promise<boolean> {
  if (inFlight) return inFlight
  inFlight = runSync().finally(() => {
    inFlight = null
  })
  return inFlight
}

async function runSync(): Promise<boolean> {
  try {
    const sentAt = performance.now()
    const { serverNowMs } = await GameClient.getTime(AbortSignal.timeout(SYNC_TIMEOUT_MS))
    const receivedAt = performance.now()
    anchor = {
      serverMs: estimateServerNow(sentAt, serverNowMs, receivedAt),
      perfMs: receivedAt,
    }
    return true
  } catch {
    // 서버에 닿지 못하거나(타임아웃 포함) 요청이 중단됐으면 앵커를 건드리지 않는다.
    // 기존 앵커가 있으면 그대로 쓴다.
    return false
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

/**
 * 테스트·개발용. 앵커를 버려 최초 동기화 전 상태로 되돌린다.
 *
 * 진행 중인 동기화는 취소하지 않으므로, 리셋 직후 그 요청이 끝나면 앵커가 다시
 * 채워질 수 있다.
 */
export function resetClock(): void {
  anchor = null
}
