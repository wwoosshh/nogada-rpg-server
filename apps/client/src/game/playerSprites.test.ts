import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { APPEARANCES, DEFAULT_APPEARANCE } from '@nogada/shared'
import { describe, expect, it } from 'vitest'
import { playerSprite, playerSpriteKey } from './playerSprites.js'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..', '..')

describe('playerSprite', () => {
  // 왜: 설계 규범 4 가 이 대조를 명시적으로 요구한다. 서버는 APPEARANCES 에
  //     있으면 저장을 받아주는데, 매니페스트에 없으면 그 캐릭터는 저장은 됐지만
  //     그릴 그림이 없다 — 다음 로그인에서 세계가 통째로 안 뜬다.
  it('고를 수 있는 외형이 전부 그림으로 풀린다', () => {
    for (const id of APPEARANCES) {
      expect(() => playerSprite(id), `외형 "${id}"`).not.toThrow()
    }
  })

  // 왜: 반대 방향이다. 매니페스트에만 있는 외형은 화면에 뜨지도 서버가 받지도
  //     않는 죽은 칸이라, 그 파일이 왜 public/sprites 에 있는지 아무도 모르게 된다.
  it('매니페스트에 목록 밖의 외형이 남아 있지 않다', () => {
    const known = APPEARANCES.map((id) => playerSprite(id).file)
    expect(new Set(known).size).toBe(APPEARANCES.length)
  })

  // 왜: 두 외형이 같은 파일을 가리키면 고르는 화면에 똑같은 그림이 두 칸 뜬다 —
  //     고른 사람은 자기가 무엇을 고른 것인지 알 수 없다.
  it('외형마다 서로 다른 시트다', () => {
    const files = APPEARANCES.map((id) => playerSprite(id).file)
    expect(new Set(files).size).toBe(files.length)
  })

  // 왜: 이름이 같으면 화면에서 구별할 방법이 그림뿐인데, 32px 그림 둘을 이름
  //     없이 구별하라는 것은 고르라는 것이 아니다.
  it('외형마다 서로 다른 이름이다', () => {
    const labels = APPEARANCES.map((id) => playerSprite(id).label)
    expect(new Set(labels).size).toBe(labels.length)
  })

  // 왜: 옛 세이브에는 이 필드가 아예 없고 스키마가 이 값으로 채운다. 그 값이
  //     매니페스트에 없으면 계정이 생기기 전의 캐릭터가 전부 못 뜬다.
  it('기본 외형도 그림으로 풀린다', () => {
    expect(() => playerSprite(DEFAULT_APPEARANCE)).not.toThrow()
  })

  // 왜: 대체 그림으로 조용히 넘어가면 플레이어는 자기가 고른 외형이 아닌 것으로
  //     계속 플레이하면서도 그 사실을 알 방법이 없다 — 늘 화면 한가운데 있어서
  //     "원래 저렇게 생겼나" 로 넘어간다.
  it('모르는 외형은 그 자리에서 던진다 — 이름과 고칠 파일을 함께 말하면서', () => {
    expect(() => playerSprite('없는외형')).toThrow(/없는외형/)
    expect(() => playerSprite('없는외형')).toThrow(/playerSprites\.ts/)
    expect(() => playerSprite('없는외형')).toThrow(/APPEARANCES/)
  })

  // 왜: 접두사가 없으면 언젠가 같은 이름의 타일셋·화자 시트와 한 캐시 칸을 다툰다.
  it('로더 키에 종류를 앞에 붙인다', () => {
    expect(playerSpriteKey('blue_hat')).toBe('player:blue_hat')
  })

  // 왜: 그림 파일은 저장소에 없고 CREDITS.md 의 레시피로만 복원된다. 그 표에
  //     빠진 외형은 다른 PC 에서 빈 그림으로 나오고, 그건 빌드도 테스트도
  //     잡아주지 않는다 — 이 대조가 유일한 관문이다.
  it('CREDITS.md 의 복원 레시피가 모든 외형을 적어 두었다', () => {
    const credits = readFileSync(join(repoRoot, 'assets', 'CREDITS.md'), 'utf8')
    for (const id of APPEARANCES) {
      expect(credits, `외형 "${id}"`).toContain(id)
    }
  })
})
