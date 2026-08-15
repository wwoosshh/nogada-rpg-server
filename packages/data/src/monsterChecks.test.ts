import { JUDGE_EPSILON_MS, type Direction, type MonsterAttackDef, type MonsterDef } from '@nogada/shared'
import { describe, expect, it } from 'vitest'
import type { MapTerrain } from './placements.js'
import { MAX_CONTINUOUS_SAFE_MS, TELEGRAPH_MIN_MS, validateMonsterPatterns } from './monsterChecks.js'

const 맵 = '사냥터'

function terrain(over: Partial<MapTerrain> = {}): Record<string, MapTerrain> {
  return { [맵]: { width: 7, height: 7, walls: new Set<string>(), ...over } }
}

function attack(
  telegraphStartMs: number,
  direction: Direction,
  over: Partial<MonsterAttackDef> = {},
): MonsterAttackDef {
  return { telegraphStartMs, telegraphMs: 1800, activeMs: 400, direction, reach: 2, ...over }
}

/**
 * 검사 넷을 전부 통과하는 기준 패턴 — RED 픽스처는 여기서 한 곳만 비튼다.
 *
 * 숫자의 유래(D3 재셈): 예고 1,800ms 는 새 하한 ε+700 = 1,700ms 위이고, 창
 * 하나가 1,800+400 = 2,200ms 라 간격 2,200 으로 창 넷이 주기 8,800 을 빈틈없이
 * 채운다. 순찰이 세 칸 줄 (2,3)↔(4,3)인 이유: 부채꼴은 앵커 자신을 절대 못
 * 덮으므로, 줄의 양 끝에서 돌아서서 반대편을 무는 reach 3 공격 둘이 순찰 칸
 * 전부와 그 이웃 열한 칸을 주기마다 한 번씩 문다 — 출하 wolf 와 같은 뼈대다.
 * 두 칸 순찰 + 창 일곱이던 옛 기준(예고 700·간격 1,100)은 창이 2,200ms 로
 * 굵어지는 순간 "모든 공격 칸을 10초 안에 다시 문다"(검사 2)와 산술적으로
 * 공존할 수 없어 — 필요한 창 여섯이 최소 13,200ms 인데 허용 주기가 10,400ms
 * 이하다 — 이 모양으로 재배열했다.
 */
function 기준늑대(over: Partial<MonsterDef> = {}): MonsterDef {
  return {
    id: 'wolf',
    name: '들늑대',
    periodMs: 8800,
    patrol: [
      { x: 2, y: 3 },
      { x: 3, y: 3 },
      { x: 4, y: 3 },
      { x: 3, y: 3 },
    ],
    attacks: [
      attack(0, 'right', { reach: 3 }),
      attack(2200, 'up'),
      attack(4400, 'left', { reach: 3 }),
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
    // 창 폭이 2,200ms 라 2,000 시작은 첫 창 [0, 2200) 안에서 시작한다.
    const v = check(
      기준늑대({ attacks: [attack(0, 'up'), attack(2000, 'down')] }),
    )
    expect(v.some((m) => m.includes('겹친'))).toBe(true)
  })

  it('주기를 감아 넘는 창은 t mod P 계산이 두 동강 난다', () => {
    // 8,000 + 2,200 = 10,200 > 주기 8,800.
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
    // 왼쪽 휩쓸기(t=1800)의 안전 칸 {5..9} 에서 200ms 뒤 오른쪽 휩쓸기(t=2000)의
    // 안전 칸 {0..3} 까지는 최소 2걸음 — 예산 1걸음으로는 아무도 못 산다.
    // 이 협공은 두 번째 예고를 100ms 로 줄여야만 성립한다(검사 3 위반을 겸한다):
    // 예고 하한(이제 ε+700 = 1,700ms = 8걸음 예산)이 살아 있는 한 협공 자체가
    // 안 되는 것이 이 설계의 요점이다.
    const corridor: Record<string, MapTerrain> = { [맵]: { width: 10, height: 1, walls: new Set() } }
    const xs = [5, 5, 5, 5, 5, 5, 5, 4, 3, 3, 3, 3, 4, 5, 5, 5]
    const def: MonsterDef = {
      id: 'wolf',
      name: '들늑대',
      periodMs: 3200,
      patrol: xs.map((x) => ({ x, y: 0 })),
      attacks: [
        attack(0, 'left', { activeMs: 100, reach: 5 }),
        attack(1900, 'right', { telegraphMs: 100, reach: 6 }),
      ],
    }
    const v = check(def, corridor)
    expect(v.some((m) => m.includes('생존') && m.includes('t=1800ms'))).toBe(true)
  })

  it('부채꼴이 깊으면 예고 예산 9걸음 밖의 칸이 갇힌다 — 어느 시각 어느 칸인지 말한다', () => {
    // 아래로 벌어지는 깊이 12 부채꼴이 7×13 맵 아래쪽을 통째로 덮는다. (3, 10)
    // 같은 깊숙한 칸에서 살아남는 칸까지는 맨해튼 10걸음 — 예고 1,800ms(9걸음)로
    // 부족하다. 체비쇼프로 재면 대각 지름길에 눌려 아홉 칸 전부가 9걸음 안이
    // 되어 이 위반이 사라진다(§12-앞 6).
    const 세로맵: Record<string, MapTerrain> = { [맵]: { width: 7, height: 13, walls: new Set() } }
    const def: MonsterDef = {
      id: 'wolf',
      name: '들늑대',
      periodMs: 2400,
      patrol: [{ x: 3, y: 0 }],
      attacks: [attack(0, 'down', { reach: 12 })],
    }
    const v = check(def, 세로맵)
    expect(v.some((m) => m.includes('생존 핵에 들지 못하는') && m.includes('t=0ms'))).toBe(true)
    expect(v.some((m) => m.includes('(3, 10)') && m.includes('9개'))).toBe(true)
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
      periodMs: 2400,
      patrol: [{ x: 3, y: 3 }],
      attacks: [attack(0, 'up')],
    }
    const v = check(def, terrain({ walls: new Set(['2,3']) }))
    expect(v.some((m) => m.includes('(2, 3)') && m.includes('벽'))).toBe(true)
    expect(v.some((m) => m.includes('(3, 3)'))).toBe(true)
  })

  it('한 번은 닿아도 연속 안전이 상한을 넘으면 유사영원이다 — 95% 안전 칸 퇴화(§8-2)', () => {
    // 기준 패턴의 공격 넷을 그대로 두고 주기만 24초로 늘린다(앵커가 유지되게
    // 새 슬롯 경계 0·6,000·12,000·18,000 에 하나씩 재배치): 모든 공격 칸이
    // 주기마다 한 번은 물리므로 공간 축은 통과하지만, 물린 뒤 다음 물릴 때까지
    // 2만 ms 넘게 안전하다 — 옆걸음 한 번(400ms 왕복)이면 뚫리는 자판기다.
    const def = 기준늑대({
      periodMs: 24000,
      attacks: [
        attack(0, 'right', { reach: 3 }),
        attack(6000, 'up'),
        attack(12000, 'left', { reach: 3 }),
        attack(18000, 'down'),
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
   * 이 통로는 산술로 지어졌다(D3 재셈 — 예고 1,800 이 걸음 예산을 3→9 로,
   * 휩쓸기 사이 예산을 5→11 로 늘려 옛 32칸 복도는 전부 닿게 되므로 70칸으로
   * 늘렸다): 휩쓸기 A(오른쪽 36칸)·B(왼쪽 32칸)·C(왼쪽 11칸, 앵커가 (11,1)로
   * 걸어간 뒤)가 예산 11·11·12 걸음으로 이어진다. 1바퀴: A핵이 {12..21}을
   * 잃고(i=0), 그 줄어든 A핵이 감기 참조로 C핵의 {46..69}를 잘라낸다(i=2).
   * **2바퀴째에야** 줄어든 C핵이 B핵의 {57..69}를 잘라낸다(i=1) — 그래서 B
   * 예고(9걸음)의 좌초 칸이 14개(1바퀴)가 아니라 **18개**(고정점: {10..23} 에
   * {66..69} 가 더해진다)다. 한 바퀴 돌연변이는 이 숫자에서 갈린다.
   */
  it('핵의 수축이 감기를 넘어 연쇄하면 두 바퀴째가 좌초 칸을 더 찾는다', () => {
    const corridor: Record<string, MapTerrain> = {
      [맵]: {
        width: 70,
        height: 3,
        walls: new Set(
          Array.from({ length: 70 * 3 }, (_, i) => `${i % 70},${Math.floor(i / 70)}`).filter(
            (k) => !k.endsWith(',1'),
          ),
        ),
      },
    }
    const patrol = [
      ...Array.from({ length: 25 }, () => ({ x: 33, y: 1 })),
      ...Array.from({ length: 22 }, (_, i) => ({ x: 32 - i, y: 1 })),
      ...Array.from({ length: 21 }, (_, i) => ({ x: 12 + i, y: 1 })),
    ]
    const def: MonsterDef = {
      id: 'wolf',
      name: '들늑대',
      periodMs: 6800,
      patrol,
      attacks: [
        attack(200, 'right', { reach: 36 }),
        attack(2400, 'left', { reach: 32 }),
        attack(4600, 'left', { reach: 11 }),
      ],
    }
    const v = check(def, corridor)
    expect(v.some((m) => m.includes('t=2400ms') && m.includes('18개'))).toBe(true)
  })
})

describe('검사 3 — 예고·활성 하한과 방치자 기대 피격 (§8-3, §12-앞 1)', () => {
  it('예고 700ms 미만은 보고 피하는 게임이 아니라 반응속도 시험이다', () => {
    const v = check(
      기준늑대({ attacks: [attack(0, 'right', { telegraphMs: 600, reach: 3 }), ...기준늑대().attacks.slice(1)] }),
    )
    expect(v.some((m) => m.includes('예고') && m.includes('600ms'))).toBe(true)
  })

  it('예고 1,000ms 는 옛 하한(700)은 넘지만 ε 스미어를 빼면 안전한 예고가 0ms 다 — ε+700 하한 (D3)', () => {
    // 판정은 [t−ε, t+ε] 구간이라(§2-5) 예고의 마지막 ε 는 표시가 떠 있는 채로
    // 이미 확정 피격 구간이다. 700~ε+700 사이의 예고를 저작하면 옛 하한은
    // 침묵하는데 "보고 피한다"의 실제 예산은 700ms 미만이 된다 — 출하 wolf 의
    // 1,800 은 우연이었다. 기대 문구의 숫자는 전부 상수에서 유도한다(리터럴 금지).
    const v = check(
      기준늑대({ attacks: [attack(0, 'right', { telegraphMs: 1000, reach: 3 }), ...기준늑대().attacks.slice(1)] }),
    )
    expect(
      v.some(
        (m) =>
          m.includes(`안전한 예고가 ${1000 - JUDGE_EPSILON_MS}ms`) &&
          m.includes(`하한 ${JUDGE_EPSILON_MS + TELEGRAPH_MIN_MS}ms`),
      ),
    ).toBe(true)
    // 옛 700 하한의 문구("하한 700ms.")가 아니어야 한다 — 1,000 은 그 검사로는 합법이다.
    expect(v.some((m) => m.includes(`하한 ${TELEGRAPH_MIN_MS}ms.`))).toBe(false)
  })

  it('예고가 정확히 ε+700 이면 통과한다 — 하한은 리터럴이 아니라 ε 유도라, ε 가 줄면 따라 준다', () => {
    const v = check(
      기준늑대({
        attacks: [
          attack(0, 'right', { telegraphMs: JUDGE_EPSILON_MS + TELEGRAPH_MIN_MS, reach: 3 }),
          ...기준늑대().attacks.slice(1),
        ],
      }),
    )
    expect(v).toEqual([])
  })

  it('활성 창이 간격 하한보다 좁으면 방치자가 스윙 사이로 휩쓸기를 통째로 지나친다', () => {
    const v = check(
      기준늑대({ attacks: [attack(0, 'right', { activeMs: 300, reach: 3 }), ...기준늑대().attacks.slice(1)] }),
    )
    expect(v.some((m) => m.includes('활성') && m.includes('300ms'))).toBe(true)
  })

  it('휩쓸기 중 순찰이 떠나도 위반이 아니다 — 헛스윙 의미론이 구역 칸을 사거리와 무관하게 문다', () => {
    // 옛 검사는 여기서 "(3, 2) 가 사거리에 잠깐만 머문다" 위반을 냈다. 그
    // 검사의 전제(피격은 사거리 안 스윙에만 실린다)가 자판기 칸 구멍을 낳아
    // 은퇴했고(§2-2 헛스윙 의미론 — 리뷰가 재현한 순환 위임), 이제 구역 칸의
    // 방치자는 몬스터가 어디 있든 활성 창 ≥ 간격 하한이면 맞는다. 이 픽스처는
    // 예고(슬롯 1,200ms 경계) 중에 몬스터가 (4,3)으로 떠나 휩쓸기 내내 앵커
    // 밖인데도, 검사 2 의 정당한 안전 칸 위반은 그대로 내지만 **체류를 이유로
    // 한 위반과 (3, 2) 를 무는 위반만은 없어야 한다.**
    const def: MonsterDef = {
      id: 'wolf',
      name: '들늑대',
      periodMs: 2400,
      patrol: [
        { x: 3, y: 3 },
        { x: 4, y: 3 },
      ],
      attacks: [attack(0, 'up')],
    }
    const v = check(def)
    expect(v.some((m) => m.includes('머문다') || m.includes('체류'))).toBe(false)
    expect(v.some((m) => m.includes('(3, 2)'))).toBe(false)
  })
})
