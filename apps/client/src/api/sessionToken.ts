/**
 * 이 기기에 남는 세션 토큰 한 칸.
 *
 * **왜 localStorage 인가:** 쿠키가 아니라 `Authorization: Bearer` 를 쓰기로 한
 * 설계(§3)의 뒷면이다. 헤더에 실으려면 클라이언트가 값을 들고 있어야 하고,
 * 앱을 껐다 켜도 "이어서 하기" 가 되려면 그 값이 살아남아야 한다. XSS 에
 * 노출되는 위험은 설계에서 명시적으로 수용했다(규범 6).
 *
 * **왜 모듈 하나인가:** 토큰을 읽는 곳과 지우는 곳이 갈라지면 로그아웃이
 * 어느 한쪽만 지우게 되고, 지워진 줄 알았던 토큰이 다음 요청에 다시 실린다.
 * 이 파일 밖에서 저장소 키를 아는 곳은 없다.
 */

const KEY = 'nogada.session.token'

/**
 * 저장소에 손대는 모든 길은 조용히 실패한다.
 *
 * 사파리 비공개 모드처럼 localStorage 가 있으면서 쓰면 던지는 환경이 있다.
 * 거기서 던지게 두면 토큰을 저장하지 못한 것이 아니라 **게임이 안 열리는 것**이
 * 되는데, 토큰이 없는 상태는 이미 화면 하나로 다뤄지고 있다(타이틀).
 */
function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function readToken(): string | null {
  try {
    return storage()?.getItem(KEY) ?? null
  } catch {
    return null
  }
}

export function writeToken(token: string): void {
  try {
    storage()?.setItem(KEY, token)
  } catch {
    // 저장하지 못했다 = 이번 실행 동안만 로그인 상태다. 그것도 못 하는 것보다 낫다.
  }
}

export function clearToken(): void {
  try {
    storage()?.removeItem(KEY)
  } catch {
    // 이미 없는 것과 결과가 같다.
  }
}
