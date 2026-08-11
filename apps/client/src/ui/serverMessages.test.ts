import { describe, expect, it } from 'vitest'
import { ApiError, NETWORK_ERROR } from '../api/GameClient.js'
import { describeServerError } from './serverMessages.js'

describe('describeServerError', () => {
  it('로그인 실패는 아이디와 비밀번호를 나눠 말하지 않는다', () => {
    // 서버가 둘을 한 코드로 답하는 이유(타이밍·응답 열거 방지)를 화면이
    // 되돌리면 안 된다 — "없는 아이디입니다" 라고 친절하게 적는 순간, 그
    // 친절이 곧 계정 목록을 만드는 도구가 된다.
    const message = describeServerError(new ApiError('invalid_credentials'))
    expect(message).toContain('아이디 또는 비밀번호')
  })

  it('화면마다 다른 뜻인 코드는 그 화면이 덮어쓴다', () => {
    // bad_request 하나가 가입 화면과 캐릭터 생성 화면에서 서로 다른 입력을
    // 가리킨다. 공통표가 그 차이를 알 수 없으므로 화면이 준 문구가 이긴다.
    const message = describeServerError(new ApiError('bad_request'), {
      bad_request: '이름이 2~12자가 아닙니다.',
    })
    expect(message).toBe('이름이 2~12자가 아닙니다.')
  })

  it('서버에 닿지 못한 것도 같은 통로로 말한다', () => {
    // 네트워크 실패는 HTTP 코드가 아니지만 화면 입장에서는 똑같이 "이번 시도가
    // 안 됐다" 이다. 별도 분기를 화면마다 두면 그 분기를 빠뜨린 화면이 아무
    // 말도 없이 멈춘 것처럼 보인다.
    expect(describeServerError(new ApiError(NETWORK_ERROR))).toContain('서버에 연결하지 못했습니다')
  })

  it('모르는 코드는 코드를 함께 보여준다', () => {
    // 감추면 화면 사진 한 장으로는 무엇이 잘못됐는지 알 수 없다. 서버가 새
    // 코드를 내놓은 날, 그 사실이 사용자의 화면에서 먼저 드러나야 한다.
    expect(describeServerError(new ApiError('teapot'))).toContain('teapot')
  })

  it('ApiError 가 아닌 것도 화면을 비우지 않는다', () => {
    // 스토어의 어떤 경로든 여기로 흘러올 수 있다. 그때 undefined 를 돌려주면
    // 오류 칸이 비어 버려서, 실패했다는 사실 자체가 화면에서 사라진다.
    expect(describeServerError(new TypeError('boom'))).not.toBe('')
  })
})
