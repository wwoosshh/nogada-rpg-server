import type { SpeakerDef } from '@nogada/shared'
import { describe, expect, it } from 'vitest'
import { parseInns } from './inns.js'

/*
 * 여관 등록부 파서(아크 D §2). 상점(parseShops)과 같은 자리의 결정이다 —
 * 값(여관비)의 주인은 inns.csv 이고, 파서가 그 자리에서 거절해야 "영영 못 여는
 * 문"이 조용히 배포되지 않는다. 화자 실재 검사를 validateGameData 로 미루지
 * 않는 이유: 상점은 검증이 맡지만 여관은 파서가 speakers 를 손에 받는다 —
 * 등록부가 한 행짜리라 파서 하나가 파싱과 검증을 다 지는 것이 갈라질 자리를
 * 하나 줄인다(계획 D2: 파서+검증).
 */

const 여관안주인: SpeakerDef = {
  id: '여관안주인',
  name: '여관 안주인',
  kind: 'npc',
  mapId: '눈의마을',
  x: 9,
  y: 14,
  sprite: 'npc_innkeeper',
  facing: 'down',
}

const speakers: Record<string, SpeakerDef> = { 여관안주인 }

function row(over: Record<string, string> = {}): Record<string, string> {
  return { speakerId: '여관안주인', gold: '1500', ...over }
}

describe('parseInns', () => {
  it('한 행이 화자 키의 등록부가 된다', () => {
    expect(parseInns([row()], speakers)).toEqual({
      여관안주인: { speakerId: '여관안주인', gold: 1500 },
    })
  })

  // 왜: 없는 화자를 가리키는 여관은 아무도 못 연다 — talkService 가 화자로
  //     조회하므로(상점의 §6-앞 1 그대로) 그 문은 존재하지 않는 것과 같다.
  //     조용히 구우면 여관비를 정해 놓고 기계가 없던 그 상태로 되돌아간다.
  it('없는 화자를 거절한다', () => {
    expect(() => parseInns([row({ speakerId: '유령여관' })], speakers)).toThrow(/없는 화자/)
  })

  // 왜: gold 0 은 "공짜 여관"이 아니라 값을 안 적은 것과 구별되지 않는 데이터다.
  //     §6 부등식(여관비 ≤ 대기 벌이)은 값이 있어야 성립한다 — innPricing.test
  //     가 재는 그 변이다.
  it('gold 가 1 미만이면 거절한다', () => {
    expect(() => parseInns([row({ gold: '0' })], speakers)).toThrow(/gold/)
  })

  it('gold 가 정수가 아니면 거절한다', () => {
    expect(() => parseInns([row({ gold: '1500.5' })], speakers)).toThrow(/정수가 아니다/)
  })

  // 왜: 한 화자에 두 행이면 어느 값이 그 여관비인지 정해지지 않는다 — 상점의
  //     "한 화자가 두 상점을 열 수 없다"와 같은 규범이다.
  it('같은 화자의 중복 행을 거절한다', () => {
    expect(() => parseInns([row(), row({ gold: '2000' })], speakers)).toThrow(/중복/)
  })
})
