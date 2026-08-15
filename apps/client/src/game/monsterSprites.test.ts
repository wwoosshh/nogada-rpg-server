import { describe, expect, it } from 'vitest'
import { monsterSpriteFile, monsterSpriteKey } from './monsterSprites.js'

/*
 * 몬스터 스프라이트 목록 — nodeSprites·npcSprites 와 같은 자리의 매니페스트다.
 * C6 이 Enemy 몽타주에서 눈으로 골라 채우기 전까지 비어 있고, 그동안의 계약은
 * "모르는 이름이면 조용히 넘어가지 않고 던진다" 하나다.
 */

describe('monsterSpriteFile — 모르는 이름은 그 자리에서 던진다', () => {
  // 왜: 대체 그림을 내주면 오타 하나가 "그 몬스터만 다른 그림으로 선다"가 되고,
  //     그건 화면만 봐서는 의도와 구별되지 않는다 — nodeSprites 와 같은 자세다.
  it('등록되지 않은 몬스터는 고칠 곳을 말하며 던진다', () => {
    expect(() => monsterSpriteFile('unknown_wolf')).toThrow(/monsterSprites\.ts/)
  })
})

describe('monsterSpriteKey — 로더 키에 종류 접두사를 단다', () => {
  // 왜: 타일셋 키는 이름 그대로라, 접두사가 없으면 언젠가 같은 이름의 타일셋과
  //     한 캐시 칸을 다툰다 — node:·npc: 와 같은 규칙이다.
  it('monster: 접두사를 단다', () => {
    expect(monsterSpriteKey('wolf')).toBe('monster:wolf')
  })
})
