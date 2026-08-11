import { z } from 'zod'
import { APPEARANCES, isAppearance } from './appearance.js'
import { PlayerStateSchema } from './protocol.js'

/**
 * 계정과 캐릭터 생성의 **입력 규칙**. 게임 규칙이 shared 한 곳에 있는 것과 같은
 * 이유로 여기 있다 — 클라이언트의 입력 화면과 서버의 검증이 서로 다른 규칙을
 * 들고 있으면, 화면이 받아 준 아이디가 서버에서 400 이 되거나 그 반대가 된다.
 *
 * 여기 없는 것: 비밀번호를 어떻게 해시하는가, 토큰을 어떻게 만드는가. 그것은
 * 서버만의 일이고 클라이언트가 알아서 좋을 것이 없다.
 */

/**
 * 아이디를 견주기 전에 한 모양으로 만든다 — **저장할 때도 찾을 때도 이 값이다.**
 *
 * 셋 다 이유가 있다:
 * - `NFC`: 한글은 같은 글자를 조합형과 완성형 두 가지 바이트로 적을 수 있다.
 *   정규화하지 않으면 눈에 똑같은 "노가다" 둘이 서로 다른 계정이 된다.
 * - `trim`: 복사·붙여넣기가 앞뒤 공백을 흔히 끌고 온다. 그 공백 하나 때문에
 *   자기 계정을 못 찾는 것은 사람의 잘못이 아니다.
 * - 소문자화(casefold): "Nogada" 로 가입한 사람이 "nogada" 로 로그인하려 한다.
 *   영문·숫자·한글만 허용하므로 단순 소문자화가 곧 casefold 다.
 */
export function normalizeUsername(raw: string): string {
  return raw.normalize('NFC').trim().toLowerCase()
}

/** 이름을 견주기 전의 정규화. 아이디와 달리 대소문자는 남긴다 — 표시용 이름이다. */
export function normalizeDisplayName(raw: string): string {
  return raw.normalize('NFC').trim()
}

export const USERNAME_MIN = 3
export const USERNAME_MAX = 16

/**
 * 영문·숫자·한글만. 공백과 기호를 막는 이유는 "보이는 것이 곧 아이디"여야 하기
 * 때문이다 — 두 칸 공백이나 제로폭 문자가 들어가면 눈으로는 같은 아이디를
 * 둘 만들 수 있다. 한글은 완성형만 받는다(자모 조합은 NFC 가 이미 합쳐 준다).
 */
const USERNAME_PATTERN = /^[a-z0-9가-힣]+$/

/**
 * 가입할 때의 아이디. **정규화한 뒤에** 길이와 글자를 본다 — 순서가 반대면
 * 앞뒤 공백을 넣어 규칙을 우회할 수 있다.
 */
export const UsernameSchema = z
  .string()
  .transform(normalizeUsername)
  .pipe(z.string().min(USERNAME_MIN).max(USERNAME_MAX).regex(USERNAME_PATTERN))

export const PASSWORD_MIN = 8
/**
 * 위가 아니라 **아래로** 막는 이유: argon2 는 일부러 느린 함수라, 긴 입력을
 * 무제한으로 받으면 요청 하나가 서버 CPU 를 통째로 먹는 수단이 된다(설계 규범 5).
 */
export const PASSWORD_MAX = 128

/**
 * 비밀번호는 **정규화하지 않는다.** 앞뒤 공백도 그 사람이 정한 비밀번호의
 * 일부이고, 저장할 때 지운 것을 로그인할 때 지우지 않으면 아무도 못 들어온다 —
 * 어느 쪽이든 조용히 손대는 순간 비밀번호가 두 가지가 된다.
 */
export const PasswordSchema = z.string().min(PASSWORD_MIN).max(PASSWORD_MAX)

export const RegisterRequestSchema = z.object({
  username: UsernameSchema,
  password: PasswordSchema,
})
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>

/**
 * 로그인은 가입보다 **너그럽게** 받는다.
 *
 * 규칙은 언젠가 조여진다(금지어, 길이 상한). 로그인이 가입과 같은 규칙을 들고
 * 있으면 그날 이미 가입한 사람들이 자기 계정에서 잠긴다 — 형식이 아니라 존재가
 * 로그인의 판정이어야 한다. 그래도 상한은 남긴다: 길이 제한 없는 입력은 비밀번호
 * 해시 검증을 그대로 CPU 소모 수단으로 바꾼다.
 */
export const LoginRequestSchema = z.object({
  username: z.string().max(256).transform(normalizeUsername).pipe(z.string().min(1)),
  password: z.string().min(1).max(PASSWORD_MAX),
})
export type LoginRequest = z.infer<typeof LoginRequestSchema>

/** 토큰 하나. 이것을 `Authorization: Bearer` 에 실으면 그 사람이 된다. */
export const AuthTokenResponseSchema = z.object({ token: z.string().min(1) })
export type AuthTokenResponse = z.infer<typeof AuthTokenResponseSchema>

export const CHARACTER_NAME_MIN = 2
export const CHARACTER_NAME_MAX = 12

/**
 * 캐릭터 이름. **유일하지 않다** — 유일성은 계정 아이디가 담당하고 이것은
 * 표시용이다(설계 §4). 그래서 글자 제한도 아이디보다 느슨하다: 남에게 보이는
 * 이름이지 남이 타이핑해 찾는 이름이 아니다.
 */
export const CharacterNameSchema = z
  .string()
  .transform(normalizeDisplayName)
  .pipe(z.string().min(CHARACTER_NAME_MIN).max(CHARACTER_NAME_MAX))

/**
 * 캐릭터 생성 요청.
 *
 * `village` 는 여기서 "비어 있지 않은 문자열"까지만 본다 — 어떤 마을이 있는가는
 * 콘텐츠(`GameData.maps`)가 정하고, shared 는 packages/data 를 import 할 수 없다.
 * 마을 이름을 여기 적으면 마을 목록을 아는 곳이 둘이 되고, 마을을 하나 더 그리는
 * 날 갈라진다. 서버가 데이터에서 유도한 목록으로 막는다.
 */
export const CreateCharacterRequestSchema = z.object({
  name: CharacterNameSchema,
  appearance: z.string().refine(isAppearance, {
    message: `외형은 ${APPEARANCES.join('·')} 중 하나여야 한다`,
  }),
  village: z.string().min(1),
})
export type CreateCharacterRequest = z.infer<typeof CreateCharacterRequestSchema>

/**
 * 캐릭터 삭제 요청 — 지울 캐릭터의 **이름을 직접 타이핑**해야 한다(설계 규범 7).
 *
 * 슬롯이 하나뿐이라 삭제가 없으면 잘못 고른 외형·마을이 영구히 갇힌다. 그렇다고
 * 버튼 하나로 지우면 수십 시간이 오타 하나에 사라진다 — 이름을 적게 하는 것이
 * 그 둘 사이의 답이다.
 */
export const DeleteCharacterRequestSchema = z.object({ confirmName: z.string() })
export type DeleteCharacterRequest = z.infer<typeof DeleteCharacterRequestSchema>

/**
 * 내 캐릭터. **없으면 null 이다** — 없다는 사실이 곧 "캐릭터를 만들어야 한다"는
 * 화면 분기라, 404 가 아니라 값으로 답한다(설계 §5 의 부팅 흐름).
 */
export const MeResponseSchema = z.object({ character: PlayerStateSchema.nullable() })
export type MeResponse = z.infer<typeof MeResponseSchema>
