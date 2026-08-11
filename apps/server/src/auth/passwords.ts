import { randomBytes } from 'node:crypto'
import { Algorithm, hash, verify } from '@node-rs/argon2'

/**
 * 비밀번호를 해시하고 견주는 한 곳.
 *
 * 라이브러리가 `@node-rs/argon2` 인 이유는 개발이 윈도이고 배포가 리눅스이기
 * 때문이다 — 양쪽에 프리빌드 바이너리가 있어야 "내 PC 에서만 되는" 서버가 되지
 * 않는다(설계 규범 5).
 */

/**
 * argon2id 파라미터 — **코드에 고정한다.**
 *
 * 왜 고정하는가: 해시 문자열 안에 파라미터가 함께 적히므로 이미 저장된 해시는
 * 여기 값이 바뀌어도 그대로 검증된다. 그러나 새로 만드는 해시의 세기는 이 세
 * 숫자가 전부라, 환경 변수로 빼 두면 배포 한 번의 실수가 조용히 모든 새 계정을
 * 약하게 만든다.
 *
 * 값은 OWASP 의 argon2id 권장 조합 하나다(m=19MiB, t=2, p=1). 메모리를 19MiB 로
 * 잡는 것이 요점이다 — GPU 로 병렬 추측하는 쪽을 비싸게 만드는 것은 시간이
 * 아니라 메모리다. 이 조합에서 해시 한 번이 개발 PC 기준 20ms 안쪽이라, 로그인
 * 한 번의 값으로 감당할 수 있다.
 */
const ARGON2ID = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2ID)
}

/**
 * 비밀번호가 맞는가.
 *
 * 저장된 해시가 argon2 문자열이 아니면(자료가 어긋났거나 손으로 심은 행) 검증이
 * 던진다. 그것을 그대로 500 으로 올리지 않고 "틀렸다"로 답하는 이유: 로그인
 * 실패는 단일한 답이어야 하고(규범 6), 500 은 그 계정이 특별하다는 것을 밖에서
 * 알려 주는 신호가 된다. 대신 로그에는 남긴다 — 사람이 볼 일이다.
 */
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password, ARGON2ID)
  } catch (error) {
    console.error(`저장된 비밀번호 해시를 읽을 수 없다: ${String(error)}`)
    return false
  }
}

/**
 * **없는 계정에도 같은 시간을 쓴다**(설계 규범 6).
 *
 * 없는 아이디에는 검증을 건너뛰고 바로 실패로 답하면, 응답이 돌아오는 시간만으로
 * "이 아이디는 있다/없다"를 셀 수 있다 — 사전을 돌려 실재하는 아이디 목록을
 * 만들 수 있고, 그다음은 그 목록에만 힘을 쓰면 된다. 그래서 아무도 모르는
 * 비밀번호의 해시를 하나 만들어 두고, 없는 계정일 때는 그것을 검증한다.
 *
 * 해시를 모듈이 열릴 때 한 번만 만드는 이유는 그 비용(20ms)이 요청마다 두 번
 * 드는 것을 막기 위해서다. 값은 매 기동마다 다른 무작위라 아무 비밀번호도
 * 이것을 통과하지 못한다.
 */
const dummyHash = hashPassword(randomBytes(32).toString('hex'))

export async function verifyAgainstNobody(password: string): Promise<false> {
  await verifyPassword(await dummyHash, password)
  return false
}
