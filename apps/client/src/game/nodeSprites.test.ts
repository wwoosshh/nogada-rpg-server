import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadGameData } from '@nogada/data'
import { describe, expect, it } from 'vitest'
import { NODE_SPRITE_IDS, nodeSpriteFile, nodeSpriteKey } from './nodeSprites.js'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..', '..')

/** `nodes.csv` 가 실제로 부르는 이름들. 노드 정의가 아니라 **부르는 이름**이 대조의 축이다. */
function csvSpriteNames(): string[] {
  return Object.values(loadGameData().nodes).map((node) => node.sprite)
}

/**
 * CREDITS.md 의 "노드 스프라이트 대장" 절만 잘라 낸다.
 *
 * 문서 전체에서 표를 찾으면 플레이어 외형 대장·화자 대장의 행(`| \`player\` |
 * \`player.png\` | ...`)이 모양이 같아 함께 걸린다 — 그러면 이 테스트는 노드가
 * 아닌 것을 노드로 세고, 노드 하나가 빠져도 다른 표의 행이 수를 맞춰 준다.
 */
function creditsNodeSection(): string {
  const credits = readFileSync(join(repoRoot, 'assets', 'CREDITS.md'), 'utf8')
  const after = credits.split('### 노드 스프라이트 대장')[1]
  if (!after) throw new Error('CREDITS.md 에 "### 노드 스프라이트 대장" 절이 없다')
  return after.split('\n### ')[0]!
}

/**
 * 대장 표를 id→파일 로 읽는다. `toContain` 부분 문자열 검사를 쓰지 않는 것은
 * itemIcons.test.ts 와 같은 이유다 — `ice_vein` 은 `deep_ice_vein` 의 부분
 * 문자열이라, 얼음 보통 등급이 표에서 통째로 빠져도 심층 행이 대신 통과시킨다.
 */
function creditsNodeLedger(): Map<string, string> {
  const ledger = new Map<string, string>()
  for (const line of creditsNodeSection().split('\n')) {
    const match = /^\|\s*`([a-z_]+)`\s*\|\s*`([a-z_]+\.png)`\s*\|/.exec(line.trim())
    if (match) ledger.set(match[1]!, match[2]!)
  }
  return ledger
}

describe('노드 스프라이트 — nodes.csv · 매니페스트 · CREDITS 대장 삼자 대조', () => {
  // 왜: 데이터는 이름만 나르고 그 이름이 어느 파일인지는 클라이언트가 안다.
  //     매니페스트에 없는 이름을 CSV 가 부르면 그 노드가 선 맵은 preload 에서
  //     통째로 서고, 그 사실은 그 채집장에 걸어 들어가야만 드러난다.
  it('nodes.csv 가 부르는 이름이 전부 그림으로 풀린다', () => {
    for (const name of csvSpriteNames()) {
      expect(() => nodeSpriteFile(name), `sprite "${name}"`).not.toThrow()
    }
  })

  // 왜: 반대 방향이다. 아무 노드도 안 부르는 칸은 복원 명령만 늘리고 화면에는
  //     영영 안 뜨는 그림이라, 그 파일이 왜 public/nodes 에 있는지 아무도 모르게 된다.
  it('매니페스트에 어느 노드도 부르지 않는 칸이 남아 있지 않다', () => {
    const called = new Set(csvSpriteNames())
    for (const id of NODE_SPRITE_IDS) {
      expect(called.has(id), `매니페스트의 "${id}"`).toBe(true)
    }
  })

  // 왜: 이 아크의 값 전부가 "같은 계열의 보통과 심층이 한눈에 갈린다" 하나다.
  //     두 id 가 같은 파일을 가리키면 캡션 말고는 구별할 것이 없어져, 색칠한
  //     네모였던 시절로 되돌아간다.
  it('id 마다 서로 다른 그림 파일이다', () => {
    const files = NODE_SPRITE_IDS.map((id) => nodeSpriteFile(id))
    expect(new Set(files).size).toBe(files.length)
  })

  // 왜: 대체 그림을 내주면 오타 하나가 "그 노드만 다른 그림"이 되는데, 그건
  //     화면만 봐서는 의도한 것과 구별되지 않아 몇 주씩 산다(npcSprites.ts).
  //     그래서 던지되, 고칠 자리 둘을 문구가 함께 말한다.
  it('모르는 id 는 그 자리에서 던진다 — 고칠 파일 둘을 함께 말하면서', () => {
    expect(() => nodeSpriteFile('없는노드')).toThrow(/없는노드/)
    expect(() => nodeSpriteFile('없는노드')).toThrow(/nodeSprites\.ts/)
    expect(() => nodeSpriteFile('없는노드')).toThrow(/nodes\.csv/)
  })

  // 왜: 접두사가 없으면 `young_tree` 라는 타일셋·화자 시트가 생기는 날 한 캐시
  //     칸을 다툰다 — 먼저 올라간 쪽이 이기고, 진 쪽은 남의 그림으로 뜬다.
  it('로더 키에 종류를 앞에 붙인다', () => {
    expect(nodeSpriteKey('ice_vein')).toBe('node:ice_vein')
  })

  // 왜: 그림 파일은 저장소에 없다(Pipoya 재배포 금지 → gitignore). 대장 표에서
  //     빠지거나 파일 이름이 어긋난 id 는 다른 PC 에서 빈 그림이 되고, 빌드도
  //     타입도 그것을 못 잡는다 — 이 대조가 유일한 관문이다.
  it('CREDITS.md 의 대장 표가 매니페스트와 똑같은 id→파일 을 적어 두었다', () => {
    const ledger = creditsNodeLedger()
    const manifest = new Map(NODE_SPRITE_IDS.map((id) => [id, nodeSpriteFile(id)]))
    expect(Object.fromEntries(ledger)).toEqual(Object.fromEntries(manifest))
  })

  // 왜: 표에 적혀 있어도 복원 명령이 그 파일을 안 만들면 결과는 같다 — 새
  //     환경에서 그 노드만 빈 그림이다. 표와 명령은 CREDITS 안에서도 서로 다른
  //     두 곳이라, 한쪽만 고치는 일이 실제로 일어난다.
  it('CREDITS.md 의 복원 명령이 열두 장을 전부 만든다', () => {
    const section = creditsNodeSection()
    for (const id of NODE_SPRITE_IDS) {
      expect(section, `복원 명령의 "${id}"`).toContain(`$N/${nodeSpriteFile(id)}`)
    }
  })
})
