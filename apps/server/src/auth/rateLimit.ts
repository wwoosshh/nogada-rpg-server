/**
 * 실패가 쌓이면 기다리게 한다 — 가입·로그인의 무차별 대입을 막는 유일한 장치다.
 *
 * 왜 실패만 세는가: 성공까지 세면 정상적으로 게임하는 사람이 자기 집 IP 에서
 * 막힌다(가족이 같은 공유기를 쓴다). 막아야 하는 것은 "틀리면서 계속 두드리는
 * 것"이라, 세는 것도 그것이어야 한다.
 *
 * **세는 시점은 판정보다 앞이다**(routes/auth.ts). 비밀번호 검증은 argon2 라
 * 수십 ms 가 걸리고, 그 `await` 뒤에서 세면 동시에 들어온 요청들이 전부 `fail`
 * 이전의 표를 보고 통과한다 — 리미터가 세는 것이 "시도 횟수"가 아니라 "왕복
 * 라운드 수"가 된다(동시 128회가 606ms 에 128개 다 통과했다). 그래서 부르는
 * 쪽은 결과를 알기 전에 실패로 세어 두고(선점), 성공하면 `clear` 로 지운다.
 * 정직한 사람에게는 결과가 같고, 동시에 쏟아지는 쪽에게만 다르다.
 *
 * 왜 IP 와 아이디 **둘 다** 인가(설계 규범 6): IP 만 세면 봇넷이 IP 를 바꿔 가며
 * 한 계정을 두드리는 것을 못 막고, 아이디만 세면 아이디를 바꿔 가며 흔한
 * 비밀번호 하나를 전수로 시도하는 것(credential stuffing)을 못 막는다. 서로
 * 다른 공격이라 둘 다 세어야 한다.
 *
 * 단일 인스턴스 가정이다(설계 §3) — 메모리에만 산다. 서버가 여럿이 되는 날
 * 이 표는 공유 저장소로 옮겨야 하고, 그때까지는 그것이 서버를 하나로 두는
 * 이유 중 하나다.
 */

export interface BackoffOptions {
  /** 이 횟수까지는 그냥 다시 시도하게 둔다. 사람은 비밀번호를 두어 번 틀린다. */
  freeAttempts: number
  /** 그 뒤 첫 대기. 실패마다 두 배가 된다. */
  baseDelayMs: number
  /** 대기의 상한. 무한히 늘리면 공유기 하나 뒤의 사람이 영영 못 들어온다. */
  maxDelayMs: number
  /**
   * 표에 담을 열쇠의 최대 수.
   *
   * **유계가 아니면 실패 기록 자체가 공격 수단이다** — 아이디를 매번 새로 지어
   * 실패하면 표가 요청 수만큼 자란다. 넘치면 이미 풀린 것부터 버리고, 그래도
   * 넘치면 가장 오래된 것을 버린다(설계 규범 6).
   */
  maxKeys: number
}

interface Attempt {
  failures: number
  blockedUntil: number
}

export class FailureBackoff {
  private readonly attempts = new Map<string, Attempt>()

  constructor(private readonly options: BackoffOptions) {}

  /** 지금 시도해도 되는가. 0 이면 된다, 아니면 남은 대기(ms). */
  retryAfterMs(key: string, now: number): number {
    const attempt = this.attempts.get(key)
    if (!attempt) return 0
    return Math.max(0, attempt.blockedUntil - now)
  }

  /** 한 번 실패했다. 자유 횟수를 넘기면 그때부터 대기가 두 배씩 늘어난다. */
  fail(key: string, now: number): void {
    const attempt = this.attempts.get(key) ?? { failures: 0, blockedUntil: 0 }
    if (!this.attempts.has(key)) this.makeRoom(now)

    attempt.failures += 1
    const over = attempt.failures - this.options.freeAttempts
    if (over > 0) {
      const delay = Math.min(this.options.baseDelayMs * 2 ** (over - 1), this.options.maxDelayMs)
      attempt.blockedUntil = now + delay
    }

    // 다시 넣어 **삽입 순서를 최신으로** 만든다. 자리가 모자랄 때 버리는 것이
    // 가장 오래 조용했던 열쇠가 되도록.
    this.attempts.delete(key)
    this.attempts.set(key, attempt)
  }

  /**
   * 성공했다 — 기록을 지운다.
   *
   * 지우지 않으면 어제 두어 번 틀린 사람이 오늘 로그인에 성공하고도 다음
   * 실패에서 곧장 긴 대기를 받는다. 세는 것은 "지금 두드리고 있는가"다.
   */
  clear(key: string): void {
    this.attempts.delete(key)
  }

  /** 지금 표에 든 열쇠 수. 유계라는 사실을 밖에서 확인할 수 있어야 한다. */
  get size(): number {
    return this.attempts.size
  }

  private makeRoom(now: number): void {
    if (this.attempts.size < this.options.maxKeys) return

    // 이미 풀린 기록부터 버린다 — 그것을 들고 있어 봐야 아무도 막지 못한다.
    for (const [key, attempt] of this.attempts) {
      if (attempt.blockedUntil <= now) this.attempts.delete(key)
    }

    // 그래도 모자라면 가장 오래된 것을 버린다. 지금 막고 있는 것을 버리는 셈이라
    // 손해지만, 표가 무한히 자라 서버가 죽는 것보다는 낫다.
    while (this.attempts.size >= this.options.maxKeys) {
      const oldest = this.attempts.keys().next()
      if (oldest.done) return
      this.attempts.delete(oldest.value)
    }
  }
}

/**
 * IP 당 백오프. 한 IP 뒤에는 가족이나 PC방이 있을 수 있어 아이디보다 너그럽다.
 *
 * 주의: 키는 `request.ip` 다. 리버스 프록시를 앞에 세우는 날 `trustProxy` 를
 * 실제 토폴로지에 맞춰 켜지 않으면 모든 요청이 프록시 IP 하나로 보여 이 표가
 * 무력해진다(설계 규범 8) — 그날 함께 손봐야 하는 자리다.
 */
export const IP_BACKOFF: BackoffOptions = {
  freeAttempts: 10,
  baseDelayMs: 1_000,
  maxDelayMs: 5 * 60 * 1000,
  maxKeys: 10_000,
}

/** 아이디당 백오프. 한 계정을 두드리는 것은 사람의 실수보다 빨리 수상해진다. */
export const USERNAME_BACKOFF: BackoffOptions = {
  freeAttempts: 5,
  baseDelayMs: 1_000,
  maxDelayMs: 5 * 60 * 1000,
  maxKeys: 10_000,
}

/**
 * IP 당 **가입** 백오프 — 위의 IP_BACKOFF 와 따로 두는 유일한 이유가 하나 있다:
 * **로그인 성공이 이것을 지우면 안 된다.**
 *
 * 로그인은 성공하면 `clear` 로 IP 기록을 통째로 지운다(그래야 오타 두어 번 뒤
 * 들어온 사람이 다음 실패에서 곧장 긴 대기를 받지 않는다). 그런데 가입까지 같은
 * 표에 세면 `가입 → 로그인 → 가입 → 로그인` 을 번갈아 하는 것만으로 그 셈이
 * 매번 0 이 된다 — 자기가 방금 만든 계정으로 로그인하면 되니 공격자에게는
 * 조건도 아니다. 계정이 생기는 것은 실패가 아니라 **자원이 생기는 것**이라,
 * 성공해도 지우지 않는 표가 따로 있어야 한다.
 *
 * 자유 횟수가 IP_BACKOFF 보다 짠 이유: 한 공유기 뒤에서 계정 다섯 개를 잇달아
 * 여는 것은 사람에게도 드문 일이고, 넘겨도 쫓아내지는 않는다 — 상한이 5분이라
 * 그 뒤에는 다시 하나씩 만들 수 있다.
 */
export const SIGNUP_BACKOFF: BackoffOptions = {
  freeAttempts: 5,
  baseDelayMs: 5_000,
  maxDelayMs: 5 * 60 * 1000,
  maxKeys: 10_000,
}
