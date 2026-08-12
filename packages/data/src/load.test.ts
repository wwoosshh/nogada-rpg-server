import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadGameData } from './load.js'
import { loadGatherTables } from './loadGatherTables.js'
import { parseCsv, parseItems, parseNodes, parseRecipes } from './parse.js'
import { validateGameData } from './validate.js'

/**
 * validate.test.ts 는 CSV 를 다시 파싱한 결과만 검증했다 — 서버가 실제로 로드하는
 * 산출물(generated/gamedata.json)은 어떤 테스트도 건드리지 않았다. 빌드가 실패해도
 * 이전 gamedata.json 이 그대로 남으므로, 이 테스트가 없으면 스테일 아티팩트를 잡을
 * 방법이 없다.
 */
describe('loadGameData', () => {
  it('빌드된 아티팩트는 검증을 통과한다', () => {
    // 표도 같은 빌드가 구운 산출물(gather-tables.json)이다 — 스테일 감지의 대상이
    // gamedata.json 하나에서 두 산출물의 짝으로 넓어진다.
    expect(validateGameData(loadGameData(), loadGatherTables())).toEqual([])
  })

  it('빌드된 아티팩트의 id 집합이 CSV 를 직접 파싱한 결과와 일치한다', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const csvDir = join(here, '..', 'csv')
    const readRealCsv = (name: string) => parseCsv(readFileSync(join(csvDir, name), 'utf8'))

    const fromCsv = {
      items: parseItems(readRealCsv('items.csv')),
      nodes: parseNodes(readRealCsv('nodes.csv')),
      recipes: parseRecipes(readRealCsv('recipes.csv')),
    }
    const loaded = loadGameData()

    expect(new Set(Object.keys(loaded.items))).toEqual(new Set(Object.keys(fromCsv.items)))
    expect(new Set(Object.keys(loaded.nodes))).toEqual(new Set(Object.keys(fromCsv.nodes)))
    expect(new Set(Object.keys(loaded.recipes))).toEqual(new Set(Object.keys(fromCsv.recipes)))
  })

  it('반환값은 깊이 동결되어 있어 변형 시도가 프로세스 전역 상태를 오염시키지 않고 즉시 실패한다', () => {
    const data = loadGameData()

    expect(Object.isFrozen(data)).toBe(true)
    expect(Object.isFrozen(data.items)).toBe(true)

    const anyItemId = Object.keys(data.items)[0]!
    expect(Object.isFrozen(data.items[anyItemId])).toBe(true)

    const anyRecipeId = Object.keys(data.recipes)[0]!
    const recipe = data.recipes[anyRecipeId]!
    expect(Object.isFrozen(recipe.inputs)).toBe(true)
    expect(Object.isFrozen(recipe.output)).toBe(true)

    // 반환 타입은 그대로 GameData 다(컴파일 타임 readonly 가 아니다) — 이건 런타임 방어다.
    // 그래서 아래 대입은 타입 검사는 통과하고 strict-mode 동결 위반으로 실행 시점에 던진다.
    expect(() => {
      data.items[anyItemId]!.name = '변형됨'
    }).toThrow()
  })

  it('호출할 때마다 같은 동결된 참조를 반환한다', () => {
    expect(loadGameData()).toBe(loadGameData())
  })
})
