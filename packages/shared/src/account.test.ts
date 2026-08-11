import { describe, expect, it } from 'vitest'
import {
  CreateCharacterRequestSchema,
  LoginRequestSchema,
  PASSWORD_MAX,
  RegisterRequestSchema,
  normalizeUsername,
} from './account.js'
import { APPEARANCES, DEFAULT_APPEARANCE, isAppearance } from './appearance.js'

const register = (username: string, password = 'goodpassword') =>
  RegisterRequestSchema.safeParse({ username, password })

describe('normalizeUsername', () => {
  // 왜: 한글은 같은 글자를 조합형과 완성형 두 바이트열로 적을 수 있다. 정규화
  //     없이 그대로 저장하면 눈에 똑같은 "노가다" 둘이 서로 다른 계정이 되고,
  //     자기 아이디를 정확히 적은 사람이 "없는 계정" 을 본다.
  it('조합형과 완성형 한글을 같은 아이디로 만든다', () => {
    const composed = '노가다'
    const decomposed = composed.normalize('NFD')

    expect(decomposed).not.toBe(composed)
    expect(normalizeUsername(decomposed)).toBe(composed)
  })

  // 왜: 복사·붙여넣기가 앞뒤 공백을 끌고 온다. 그 공백 하나로 로그인이 막히는
  //     것은 사람의 잘못이 아니다.
  it('앞뒤 공백을 떼고 대소문자를 하나로 접는다', () => {
    expect(normalizeUsername('  Nogada  ')).toBe('nogada')
  })
})

describe('RegisterRequestSchema', () => {
  it('영문·숫자·한글 아이디를 받는다', () => {
    expect(register('노가다꾼7').success).toBe(true)
    expect(register('miner').success).toBe(true)
  })

  // 왜: 정규화보다 검사가 먼저면 앞뒤 공백을 붙여 길이 규칙을 피할 수 있다.
  //     "  a  " 는 다듬으면 한 글자다.
  it('길이는 다듬은 뒤의 글자로 센다 — 공백으로 규칙을 피할 수 없다', () => {
    expect(register('  a  ').success).toBe(false)
    expect(register(' 노가다 ').success).toBe(true)
  })

  // 왜: 눈에 보이는 것이 곧 아이디여야 한다. 공백·제로폭 문자가 들어가면
  //     눈으로는 구별할 수 없는 아이디를 둘 만들 수 있다.
  it('공백·기호가 섞인 아이디는 거절한다', () => {
    expect(register('no gada').success).toBe(false)
    expect(register('no​gada').success).toBe(false)
    expect(register('admin!').success).toBe(false)
  })

  it('아이디는 3~16자다', () => {
    expect(register('ab').success).toBe(false)
    expect(register('a'.repeat(17)).success).toBe(false)
  })

  // 왜: 위가 아니라 아래로 막는 이유가 다르다. 짧은 비밀번호는 그 사람이
  //     털리는 것이고, 긴 비밀번호는 서버가 털리는 것이다 — argon2 는 일부러
  //     느린 함수라 길이 제한이 없으면 요청 하나가 CPU 를 통째로 먹는다.
  it('비밀번호는 8자 이상 128자 이하다', () => {
    expect(register('nogada', 'short7!').success).toBe(false)
    expect(register('nogada', 'a'.repeat(PASSWORD_MAX + 1)).success).toBe(false)
  })

  // 왜: 저장할 때 다듬은 것을 로그인할 때 다듬지 않으면 아무도 못 들어온다.
  //     어느 쪽이든 손대는 순간 비밀번호가 두 가지가 된다.
  it('비밀번호의 공백은 건드리지 않는다 — 그것도 비밀번호다', () => {
    const parsed = RegisterRequestSchema.parse({ username: 'nogada', password: '  spaced  ' })
    expect(parsed.password).toBe('  spaced  ')
  })
})

describe('LoginRequestSchema', () => {
  // 왜: 아이디 규칙은 언젠가 조여진다(금지어·길이). 로그인이 가입과 같은 규칙을
  //     들고 있으면 그날 이미 가입한 사람들이 자기 계정에서 잠긴다 — 형식이
  //     아니라 존재가 로그인의 판정이어야 한다.
  it('지금 규칙으로는 가입할 수 없는 옛 아이디도 로그인은 받아 본다', () => {
    expect(LoginRequestSchema.safeParse({ username: 'ab', password: 'x' }).success).toBe(true)
    expect(LoginRequestSchema.safeParse({ username: 'admin!', password: 'x' }).success).toBe(true)
  })

  it('로그인도 같은 정규화를 거친다 — 대문자로 적어도 같은 계정이다', () => {
    const parsed = LoginRequestSchema.parse({ username: ' Nogada ', password: 'x' })
    expect(parsed.username).toBe('nogada')
  })

  // 왜: 길이 상한만은 남긴다. 없으면 로그인 요청 하나가 비밀번호 검증을 그대로
  //     CPU 소모 수단으로 바꾼다.
  it('길이 상한은 로그인에도 남는다', () => {
    const long = { username: 'nogada', password: 'a'.repeat(PASSWORD_MAX + 1) }
    expect(LoginRequestSchema.safeParse(long).success).toBe(false)
  })
})

describe('CreateCharacterRequestSchema', () => {
  const create = (over: Record<string, unknown> = {}) =>
    CreateCharacterRequestSchema.safeParse({
      name: '노가다',
      appearance: DEFAULT_APPEARANCE,
      village: '눈의마을',
      ...over,
    })

  it('이름은 2~12자다', () => {
    expect(create({ name: '한' }).success).toBe(false)
    expect(create({ name: '가'.repeat(13) }).success).toBe(false)
    expect(create({ name: '가'.repeat(12) }).success).toBe(true)
  })

  // 왜: 목록에 없는 외형을 받으면 그릴 시트가 없는 캐릭터가 저장된다 —
  //     클라이언트는 그 순간 검은 사각형이거나 크래시다.
  it('목록에 없는 외형은 거절한다', () => {
    expect(create({ appearance: 'godzilla' }).success).toBe(false)
    for (const appearance of APPEARANCES) expect(create({ appearance }).success).toBe(true)
  })

  // 왜: 어떤 마을이 있는가는 콘텐츠가 정한다. shared 에 마을 이름을 적으면
  //     마을 목록을 아는 곳이 둘이 되고, 마을을 하나 더 그리는 날 갈라진다.
  it('마을은 비어 있지 않은 문자열까지만 본다 — 실재하는지는 서버가 데이터로 본다', () => {
    expect(create({ village: '' }).success).toBe(false)
    expect(create({ village: '아직없는마을' }).success).toBe(true)
  })
})

describe('APPEARANCES', () => {
  it('기본 외형은 목록 안에 있다', () => {
    expect(isAppearance(DEFAULT_APPEARANCE)).toBe(true)
  })

  it('외형 id 는 서로 다르다', () => {
    expect(new Set(APPEARANCES).size).toBe(APPEARANCES.length)
  })
})
