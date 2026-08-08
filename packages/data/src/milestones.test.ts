import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { NodeDef, RecipeDef } from '@nogada/shared'
import { parseCsv, parseNodes, parseRecipes } from './parse.js'
import { parseMilestones } from './milestones.js'

const nodes: Record<string, NodeDef> = {
  copper_vein: {
    id: 'copper_vein', name: '구리 광맥', skill: 'mineral', tier: 1, baseChance: 0.5,
    yieldItem: 'copper_ore', yieldMin: 1, yieldMax: 3, skillGainMin: 1, skillGainMax: 2,
  },
}

const recipes: Record<string, RecipeDef> = {
  copper_hammer: {
    id: 'copper_hammer', name: '구리 망치', skill: 'crafting', requiredSkill: 200, baseChance: 0.55,
    inputs: [{ item: 'copper_ingot', count: 2 }], output: { item: 'copper_hammer', count: 1 },
    skillGainMin: 15, skillGainMax: 25,
  },
}

/** metricKind=skill, effectKind=title 인 기본 유효 행. 필요한 칸만 덮어쓴다. */
function row(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    id: 'ice_1000', metricKind: 'skill', metricArg: 'ice', threshold: '1000',
    name: '얼음에 익숙해지다', announce: '얼음을 다루는 손이 익숙해졌다',
    effectKind: 'title', effectArg: '',
    ...overrides,
  }
}

describe('parseMilestones — 정상 행', () => {
  it('metricKind=skill, effectKind=title 을 파싱한다', () => {
    const [m] = parseMilestones([row()], nodes, recipes)
    expect(m).toEqual({
      id: 'ice_1000',
      metric: { kind: 'skill', skill: 'ice' },
      threshold: 1000,
      name: '얼음에 익숙해지다',
      announce: '얼음을 다루는 손이 익숙해졌다',
      effect: { kind: 'title' },
    })
  })

  it('metricKind=every 를 파싱한다 — 파이프로 이은 이정표 id 목록이 된다', () => {
    const [m] = parseMilestones(
      [row({ id: 'every_1', metricKind: 'every', metricArg: 'ice_1000|wood_1000', threshold: '2' })],
      nodes,
      recipes,
    )
    expect(m?.metric).toEqual({ kind: 'every', of: ['ice_1000', 'wood_1000'] })
  })

  it('effectKind=repeat 을 파싱한다', () => {
    const [m] = parseMilestones([row({ effectKind: 'repeat', effectArg: 'ice' })], nodes, recipes)
    expect(m?.effect).toEqual({ kind: 'repeat', skill: 'ice' })
  })

  it('effectKind=recipes 를 파싱한다', () => {
    const [m] = parseMilestones([row({ effectKind: 'recipes', effectArg: 'copper_hammer' })], nodes, recipes)
    expect(m?.effect).toEqual({ kind: 'recipes', ids: ['copper_hammer'] })
  })

  it('effectKind=nodes 를 파싱한다', () => {
    const [m] = parseMilestones([row({ effectKind: 'nodes', effectArg: 'copper_vein' })], nodes, recipes)
    expect(m?.effect).toEqual({ kind: 'nodes', ids: ['copper_vein'] })
  })

  it('CSV 행 순서를 그대로 보존한다', () => {
    // nextMilestone(packages/shared)이 동점일 때 이 배열의 순서로 정한다 — 파싱이
    // id 순으로 정렬하거나 순서를 흩뜨리면 상단 바가 보여주는 "다음 이정표"가
    // 조용히 바뀐다. id 를 알파벳 순서와 반대로 둬서 우연히 통과하는 것을 막는다.
    const rows = [
      row({ id: 'z_first', metricArg: 'ice' }),
      row({ id: 'a_second', metricArg: 'wood' }),
      row({ id: 'm_third', metricArg: 'mineral' }),
    ]
    const result = parseMilestones(rows, nodes, recipes)
    expect(result.map((m) => m.id)).toEqual(['z_first', 'a_second', 'm_third'])
  })
})

describe('parseMilestones — metricKind 검사', () => {
  it('모르는 metricKind 면 던진다', () => {
    expect(() => parseMilestones([row({ metricKind: 'bogus' })], nodes, recipes)).toThrow(
      'milestones.csv[ice_1000]: metricKind "bogus" 는 알 수 없다 (허용값: skill, every)',
    )
  })

  it('metricKind=skill 인데 metricArg 가 기술 id 가 아니면 던진다', () => {
    // 오타(mineral → minerall)가 조용히 통과하면 영원히 달성될 수 없는 이정표가
    // 목록에 남는다 — 어떤 플레이어의 숙련도도 "minerall" 이라는 기술을 올릴 수 없다.
    expect(() => parseMilestones([row({ metricArg: 'minerall' })], nodes, recipes)).toThrow(
      'milestones.csv[ice_1000]: skill "minerall" 는 알 수 없다 (허용값: ice, wood, mineral, herb, crafting)',
    )
  })
})

describe('parseMilestones — effectKind 검사', () => {
  it('모르는 effectKind 면 던진다', () => {
    expect(() => parseMilestones([row({ effectKind: 'bogus' })], nodes, recipes)).toThrow(
      'milestones.csv[ice_1000]: effectKind "bogus" 는 알 수 없다 (허용값: repeat, recipes, nodes, title)',
    )
  })

  it('effectKind=recipes 인데 없는 레시피 id 를 가리키면 던진다', () => {
    // 이정표는 게이트를 선언할 뿐이므로 대상이 실재해야 한다 — 없으면 플레이어에게
    // 거짓 약속을 하는 줄이 목록에 남는다.
    expect(() =>
      parseMilestones([row({ effectKind: 'recipes', effectArg: 'ghost_recipe' })], nodes, recipes),
    ).toThrow('milestones.csv[ice_1000]: 존재하지 않는 레시피 "ghost_recipe" 를 가리킨다')
  })

  it('effectKind=nodes 인데 없는 노드 id 를 가리키면 던진다', () => {
    expect(() =>
      parseMilestones([row({ effectKind: 'nodes', effectArg: 'ghost_node' })], nodes, recipes),
    ).toThrow('milestones.csv[ice_1000]: 존재하지 않는 노드 "ghost_node" 를 가리킨다')
  })

  it('effectKind=repeat 인데 effectArg 가 기술 id 가 아니면 던진다', () => {
    expect(() =>
      parseMilestones([row({ effectKind: 'repeat', effectArg: 'minerall' })], nodes, recipes),
    ).toThrow('milestones.csv[ice_1000]: skill "minerall" 는 알 수 없다 (허용값: ice, wood, mineral, herb, crafting)')
  })
})

describe('parseMilestones — 공통 검사', () => {
  it('id 가 겹치면 던진다', () => {
    expect(() => parseMilestones([row(), row()], nodes, recipes)).toThrow(
      'milestones.csv: 중복된 id "ice_1000"',
    )
  })

  it('threshold 가 0 이하면 던진다', () => {
    expect(() => parseMilestones([row({ threshold: '0' })], nodes, recipes)).toThrow(
      'milestones.csv[ice_1000]: threshold "0" 는 1 이상이어야 한다',
    )
  })

  it('threshold 가 정수가 아니면 던진다', () => {
    expect(() => parseMilestones([row({ threshold: '1.5' })], nodes, recipes)).toThrow(
      'milestones.csv[ice_1000]: threshold "1.5" 는 정수가 아니다',
    )
  })

  it('파이프 목록에 빈 항목이 있으면 던진다 — 이중 파이프', () => {
    // "ice_1000||wood_1000" 같은 오타(파이프 두 개 연속)가 빈 이정표 id 를
    // 가리키는 것을 막는다.
    expect(() =>
      parseMilestones(
        [row({ id: 'every_1', metricKind: 'every', metricArg: 'ice_1000||wood_1000', threshold: '2' })],
        nodes,
        recipes,
      ),
    ).toThrow(/빈 항목이 있다/)
  })

  it('파이프 목록에 빈 항목이 있으면 던진다 — 끝에 붙은 파이프', () => {
    expect(() =>
      parseMilestones(
        [row({ effectKind: 'recipes', effectArg: 'copper_hammer|' })],
        nodes,
        recipes,
      ),
    ).toThrow(/빈 항목이 있다/)
  })

  it('announce 가 빈칸이어도 던지지 않는다', () => {
    // 다섯 기술이 같은 문턱을 각각 넘을 때마다 매번 화면을 가리면 소음이 된다 —
    // 그래서 announce 를 비워 목록에만 남기는 행이 실제 CSV에 여럿 있다.
    const [m] = parseMilestones([row({ announce: '' })], nodes, recipes)
    expect(m?.announce).toBe('')
  })
})

describe('parseMilestones — 실제 출하 CSV', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const csvDir = join(here, '..', 'csv')
  const readRealCsv = (name: string) => parseCsv(readFileSync(join(csvDir, name), 'utf8'))

  it('오류 없이 파싱된다', () => {
    const realNodes = parseNodes(readRealCsv('nodes.csv'))
    const realRecipes = parseRecipes(readRealCsv('recipes.csv'))
    expect(() => parseMilestones(readRealCsv('milestones.csv'), realNodes, realRecipes)).not.toThrow()
  })

  it('행 27개를 만든다', () => {
    const realNodes = parseNodes(readRealCsv('nodes.csv'))
    const realRecipes = parseRecipes(readRealCsv('recipes.csv'))
    const result = parseMilestones(readRealCsv('milestones.csv'), realNodes, realRecipes)
    expect(result).toHaveLength(27)
  })
})
