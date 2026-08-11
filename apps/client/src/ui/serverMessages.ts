import { ApiError, NETWORK_ERROR } from '../api/GameClient.js'

/**
 * 서버가 돌려준 코드를 사람이 읽는 한 줄로 옮긴다.
 *
 * **왜 서버가 한국어를 보내지 않는가:** 서버의 코드는 화면이 무엇을 할지
 * 고르는 값이지 화면에 그대로 찍을 글이 아니다. 같은 `bad_request` 라도
 * 가입 화면에서는 "아이디나 비밀번호가 규칙에 맞지 않습니다" 이고 캐릭터
 * 생성 화면에서는 "이름이나 외형이 규칙에 맞지 않습니다" 다 — 그 차이는
 * 요청을 보낸 화면만 안다.
 *
 * **왜 한 파일인가:** 화면마다 문구를 지으면 같은 코드가 화면마다 다른 말을
 * 하게 된다. 여기서 화면별 예외만 인자로 받고 나머지는 공통으로 답한다.
 */

/** 어느 화면에서 물었는지에 따라 달라지는 문구. 나머지는 아래 공통표가 답한다. */
export type MessageOverrides = Readonly<Record<string, string>>

/**
 * 서버와 **말 자체를 못 했다.**
 *
 * 상수로 빼 두는 이유는 시계 동기 실패에는 ApiError 가 없기 때문이다
 * (clock.syncClock 은 참·거짓만 돌려준다) — 같은 사실을 두 곳에서 다른
 * 문장으로 말하지 않으려면 문장이 한 곳에 있어야 한다.
 */
export const SERVER_UNREACHABLE = '서버에 연결하지 못했습니다.'

const COMMON: Readonly<Record<string, string>> = {
  // 서버가 셋을 나누지 않는다 — 없는 아이디와 틀린 비밀번호를 구별해 말하면
  // 그 둘을 세는 것만으로 실재하는 아이디 목록을 만들 수 있기 때문이다
  // (서버 routes/auth.ts 의 INVALID_CREDENTIALS 문서). 화면도 나누지 않는다.
  invalid_credentials: '아이디 또는 비밀번호가 맞지 않습니다.',
  username_taken: '이미 쓰이고 있는 아이디입니다.',
  too_many_attempts: '시도가 너무 잦습니다. 잠시 뒤에 다시 해 주세요.',
  bad_request: '입력이 규칙에 맞지 않습니다.',
  unknown_village: '고를 수 없는 마을입니다.',
  name_mismatch: '캐릭터 이름과 다릅니다.',
  no_character: '캐릭터가 없습니다.',
  // 서버가 세이브를 읽지 못했다는 뜻이다(설계 규범 2). 행은 지워지지 않았으므로
  // "사라졌다" 고 말하지 않는다 — 사람이 보고 고칠 수 있는 상태다.
  character_unreadable: '저장된 캐릭터를 읽지 못했습니다. 잠시 뒤에 다시 시도해 주세요.',
  unauthorized: '로그인이 만료되었습니다.',
  [NETWORK_ERROR]: SERVER_UNREACHABLE,
}

/**
 * 실패 하나를 화면에 띄울 한 줄로 만든다.
 *
 * 모르는 코드에도 코드 자체를 붙여 보여준다 — 숨기면 사용자는 "무언가 잘못됐다"
 * 만 보고, 우리는 그 화면 사진만으로는 무엇이 잘못됐는지 알 수 없다.
 */
export function describeServerError(err: unknown, overrides: MessageOverrides = {}): string {
  if (!(err instanceof ApiError)) return '알 수 없는 오류가 일어났습니다.'
  return overrides[err.code] ?? COMMON[err.code] ?? `오류가 일어났습니다 (${err.code})`
}
