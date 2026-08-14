import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { RecipeDef, SkillId } from '@nogada/shared'
import { parseCsv, parseRecipes } from './parse.js'
import { parseMilestones } from './milestones.js'

const recipes: Record<string, RecipeDef> = {
  copper_hammer: {
    id: 'copper_hammer', name: '구리 망치', category: '도구', skill: 'crafting', requiredSkill: 200, baseChance: 0.55,
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
    const [m] = parseMilestones([row()], recipes)
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
      recipes,
    )
    expect(m?.metric).toEqual({ kind: 'every', of: ['ice_1000', 'wood_1000'] })
  })

  it('effectKind=repeat 을 파싱한다', () => {
    const [m] = parseMilestones([row({ effectKind: 'repeat', effectArg: 'ice' })], recipes)
    expect(m?.effect).toEqual({ kind: 'repeat', skill: 'ice' })
  })

  it('effectKind=recipes 를 파싱한다', () => {
    const [m] = parseMilestones([row({ effectKind: 'recipes', effectArg: 'copper_hammer' })], recipes)
    expect(m?.effect).toEqual({ kind: 'recipes', ids: ['copper_hammer'] })
  })

  it('metricKind=collection 을 파싱한다 — metricArg 는 비어 있다(방은 하나뿐이다)', () => {
    const [m] = parseMilestones(
      [row({ id: 'collection_30', metricKind: 'collection', metricArg: '', threshold: '30' })],
      recipes,
    )
    expect(m?.metric).toEqual({ kind: 'collection' })
  })

  it('effectKind=stock 을 파싱한다 — effectArg 는 비어 있다(무엇이 열리는지는 진열이 안다)', () => {
    const [m] = parseMilestones([row({ effectKind: 'stock', effectArg: '' })], recipes)
    expect(m?.effect).toEqual({ kind: 'stock' })
  })

  it('metricKind=collection 인데 metricArg 가 적혀 있으면 던진다 — 조용히 무시하면 작가는 그것이 무언가 한다고 믿는다', () => {
    expect(() =>
      parseMilestones([row({ metricKind: 'collection', metricArg: 'ice', threshold: '30' })], recipes),
    ).toThrow('milestones.csv[ice_1000]: metricArg 에 "ice" 가 적혔다')
  })

  it('effectKind=stock 인데 effectArg 가 적혀 있으면 던진다 — 진열 목록을 두 벌로 적게 하지 않는다', () => {
    expect(() => parseMilestones([row({ effectKind: 'stock', effectArg: '30' })], recipes)).toThrow(
      'milestones.csv[ice_1000]: effectArg 에 "30" 가 적혔다',
    )
  })

  it('effectKind=barrier 를 파싱한다 — effectArg 는 비어 있다(무엇이 열리는지는 문이 안다)', () => {
    const [m] = parseMilestones([row({ effectKind: 'barrier', effectArg: '' })], recipes)
    expect(m?.effect).toEqual({ kind: 'barrier' })
  })

  it('effectKind=barrier 인데 effectArg 가 적혀 있으면 던진다 — 문 목록을 두 벌로 적게 하지 않는다', () => {
    expect(() =>
      parseMilestones([row({ effectKind: 'barrier', effectArg: '얼음채집장' })], recipes),
    ).toThrow('milestones.csv[ice_1000]: effectArg 에 "얼음채집장" 가 적혔다')
  })

  it('CSV 행 순서를 그대로 보존한다', () => {
    // 이정표 탭(apps/client/src/game/detailMenuTabs.ts)이 동점 진척을 이 배열의
    // 순서로 정렬한다 — 파싱이 id 순으로 정렬하거나 순서를 흩뜨리면 그 정렬이
    // 조용히 바뀐다. id 를 알파벳 순서와 반대로 둬서 우연히 통과하는 것을 막는다.
    const rows = [
      row({ id: 'z_first', metricArg: 'ice' }),
      row({ id: 'a_second', metricArg: 'wood' }),
      row({ id: 'm_third', metricArg: 'mineral' }),
    ]
    const result = parseMilestones(rows, recipes)
    expect(result.map((m) => m.id)).toEqual(['z_first', 'a_second', 'm_third'])
  })
})

describe('parseMilestones — metricKind 검사', () => {
  it('모르는 metricKind 면 던진다', () => {
    expect(() => parseMilestones([row({ metricKind: 'bogus' })], recipes)).toThrow(
      'milestones.csv[ice_1000]: metricKind "bogus" 는 알 수 없다 (허용값: skill, every, collection)',
    )
  })

  it('metricKind=skill 인데 metricArg 가 기술 id 가 아니면 던진다', () => {
    // 오타(mineral → minerall)가 조용히 통과하면 영원히 달성될 수 없는 이정표가
    // 목록에 남는다 — 어떤 플레이어의 숙련도도 "minerall" 이라는 기술을 올릴 수 없다.
    expect(() => parseMilestones([row({ metricArg: 'minerall' })], recipes)).toThrow(
      'milestones.csv[ice_1000]: skill "minerall" 는 알 수 없다 (허용값: ice, wood, mineral, herb, crafting)',
    )
  })
})

describe('parseMilestones — effectKind 검사', () => {
  it('모르는 effectKind 면 던진다', () => {
    expect(() => parseMilestones([row({ effectKind: 'bogus' })], recipes)).toThrow(
      'milestones.csv[ice_1000]: effectKind "bogus" 는 알 수 없다 (허용값: repeat, recipes, stock, barrier, title)',
    )
  })

  it('은퇴한 effectKind=nodes 를 거부한다 — 노드 tier 게이트가 폐지되어 선언할 게이트가 없다(§7-앞 2)', () => {
    // 옛 CSV 를 되살리거나 문서의 옛 예시를 베낀 행이 조용히 통과하면, 목록에
    // "달성하면 캘 수 있다" 라는 거짓 약속이 남는다 — 노드는 이제 잠기지 않는다.
    expect(() => parseMilestones([row({ effectKind: 'nodes', effectArg: 'copper_vein' })], recipes)).toThrow(
      'milestones.csv[ice_1000]: effectKind "nodes" 는 알 수 없다 (허용값: repeat, recipes, stock, barrier, title)',
    )
  })

  it('effectKind=recipes 인데 없는 레시피 id 를 가리키면 던진다', () => {
    // 이정표는 게이트를 선언할 뿐이므로 대상이 실재해야 한다 — 없으면 플레이어에게
    // 거짓 약속을 하는 줄이 목록에 남는다.
    expect(() =>
      parseMilestones([row({ effectKind: 'recipes', effectArg: 'ghost_recipe' })], recipes),
    ).toThrow('milestones.csv[ice_1000]: 존재하지 않는 레시피 "ghost_recipe" 를 가리킨다')
  })

  it('effectKind=repeat 인데 effectArg 가 기술 id 가 아니면 던진다', () => {
    expect(() =>
      parseMilestones([row({ effectKind: 'repeat', effectArg: 'minerall' })], recipes),
    ).toThrow('milestones.csv[ice_1000]: skill "minerall" 는 알 수 없다 (허용값: ice, wood, mineral, herb, crafting)')
  })
})

describe('parseMilestones — 공통 검사', () => {
  it('id 가 겹치면 던진다', () => {
    expect(() => parseMilestones([row(), row()], recipes)).toThrow(
      'milestones.csv: 중복된 id "ice_1000"',
    )
  })

  it('threshold 가 0 이하면 던진다', () => {
    expect(() => parseMilestones([row({ threshold: '0' })], recipes)).toThrow(
      'milestones.csv[ice_1000]: threshold "0" 는 1 이상이어야 한다',
    )
  })

  it('threshold 가 정수가 아니면 던진다', () => {
    expect(() => parseMilestones([row({ threshold: '1.5' })], recipes)).toThrow(
      'milestones.csv[ice_1000]: threshold "1.5" 는 정수가 아니다',
    )
  })

  it('파이프 목록에 빈 항목이 있으면 던진다 — 이중 파이프', () => {
    // "ice_1000||wood_1000" 같은 오타(파이프 두 개 연속)가 빈 이정표 id 를
    // 가리키는 것을 막는다.
    expect(() =>
      parseMilestones(
        [row({ id: 'every_1', metricKind: 'every', metricArg: 'ice_1000||wood_1000', threshold: '2' })],
        recipes,
      ),
    ).toThrow(/빈 항목이 있다/)
  })

  it('파이프 목록에 빈 항목이 있으면 던진다 — 끝에 붙은 파이프', () => {
    expect(() =>
      parseMilestones(
        [row({ effectKind: 'recipes', effectArg: 'copper_hammer|' })],
        recipes,
      ),
    ).toThrow(/빈 항목이 있다/)
  })

  it('announce 가 빈칸이어도 던지지 않는다', () => {
    // 다섯 기술이 같은 문턱을 각각 넘을 때마다 매번 화면을 가리면 소음이 된다 —
    // 그래서 announce 를 비워 목록에만 남기는 행이 실제 CSV에 여럿 있다.
    const [m] = parseMilestones([row({ announce: '' })], recipes)
    expect(m?.announce).toBe('')
  })
})

describe('parseMilestones — 실제 출하 CSV', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const csvDir = join(here, '..', 'csv')
  const readRealCsv = (name: string) => parseCsv(readFileSync(join(csvDir, name), 'utf8'))

  it('오류 없이 파싱된다', () => {
    const realRecipes = parseRecipes(readRealCsv('recipes.csv'))
    expect(() => parseMilestones(readRealCsv('milestones.csv'), realRecipes)).not.toThrow()
  })

  it('행 40개를 만든다', () => {
    const realRecipes = parseRecipes(readRealCsv('recipes.csv'))
    const result = parseMilestones(readRealCsv('milestones.csv'), realRecipes)
    // 27 → 30: 주괴 3종(은·금·미스릴)의 recipes-이정표가 채집 티어 아크에서 늘었다.
    // 30 → 31: 미스릴 곡괭이(G5)의 recipes-이정표(crafting_25000)가 늘었다.
    // 31 → 35: 수집 총점 문턱 넷(10·30·60·100)이 늘었다 — 그중 둘은 되사기
    //          진열을 여는 stock 이고 둘은 title 이다(§6-앞 7).
    // 35 → 39: 결계 문턱 넷(계열별 85,000)이 늘었다. 아래 스위트가 왜인지 진다.
    // 39 → 40: 별똥 도구 넷의 recipes-이정표(crafting_50000) 한 줄이 늘었다 —
    //          미스릴 넷이 crafting_25000 한 줄에 실린 것과 같은 모양이다.
    expect(result).toHaveLength(40)
  })

  /*
   * 85,000 은 이 게임에서 **가장 큰 문턱**인데 오래도록 **어느 목록에도 없었다.**
   *
   * 이정표 탭은 못 넘은 것까지 `이름 현재 / 필요` 로 적고 그 자리 주석이
   * "???" 를 쓰지 않는다"고 못박는다(detailMenuTabs.ts). 상점 잠금도 진척을
   * 숫자로 적고 도감도 다음 문턱까지 몇 칸인지 센다. 그런데 결계만 빠져 있어서,
   * 밀려난 사람이 그 숫자를 다시 보려면 결계를 한 번 더 밟거나 안내판까지 걸어
   * 가야 했다 — "요구치를 숫자로 말하는 문"과 "잠긴 것까지 보이는 목록방"이
   * 이 문 하나에만 적용되지 않았다.
   *
   * 데이터에서 찾아 도는 이유는 네 계열이 **각자의 것**을 말해야 하기 때문이다.
   * 한 계열을 상수로 굳히면 나머지 셋이 조용히 빠져도 초록이 된다.
   */
  describe('결계 문턱 넷이 목록에 있다', () => {
    const realRecipes = parseRecipes(readRealCsv('recipes.csv'))
    const all = parseMilestones(readRealCsv('milestones.csv'), realRecipes)
    // 전환은 CSV 칸을 그대로 읽는다 — 파서를 부르면 이 스위트가 전환 파서의
    // 시그니처에까지 매인다. 여기서 필요한 것은 "출하된 결계가 요구하는 숫자"
    // 하나이고, 그것은 두 칸에 그대로 적혀 있다.
    const gateValues = readRealCsv('transitions.csv')
      .filter((r) => (r['gateSkill'] ?? '') !== '')
      .map((r) => ({ skill: r['gateSkill'] as SkillId, need: Number(r['gateValue']) }))

    it('결계가 걸린 전환마다 같은 계열·같은 숫자의 이정표가 하나 있다', () => {
      expect(gateValues).toHaveLength(4)
      for (const { skill, need } of gateValues) {
        const carriers = all.filter(
          (m) => m.metric.kind === 'skill' && m.metric.skill === skill && m.threshold === need,
        )
        expect(carriers, `${skill} ${need} 를 적은 이정표`).toHaveLength(1)
      }
    })

    // 왜: 이름이 문을 안 가리키면 목록에서 85,000 을 찾은 사람이 그것이 결계인
    //     줄 모른다 — 그 사람이 방금 밀려난 그 문이다.
    it('이름이 결계라고 말한다', () => {
      for (const { skill, need } of gateValues) {
        const carrier = all.find(
          (m) => m.metric.kind === 'skill' && m.metric.skill === skill && m.threshold === need,
        )
        expect(carrier?.name, `${skill} ${need}`).toContain('결계')
      }
    })
  })

  it('수집 문턱 넷 중 둘이 되사기를 열고 둘이 칭호다 — 게이트가 콘텐츠이고 칭호는 그 위에 얹는다', () => {
    const realRecipes = parseRecipes(readRealCsv('recipes.csv'))
    const collection = parseMilestones(readRealCsv('milestones.csv'), realRecipes).filter(
      (m) => m.metric.kind === 'collection',
    )
    expect(collection.map((m) => `${m.threshold}:${m.effect.kind}`)).toEqual([
      '10:title',
      '30:stock',
      '60:stock',
      '100:title',
    ])
  })
})
