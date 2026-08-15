import { loadGameData } from '@nogada/data'
import { describe, expect, it } from 'vitest'
import { monsterSpriteFile, monsterSpriteKey } from './monsterSprites.js'

/*
 * 몬스터 스프라이트 목록 — nodeSprites·npcSprites 와 같은 자리의 매니페스트다.
 * 계약은 둘이다: "모르는 이름이면 조용히 넘어가지 않고 던진다", 그리고
 * "gamedata 의 모든 배치가 아는 그림을 가리킨다"(대장·파일·CSV 삼각 대조).
 */

describe('monsterSpriteFile — 모르는 이름은 그 자리에서 던진다', () => {
  // 왜: 대체 그림을 내주면 오타 하나가 "그 몬스터만 다른 그림으로 선다"가 되고,
  //     그건 화면만 봐서는 의도와 구별되지 않는다 — nodeSprites 와 같은 자세다.
  it('등록되지 않은 몬스터는 고칠 곳을 말하며 던진다', () => {
    expect(() => monsterSpriteFile('unknown_wolf')).toThrow(/monsterSprites\.ts/)
  })
})

describe('monsterSprites — gamedata 와의 삼각 대조', () => {
  // 왜: 배치는 데이터(packages/data)에, 그림 목록은 여기(클라이언트)에 있어서
  //     어느 한쪽만으로는 결손을 알 수 없다 — itemIcons 가 CREDITS 와 CSV 를
  //     맞대는 것과 같은 자리다. def 가 배치별로 구워지므로 monsterId 는
  //     instanceId 이고, 이 목록의 키도 그것이다.
  it('gamedata 의 모든 배치가 아는 그림을 가리킨다', () => {
    const placements = Object.values(loadGameData().monsterPlacements)
    expect(placements.length, '몬스터 배치가 하나도 없다 — C6 의 CSV 가 실렸는가').toBeGreaterThan(0)
    for (const placement of placements) {
      expect(() => monsterSpriteFile(placement.monsterId), placement.instanceId).not.toThrow()
    }
  })
})

describe('monsterSpriteKey — 로더 키에 종류 접두사를 단다', () => {
  // 왜: 타일셋 키는 이름 그대로라, 접두사가 없으면 언젠가 같은 이름의 타일셋과
  //     한 캐시 칸을 다툰다 — node:·npc: 와 같은 규칙이다.
  it('monster: 접두사를 단다', () => {
    expect(monsterSpriteKey('wolf')).toBe('monster:wolf')
  })
})
