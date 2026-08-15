import type { Direction, MonsterAttackDef, MonsterDef } from '@nogada/shared'
import { describe, expect, it } from 'vitest'
import type { MapTerrain } from './placements.js'
import { MAX_CONTINUOUS_SAFE_MS, validateMonsterPatterns } from './monsterChecks.js'

const 맵 = '사냥터'

function terrain(over: Partial<MapTerrain> = {}): Record<string, MapTerrain> {
  return { [맵]: { width: 7, height: 7, walls: new Set<string>(), ...over } }
}

function attack(
  telegraphStartMs: number,
  direction: Direction,
  over: Partial<MonsterAttackDef> = {},
): MonsterAttackDef {
  return { telegraphStartMs, telegraphMs: 700, activeMs: 400, direction, reach: 2, ...over }
}

/**
 * 검사 넷을 전부 통과하는 기준 패턴 — RED 픽스처는 여기서 한 곳만 비튼다.
 *
 * 순찰 두 칸을 번갈아 서는 이유: 부채꼴은 앵커 자신을 절대 못 덮으므로,
 * 제자리 몬스터는 "몬스터와 겹쳐 선 A 홀드"가 영원히 안전해져 검사 2 에
 * 걸린다. 옆 칸에서 돌아서서 옛 자리를 무는 공격이 그 구멍을 닫는다.
 */
function 기준늑대(over: Partial<MonsterDef> = {}): MonsterDef {
  return {
    id: 'wolf',
    name: '들늑대',
    periodMs: 8800,
    patrol: [
      { x: 3, y: 3 },
      { x: 2, y: 3 },
    ],
    attacks: [
      attack(0, 'up'),
      attack(1100, 'down'),
      attack(2200, 'left'),
      attack(3300, 'right'),
      attack(4400, 'right'),
      attack(5500, 'up'),
      attack(6600, 'down'),
    ],
    ...over,
  }
}

function check(def: MonsterDef, terrains: Record<string, MapTerrain> = terrain()): string[] {
  return validateMonsterPatterns([{ instanceId: 'wolf-1', mapId: 맵, def }], terrains)
}

describe('validateMonsterPatterns — 입구', () => {
  it('몬스터가 없으면 조용하다 — C6 이 데이터를 싣기 전까지 파이프는 빈 목록으로 돈다', () => {
    expect(validateMonsterPatterns([], terrain())).toEqual([])
  })

  it('풀 수 있는 기준 패턴은 통과한다 — 모든 패턴을 죽이는 검사는 자가 아니다', () => {
    expect(check(기준늑대())).toEqual([])
  })

  it('없는 맵에 놓이면 지형을 맞대 볼 수 없으니 그것부터 말한다', () => {
    const v = validateMonsterPatterns([{ instanceId: 'wolf-1', mapId: '유령맵', def: 기준늑대() }], terrain())
    expect(v.some((m) => m.includes('유령맵'))).toBe(true)
  })
})

describe('구조 전제 — monsterStateAt 이 다시 검사하지 않는 것들', () => {
  it('주기가 순찰 칸수로 나눠떨어지지 않으면 슬롯 경계가 어긋난다', () => {
    const v = check(기준늑대({ periodMs: 8801 }))
    expect(v.some((m) => m.includes('나눠떨어지'))).toBe(true)
  })

  it('겹치는 공격 창은 어느 국면인지 정할 수 없다', () => {
    const v = check(
      기준늑대({ attacks: [attack(0, 'up'), attack(1000, 'down')] }),
    )
    expect(v.some((m) => m.includes('겹친'))).toBe(true)
  })

  it('주기를 감아 넘는 창은 t mod P 계산이 두 동강 난다', () => {
    const v = check(기준늑대({ attacks: [attack(8000, 'up')] }))
    expect(v.some((m) => m.includes('감아'))).toBe(true)
  })
})

describe('검사 4 — 배치·순찰 칸이 걷는 칸 위 (§12-앞 22)', () => {
  it('벽 칸 순찰은 화면의 늑대가 벽 속에 선다 — 어느 칸인지 말한다', () => {
    const v = check(기준늑대(), terrain({ walls: new Set(['2,3']) }))
    expect(v.some((m) => m.includes('(2, 3)') && m.includes('벽'))).toBe(true)
  })

  it('맵 밖 순찰은 좌표 오타다 — 어느 칸인지 말한다', () => {
    const v = check(
      기준늑대({
        patrol: [
          { x: 6, y: 3 },
          { x: 7, y: 3 },
        ],
      }),
    )
    expect(v.some((m) => m.includes('(7, 3)') && m.includes('맵 밖'))).toBe(true)
  })

  it('건너뛰는 순찰은 화면에서 순간이동한다 — 감기 경계도 같은 자로 잰다', () => {
    // 3→4→5 는 이웃인데 마지막 5 에서 첫 3 으로 감기는 순간 두 칸을 건너뛴다.
    const v = check(
      기준늑대({
        patrol: [
          { x: 3, y: 3 },
          { x: 4, y: 3 },
          { x: 5, y: 3 },
        ],
        periodMs: 9000,
      }),
    )
    expect(v.some((m) => m.includes('건너뛴다'))).toBe(true)
  })

  it('순찰이 벽에 놓이면 뒤 검사를 돌리지 않는다 — 그림자 위반이 진짜 원인을 파묻는다', () => {
    // 벽 위 순찰 하나가 진짜 원인인데, 그대로 시뮬을 돌리면 검사 1~3 의
    // 그림자 위반이 줄줄이 따라붙는다(build.ts 의 문법 오류 선행 보고와 같은 저울).
    const v = check(기준늑대({ patrol: [{ x: 3, y: 3 }] }), terrain({ walls: new Set(['3,3']) }))
    expect(v).toHaveLength(1)
    expect(v[0]).toContain('벽')
  })
})

describe('검사 1 — 생존 가능 핵 최대 고정점 (§8-1, §12-앞 1)', () => {
  it('등을 맞댄 두 부채꼴이 1걸음 예산으로 협공하면 생존 핵이 빈다', () => {
    // 왼쪽 휩쓸기(t=700)의 안전 칸 {5..9} 에서 200ms 뒤 오른쪽 휩쓸기(t=900)의
    // 안전 칸 {0..3} 까지는 최소 2걸음 — 예산 1걸음으로는 아무도 못 산다.
    // 이 협공은 두 번째 예고를 100ms 로 줄여야만 성립한다(검사 3 위반을 겸한다):
    // 예고 하한 700ms = 3걸음 예산이 살아 있는 한 협공 자체가 안 되는 것이
    // 이 설계의 요점이다.
    const corridor: Record<string, MapTerrain> = { [맵]: { width: 10, height: 1, walls: new Set() } }
    const xs = [5, 5, 5, 5, 5, 5, 5, 4, 3, 3, 3, 3, 4, 5, 5, 5]
    const def: MonsterDef = {
      id: 'wolf',
      name: '들늑대',
      periodMs: 1600,
      patrol: xs.map((x) => ({ x, y: 0 })),
      attacks: [
        attack(0, 'left', { activeMs: 100, reach: 5 }),
        attack(800, 'right', { telegraphMs: 100, reach: 6 }),
      ],
    }
    const v = check(def, corridor)
    expect(v.some((m) => m.includes('생존') && m.includes('t=700ms'))).toBe(true)
  })

  it('부채꼴이 깊으면 예고 예산 3걸음 밖의 칸이 갇힌다 — 어느 시각 어느 칸인지 말한다', () => {
    // 아래로 벌어지는 깊이 6 부채꼴이 맵 아래쪽을 통째로 덮는다. (3, 4) 같은
    // 깊숙한 칸에서 살아남는 칸까지는 맨해튼 4걸음 — 예고 700ms(3걸음)로 부족하다.
    // 체비쇼프로 재면 대각 지름길이 3걸음이 되어 이 위반이 사라진다(§12-앞 6).
    const def: MonsterDef = {
      id: 'wolf',
      name: '들늑대',
      periodMs: 2000,
      patrol: [{ x: 3, y: 0 }],
      attacks: [attack(0, 'down', { reach: 6 })],
    }
    const v = check(def)
    expect(v.some((m) => m.includes('생존 핵에 들지 못하는') && m.includes('t=0ms'))).toBe(true)
    expect(v.some((m) => m.includes('(3, 4)') && m.includes('9개'))).toBe(true)
  })
})

describe('검사 2 — 영원·유사영원 안전 공격 칸 없음 (§8-2, §12-앞 4·5)', () => {
  it('사거리에 들면서 어떤 휩쓸기도 안 닿는 칸은 영원한 A 홀드 자리다 — 벽 칸도 정의역이다', () => {
    // 제자리 몬스터가 위로만 휩쓸면 나머지 이웃 칸과 몬스터 자신의 칸이 전부
    // 영원히 안전하다. (2,3) 을 벽으로 만든 것이 이 테스트의 요점: 위치는
    // 주장이라 벽 칸도 홀드 자리가 되므로(§2-3) 정의역이 걷는 칸이면 안 된다.
    const def: MonsterDef = {
      id: 'wolf',
      name: '들늑대',
      periodMs: 2000,
      patrol: [{ x: 3, y: 3 }],
      attacks: [attack(0, 'up')],
    }
    const v = check(def, terrain({ walls: new Set(['2,3']) }))
    expect(v.some((m) => m.includes('(2, 3)') && m.includes('벽'))).toBe(true)
    expect(v.some((m) => m.includes('(3, 3)'))).toBe(true)
  })

  it('한 번은 닿아도 연속 안전이 상한을 넘으면 유사영원이다 — 95% 안전 칸 퇴화(§8-2)', () => {
    // 기준 패턴의 공격 일곱을 그대로 두고 주기만 24초로 늘린다: 모든 공격 칸이
    // 주기마다 한 번은 물리므로 공간 축은 통과하지만, 물린 뒤 다음 물릴 때까지
    // 2만 ms 넘게 안전하다 — 옆걸음 한 번(400ms 왕복)이면 뚫리는 자판기다.
    const def = 기준늑대({
      periodMs: 24000,
      attacks: [
        attack(0, 'up'),
        attack(1100, 'down'),
        attack(2200, 'left'),
        attack(3300, 'right'),
        attack(12000, 'right'),
        attack(13100, 'up'),
        attack(14200, 'down'),
      ],
    })
    const v = check(def)
    expect(v.some((m) => m.includes('연속') && m.includes(`${MAX_CONTINUOUS_SAFE_MS}`))).toBe(true)
  })
})

describe('검사 1 — 최대 고정점은 한 바퀴로 끝나지 않는다', () => {
  /**
   * **고정점 반복 자체를 무는 픽스처다.** 리뷰가 재현한 살아남는 돌연변이:
   * `while (changed)` 를 한 바퀴로 제한해도 기존 픽스처 전부가 초록이었다 —
   * 협공은 첫 바퀴에 비고, 나머지는 애초에 안 줄어서, "최대 고정점까지 반복"
   * 이라는 §8-1 술어의 이름값을 아무도 증언하지 않았다.
   *
   * 이 통로는 산술로 지어졌다: 32칸 복도에서 휩쓸기 A(오른쪽 16칸)·B(왼쪽
   * 14칸)·C(왼쪽 5칸, 앵커가 (5,1)로 걸어간 뒤)가 예산 5·5·6 걸음으로 이어진다.
   * 1바퀴: A핵이 {6..9}를 잃고(i=0), 그 줄어든 A핵이 감기 참조로 C핵의 {22..}를
   * 잘라낸다(i=2). **2바퀴째에야** 줄어든 C핵이 B핵의 {27..31}을 잘라낸다(i=1) —
   * 그래서 B 예고의 좌초 칸이 8개(1바퀴)가 아니라 **10개**(고정점)다. 한 바퀴
   * 돌연변이는 이 숫자에서 갈린다.
   */
  it('핵의 수축이 감기를 넘어 연쇄하면 두 바퀴째가 좌초 칸을 더 찾는다', () => {
    const corridor: Record<string, MapTerrain> = {
      [맵]: {
        width: 32,
        height: 3,
        walls: new Set(
          Array.from({ length: 32 * 3 }, (_, i) => `${i % 32},${Math.floor(i / 32)}`).filter(
            (k) => !k.endsWith(',1'),
          ),
        ),
      },
    }
    const patrol = [
      ...Array.from({ length: 13 }, () => ({ x: 15, y: 1 })),
      ...Array.from({ length: 10 }, (_, i) => ({ x: 14 - i, y: 1 })),
      { x: 5, y: 1 },
      ...Array.from({ length: 10 }, (_, i) => ({ x: 6 + i, y: 1 })),
    ]
    const def: MonsterDef = {
      id: 'wolf',
      name: '들늑대',
      periodMs: 3400,
      patrol,
      attacks: [
        attack(100, 'right', { reach: 16 }),
        attack(1200, 'left', { reach: 14 }),
        attack(2300, 'left', { reach: 5 }),
      ],
    }
    const v = check(def, corridor)
    expect(v.some((m) => m.includes('t=1200ms') && m.includes('10개'))).toBe(true)
  })
})

describe('검사 3 — 예고·활성 하한과 방치자 기대 피격 (§8-3, §12-앞 1)', () => {
  it('예고 700ms 미만은 보고 피하는 게임이 아니라 반응속도 시험이다', () => {
    const v = check(기준늑대({ attacks: [attack(0, 'up', { telegraphMs: 600 }), ...기준늑대().attacks.slice(1)] }))
    expect(v.some((m) => m.includes('예고') && m.includes('600ms'))).toBe(true)
  })

  it('활성 창이 간격 하한보다 좁으면 방치자가 스윙 사이로 휩쓸기를 통째로 지나친다', () => {
    const v = check(기준늑대({ attacks: [attack(0, 'up', { activeMs: 300 }), ...기준늑대().attacks.slice(1)] }))
    expect(v.some((m) => m.includes('활성') && m.includes('300ms'))).toBe(true)
  })

  it('휩쓸기 중 순찰이 떠나도 위반이 아니다 — 헛스윙 의미론이 구역 칸을 사거리와 무관하게 문다', () => {
    // 옛 검사는 여기서 "(3, 2) 가 사거리에 200ms 만 머문다" 위반을 냈다. 그
    // 검사의 전제(피격은 사거리 안 스윙에만 실린다)가 자판기 칸 구멍을 낳아
    // 은퇴했고(§2-2 헛스윙 의미론 — 리뷰가 재현한 순환 위임), 이제 구역 칸의
    // 방치자는 몬스터가 어디 있든 활성 창 ≥ 간격 하한이면 맞는다. 이 작은
    // 픽스처는 검사 2 의 정당한 안전 칸 위반은 그대로 내지만, **체류를 이유로 한
    // 위반만은 더 이상 없어야 한다.**
    const def: MonsterDef = {
      id: 'wolf',
      name: '들늑대',
      periodMs: 1800,
      patrol: [
        { x: 3, y: 3 },
        { x: 4, y: 3 },
      ],
      attacks: [attack(0, 'up')],
    }
    const v = check(def)
    expect(v.some((m) => m.includes('머문다') || m.includes('체류'))).toBe(false)
    expect(v.some((m) => m.includes('(3, 2)') && m.includes('200ms'))).toBe(false)
  })
})
