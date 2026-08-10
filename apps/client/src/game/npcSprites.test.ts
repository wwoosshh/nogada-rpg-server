import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { npcSprite, npcSpriteKey } from './npcSprites.js'

describe('npcSprite', () => {
  it('이름을 파일과 종류로 푼다', () => {
    // 이 함수가 하는 일 전부다 — 데이터는 이름만 나르고, 그것이 어느 파일인지는
    // 클라이언트만 안다(그 파일 문서 참고).
    expect(npcSprite('npc_elder')).toEqual({ file: 'npc_elder.png', kind: 'char' })
  })

  it('안내판은 방향 없는 한 장짜리다', () => {
    // kind 가 갈리는 것이 이 목록의 존재 이유다. 간판을 캐릭터 시트로 읽으면
    // 로더가 96x128 을 기대하다가 32x64 를 받아 프레임이 통째로 어긋난다.
    expect(npcSprite('sign_wood').kind).toBe('static')
  })

  it('모르는 이름은 그 자리에서 던진다 — 이름과 고칠 파일을 함께 말하면서', () => {
    // 대체 그림으로 조용히 넘어가면 오타 하나가 "그 화자만 남의 얼굴로 나온다"가
    // 되고, 그건 화면만 봐서는 의도한 것과 구별되지 않는다.
    expect(() => npcSprite('npc_ghost')).toThrow(/npc_ghost/)
    expect(() => npcSprite('npc_ghost')).toThrow(/npcSprites\.ts/)
  })

  it('오류가 아는 이름들을 함께 알려 준다', () => {
    // 오타를 냈을 때 알고 싶은 것은 "무엇이 틀렸나"가 아니라 "그럼 뭐라고 써야
    // 하나"다. 목록이 짧으므로 그 자리에서 다 보여 주는 편이 파일을 열어 보라고
    // 말하는 것보다 빠르다.
    expect(() => npcSprite('sign_stone')).toThrow(/sign_wood/)
  })

  it('로더 키에 종류를 앞에 붙인다', () => {
    // 타일셋 키는 이름 그대로라(WorldScene.preload 의 TILESET_NAMES) 접두사가
    // 없으면 언젠가 같은 이름의 타일셋과 한 캐시 칸을 다툰다.
    expect(npcSpriteKey('npc_elder')).toBe('npc:npc_elder')
  })

  it('speakers.csv 가 쓰는 sprite 이름을 전부 안다', () => {
    // 이 목록이 실제로 출하되는 데이터와 어긋나면 그 화자는 게임에서 던지고
    // 맵 전체가 안 뜬다. 빌드는 이 이름을 검사하지 않으므로(npcSprites.ts 문서)
    // 그 어긋남을 잡는 자리가 여기뿐이다.
    const here = dirname(fileURLToPath(import.meta.url))
    const csv = readFileSync(
      join(here, '..', '..', '..', '..', 'packages', 'data', 'csv', 'speakers.csv'),
      'utf8',
    )
    const [header, ...rows] = csv.trim().split(/\r?\n/)
    const spriteColumn = header!.split(',').indexOf('sprite')
    expect(spriteColumn).toBeGreaterThanOrEqual(0)

    for (const row of rows) {
      const sprite = row.split(',')[spriteColumn]!
      expect(() => npcSprite(sprite)).not.toThrow()
    }
  })
})
