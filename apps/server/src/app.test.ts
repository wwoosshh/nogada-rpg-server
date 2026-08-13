import { loadGameData, startLocation } from '@nogada/data'
import {
  GAME_EPOCH_MS,
  REAL_MS_PER_GAME_MINUTE,
  StateResponseSchema,
  gameTimeAt,
  isLowTide,
  isSellTarget,
  type ItemDef,
  type NodePlacement,
  type ShopDef,
  type TransitionDef,
} from '@nogada/shared'
import { describe, expect, it, vi } from 'vitest'
import {
  asPlayer,
  buildTestApp,
  rawSaveOf,
  saveFileOf,
  writeRawCharacter,
  type TestPlayer,
} from './testSupport.js'

/** 이 테스트가 말을 거는 화자. 대사 파일이 있는 실재 화자여야 한다. */
const ELDER = '채집장노인'

/** 채집 노드가 놓인 맵. 어느 맵인지는 데이터가 정한다 — 여기 이름을 적으면 맵을 개명할 때 갈라진다. */
function fieldMapId(): string {
  const placement = loadGameData().placements['copper_vein-1']
  if (!placement) throw new Error('copper_vein-1 배치가 없다')
  return placement.mapId
}

/**
 * 그 화자가 서 있는 맵. 노드가 놓인 맵과 **같다고 가정하지 않는다** —
 * 개발용 시험장에는 온갖 노드가 섞여 있지만 화자는 없고, 화자는 자기 이름이
 * 가리키는 실제 채집장에 서 있다. 여기도 데이터에서 뽑는다.
 */
function speakerMapId(speakerId: string): string {
  const speaker = loadGameData().speakers[speakerId]
  if (!speaker) throw new Error(`speakers.csv 에 ${speakerId} 가 없다`)
  return speaker.mapId
}

/** 실제 전환표에서 두 맵을 잇는 줄. 좌표를 지어내면 CSV 가 바뀔 때 이 테스트가 거짓말을 한다. */
function transitionBetween(fromMap: string, toMap: string): TransitionDef {
  const t = loadGameData().transitions.find((x) => x.fromMap === fromMap && x.toMap === toMap)
  if (!t) throw new Error(`transitions.csv 에 ${fromMap} → ${toMap} 이 없다`)
  return t
}

/** 그 전환 칸을 밟는다. 넘어가지 못하면 여기서 세운다 — 뒤의 단정이 엉뚱한 이유로 깨지지 않도록. */
async function step(me: TestPlayer, t: TransitionDef): Promise<void> {
  const res = await me.inject({ method: 'POST', url: '/api/move', payload: { x: t.fromX, y: t.fromY } })
  expect(res.statusCode).toBe(200)
}

/**
 * 채집 노드가 있는 맵으로 걸어 넘어간다.
 *
 * 시작 맵은 마을이라 그 자리에는 캘 것이 없다. 채집 라우트를 시험하려면 먼저
 * 노드 앞에 서야 하고, 그 걸음도 실제 전환표를 밟아서 간다.
 */
async function enterField(me: TestPlayer): Promise<void> {
  await step(me, transitionBetween(startLocation(loadGameData()).mapId, fieldMapId()))
}

/**
 * 심층 배치 하나 — 어느 맵의 무엇인지는 데이터가 정한다.
 *
 * 예전에는 개발용 시험장에 심층이 섞여 있어 `enterField` 뒤에 이름 하나만
 * 적으면 됐다. 결계 아크가 그 뒷문을 닫으면서(숙련 0 이 걸어 들어가는 맵에
 * 심층이 있으면 결계가 출하 첫날 장식이 된다) 심층은 채집장에만 남았다 —
 * 그래서 여기서는 **시작 맵에서 한 걸음에 닿는** 채집장의 심층 배치를 데이터에서
 * 고른다. 이름을 적으면 배치를 옮기는 날 이 테스트가 거짓말을 한다.
 */
function deepPlacement(): NodePlacement {
  const data = loadGameData()
  const oneStep = new Set(
    data.transitions.filter((t) => t.fromMap === startLocation(data).mapId).map((t) => t.toMap),
  )
  const found = Object.values(data.placements).find(
    (p) => oneStep.has(p.mapId) && data.nodes[p.nodeId]?.variant === 'deep',
  )
  if (!found) throw new Error('시작 맵에서 한 걸음에 닿는 심층 배치가 없다')
  return found
}

/**
 * 그 맵을 지키는 결계 문 — **맵 안 전환**(`fromMap === toMap`)이고 게이트가 걸린 줄이다.
 *
 * 좌표도 계열도 적지 않는다: 결계는 CSV 가 정하므로 여기 숫자를 박으면 벽을
 * 옮기는 날 이 테스트가 거짓말을 한다(deepPlacement 과 같은 자세).
 */
function barrierGateOf(mapId: string): TransitionDef {
  const found = loadGameData().transitions.find(
    (t) =>
      t.fromMap === mapId && t.toMap === mapId && (t.gateSkill !== undefined || t.gateTide === true),
  )
  if (!found) throw new Error(`${mapId} 에 결계 전환이 없다`)
  return found
}

/**
 * 시작 맵에서 그 맵까지 **게이트 없는 문만** 밟아 걸어간다.
 *
 * 좌표를 적지 않고 전환표에게 길을 묻는 이유는 `transitionBetween` 과 같다 —
 * 맵을 하나 더 끼워 넣는 날 여기 적힌 경로가 조용히 틀린 길이 된다. 결계는
 * 일부러 빼고 넓힌다: 이 함수가 하는 일은 문 **앞까지** 데려다 놓는 것이고,
 * 넘는 것은 테스트 본문이 자기 눈으로 봐야 할 사건이다.
 */
async function walkTo(me: TestPlayer, targetMapId: string): Promise<void> {
  const data = loadGameData()
  const start = startLocation(data).mapId
  const queue: string[][] = [[start]]
  const seen = new Set([start])
  while (queue.length > 0) {
    const path = queue.shift()!
    const here = path[path.length - 1]!
    if (here === targetMapId) {
      for (let i = 1; i < path.length; i += 1) await step(me, transitionBetween(path[i - 1]!, path[i]!))
      return
    }
    for (const t of data.transitions) {
      if (t.fromMap !== here || t.toMap === here || seen.has(t.toMap)) continue
      if (t.gateSkill !== undefined || t.gateTide === true) continue
      seen.add(t.toMap)
      queue.push([...path, t.toMap])
    }
  }
  throw new Error(`${start} 에서 ${targetMapId} 까지 게이트 없는 길이 없다`)
}

/** 숙련을 채워 앉힌 사람과, 그 사람이 사는 앱. `close()` 로 둘 다 닫는다. */
interface SeededPlayer {
  me: TestPlayer
  close(): Promise<void>
}

/**
 * 그 계열 숙련을 채운 사람으로 앱을 다시 세운다 — 결계를 실제로 넘어 보려면
 * 필요한 준비다(85,000 을 캐서 올리려면 몇 시간이다).
 *
 * 세이브 파일을 만든 첫 앱은 **끝까지 열어 둔다**: 그 앱이 닫히면서 임시
 * 디렉터리를 통째로 지우므로, 먼저 닫으면 두 번째 앱이 읽을 파일이 없다.
 */
async function playerWithSkills(skills: Record<string, number>): Promise<SeededPlayer> {
  const owner = await buildTestApp()
  const first = await asPlayer(owner)
  const file = saveFileOf(owner)
  const raw = rawSaveOf(owner)[first.id] as { skills: Record<string, number> }
  Object.assign(raw.skills, skills)
  writeRawCharacter(file, first.id, raw)

  const app = await buildTestApp({ dataFile: file })
  const me = await asPlayer(app, { resume: first })
  return {
    me,
    close: async () => {
      await app.close()
      await owner.close()
    },
  }
}

/** 그 게임 시각(0~23)의 실측 ms. 물때를 열고 닫는 시험이 시계를 여기에 맞춘다. */
function atGameHour(hour: number): number {
  return GAME_EPOCH_MS + hour * 60 * REAL_MS_PER_GAME_MINUTE
}

/** 화자가 있는 맵으로 걸어 넘어간다. 대화 라우트는 같은 맵에 서 있어야 답한다. */
async function enterSpeakerMap(me: TestPlayer): Promise<void> {
  await step(me, transitionBetween(startLocation(loadGameData()).mapId, speakerMapId(ELDER)))
}

/** GIT_SHA 를 잠깐 갈아 끼운다. 끝나면 원래대로 — 다음 테스트가 이 값을 물려받으면 안 된다. */
async function withGitSha<T>(value: string | undefined, body: () => Promise<T>): Promise<T> {
  const before = process.env.GIT_SHA
  if (value === undefined) delete process.env.GIT_SHA
  else process.env.GIT_SHA = value
  try {
    return await body()
  } finally {
    if (before === undefined) delete process.env.GIT_SHA
    else process.env.GIT_SHA = before
  }
}

/**
 * 채집장노인이 확실히 "서 있는" 실측 시각 — 걷는 창을 피해 고른다.
 *
 * 채집장노인.sched: 06:00 초소 → 12:00 심층광맥곁 → 15:00 초소 → (다음 날) 06:00 초소.
 * 마지막 줄(15:00)의 다음 줄은 다음 날 06:00 인데 지점이 같은 초소다 — 구운
 * 걸음이 없어(npcStateAt 의 walkMs=0) 15:00 도착부터 다음 날 06:00 도착
 * 직전까지 내내 서 있다. 그 구간 한복판(게임 시각 20:00, 다음 걸음 시작까지
 * 게임 10시간 = 실측 25분 여유)을 고르면 06:00→12:00, 12:00→15:00 두 걷는
 * 창을 확실히 피한다 — 걸음 수가 얼마든 몇 초~몇 분짜리 창이 이 여유를 넘지
 * 않는다.
 *
 * 이 값 대신 실제 Date.now() 를 쓰면, 실행 시각이 이 걷는 창 중 하나에 걸릴
 * 때마다 대화 라우트가 not_here 로 응답해 talk 관련 단정이 벽시계에 따라
 * 흔들린다 — 아래에서 이 시각으로 서버 시계를 고정하는 이유다.
 */
function elderStandingMs(): number {
  return GAME_EPOCH_MS + 20 * 60 * REAL_MS_PER_GAME_MINUTE
}

/** 서버 시계를 채집장노인이 서 있는 시각에 고정한다. 끝나면 실제 시계로 되돌린다. */
async function withElderStanding<T>(body: () => Promise<T>): Promise<T> {
  vi.setSystemTime(elderStandingMs())
  try {
    return await body()
  } finally {
    vi.useRealTimers()
  }
}

describe('GET /api/health', () => {
  it('200 과 데이터 개수를 반환한다', async () => {
    await withGitSha(undefined, async () => {
      const app = await buildTestApp()
      const me = await asPlayer(app)
      const res = await me.inject({ method: 'GET', url: '/api/health' })

      // 밸런스 CSV 를 정당하게 고칠 때마다 이 패키지의 무관한 테스트가 깨지는 것을
      // 막기 위해 하드코딩된 개수 대신 loadGameData() 에서 기대값을 뽑는다.
      // 그래도 라우트가 실제 개수 보고를 멈추면(예: 필드를 하드코딩하거나 뒤바꾸면)
      // 여전히 실패해야 하므로, 데이터가 최소한 비어 있지 않다는 것도 함께 확인한다.
      const data = loadGameData()
      const itemCount = Object.keys(data.items).length
      const nodeCount = Object.keys(data.nodes).length
      const recipeCount = Object.keys(data.recipes).length
      expect(itemCount).toBeGreaterThan(0)
      expect(nodeCount).toBeGreaterThan(0)
      expect(recipeCount).toBeGreaterThan(0)

      expect(res.statusCode).toBe(200)
      // GIT_SHA 가 없는 채로(로컬 개발, `docker build` 없이 tsx 로 바로 띄운 경우)
      // 'dev' 를 돌려준다 — 배포된 서버와 구분하기 위해서다.
      expect(res.json()).toEqual({
        ok: true,
        items: itemCount,
        nodes: nodeCount,
        recipes: recipeCount,
        sha: 'dev',
      })

      await app.close()
    })
  })

  it('GIT_SHA 환경변수가 있으면 그 값을 sha 로 돌려준다', async () => {
    await withGitSha('abc1234', async () => {
      const app = await buildTestApp()
      const me = await asPlayer(app)
      const res = await me.inject({ method: 'GET', url: '/api/health' })

      expect(res.statusCode).toBe(200)
      expect(res.json().sha).toBe('abc1234')

      await app.close()
    })
  })

  it('없는 경로는 404 를 반환한다', async () => {
    const app = await buildTestApp()
    const me = await asPlayer(app)
    const res = await me.inject({ method: 'GET', url: '/api/nope' })
    expect(res.statusCode).toBe(404)
    await app.close()
  })
})

describe('GET /api/state', () => {
  it('플레이어 상태를 반환한다', async () => {
    const app = await buildTestApp()
    const me = await asPlayer(app)
    const res = await me.inject({ method: 'GET', url: '/api/state' })

    expect(res.statusCode).toBe(200)
    const body = res.json() as { player: { skills: Record<string, number> } }
    expect(body.player.skills.mineral).toBe(0)

    await app.close()
  })

  it('응답이 프로토콜 스키마를 만족한다', async () => {
    const app = await buildTestApp()
    const me = await asPlayer(app)
    const res = await me.inject({ method: 'GET', url: '/api/state' })

    // 클라이언트가 이 스키마로 응답을 검증한다(Task 10). 서버가 먼저 지키는지 확인한다.
    expect(() => StateResponseSchema.parse(res.json())).not.toThrow()

    await app.close()
  })

  // 왜: 여기가 습관이 뒤집히는 자리다. 지금까지 서버는 형식이 맞지 않는 세이브를
  //     조용히 버리고 새 플레이어를 만들어 줬다 — 개발용 세이브 하나뿐일 때는
  //     편했지만, 남의 진행도에 대해서는 그것이 곧 삭제이고 되돌릴 수도 없다.
  //     이제는 요청이 500 으로 끝나고 파일의 그 행은 손대지 않은 채 남는다.
  //     400 이 아닌 이유: 요청은 멀쩡했고 잘못된 것은 우리가 가진 자료다.
  it('읽을 수 없는 세이브는 500 이고, 그 행은 새 캐릭터로 갈아 치워지지 않는다', async () => {
    // 캐릭터 키를 이제 가입이 발급하므로, 깨진 행을 심으려면 먼저 진짜 사람이
    // 있어야 한다 — 가입하고 캐릭터를 만든 뒤 그 행만 옛 형식으로 갈아 끼운다.
    const before = await buildTestApp()
    const me = await asPlayer(before)
    const file = saveFileOf(before)
    // 예전 형식: 숙련도가 { level, xp } 객체였다.
    const broken = { id: me.id, skills: { mining: { level: 3, xp: 10 } } }
    writeRawCharacter(file, me.id, broken)

    // 같은 파일 위에 앱을 다시 세운다. 세션도 그 파일에 있으므로 같은 토큰으로
    // 이어 앉는다 — 로그인한 사람이 자기 세이브를 여는 그 순간을 재현하는 것이다.
    const app = await buildTestApp({ dataFile: file })
    const resumed = await asPlayer(app, { resume: me })
    const res = await resumed.inject({ method: 'GET', url: '/api/state' })

    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ code: 'character_unreadable' })
    expect(rawSaveOf(app)[me.id]).toEqual(broken)

    await app.close()
    // 임시 디렉터리를 지우는 것은 파일을 만든 쪽이다 — 나중에 닫는다.
    await before.close()
  })

  it('다시 호출해도 같은 플레이어를 돌려준다', async () => {
    const app = await buildTestApp()
    const me = await asPlayer(app)
    const first = await me.inject({ method: 'GET', url: '/api/state' })
    const second = await me.inject({ method: 'GET', url: '/api/state' })

    expect(second.json()).toEqual(first.json())

    await app.close()
  })
})

describe('POST /api/gather', () => {
  // 이 스위트의 노드가 얼음 광맥인 이유: 시작 지급이 마을 도구 1개(눈의마을 =
  // 구리 정)라, 신규 캐릭터의 도구가 실제로 여는 노드가 얼음이다. 맨손 채집도
  // 허용되지만(도구 루프 설계 §2 — 페널티일 뿐 게이트가 아니다) 라우트 시험은
  // 도구를 든 기본 경로를 본다 — 맨손·엉뚱한 도구는 서비스 테스트의 몫이다.
  it('얼음 광맥 채집 요청을 처리한다 — 성패와 무관하게 숙련이 오른다', async () => {
    const app = await buildTestApp()
    const me = await asPlayer(app)
    await enterField(me)

    const res = await me.inject({
      method: 'POST',
      url: '/api/gather',
      payload: { instanceId: 'ice_vein-1' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json() as {
      success: boolean
      gained: { itemId: string; count: number } | null
      skillGained: number
      player: { id: string; skills: { ice: number } }
    }
    // chance 는 은퇴했다(설계 §7-앞 2) — 표가 무엇이 나오는지 정하지, 확률을 보여주지 않는다.
    expect(body).not.toHaveProperty('chance')
    // 성패는 서버 난수라 단정할 수 없지만, 숙련은 성패와 무관하게 오른다
    // (설계 §7-앞 7). ice 표(gather_tables.csv)의 skillGainMin~Max 는 1~2.
    expect(body.skillGained).toBeGreaterThanOrEqual(1)
    expect(body.skillGained).toBeLessThanOrEqual(2)
    expect(body.player.skills.ice).toBe(body.skillGained)
    if (body.success) {
      expect(body.gained).toEqual({ itemId: expect.any(String), count: 1 })
    } else {
      expect(body.gained).toBeNull()
    }
    // 'local' 을 글자로 적지 않는다 — 신원이 헬퍼로 옮겨 갔으므로 기대값도 거기서 온다.
    expect(body.player.id).toBe(me.id)

    await app.close()
  })

  it('판정 결과를 저장해서 다음 조회에 반영한다', async () => {
    const app = await buildTestApp()
    const me = await asPlayer(app)
    await enterField(me)

    const gather = await me.inject({
      method: 'POST',
      url: '/api/gather',
      payload: { instanceId: 'ice_vein-1' },
    })
    const outcome = gather.json() as { player: { nextActionAt: number } }

    const state = await me.inject({ method: 'GET', url: '/api/state' })
    const saved = state.json() as { player: { nextActionAt: number } }

    // 성패는 서버 난수라 단정할 수 없지만, 간격은 성패와 무관하게 걸리고 저장된다.
    expect(saved.player.nextActionAt).toBe(outcome.player.nextActionAt)

    await app.close()
  })

  it('응답에 achieved 배열이 실린다', async () => {
    const app = await buildTestApp()
    const me = await asPlayer(app)
    await enterField(me)

    const res = await me.inject({
      method: 'POST',
      url: '/api/gather',
      payload: { instanceId: 'ice_vein-1' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json() as { achieved: unknown }
    expect(Array.isArray(body.achieved)).toBe(true)

    // ice 숙련도의 가장 낮은 이정표(ice_1000)도 1000 인데 ice_vein 채집
    // 한 번은 숙련도를 1~2 만 올리므로, 신규 플레이어는 이 한 번으로 어떤 문턱도
    // 넘지 못한다 — 빈 배열이 기대값이다. 그래도 이 필드가 서비스 계층을 넘어 HTTP
    // 응답까지 실제로 실려 오는지는 이 단정 없이는 아무도 확인하지 못했다.
    expect(body.achieved).toEqual([])

    await app.close()
  })

  it('간격 안에 재요청하면 400 too_fast 를 반환한다', async () => {
    const app = await buildTestApp()
    const me = await asPlayer(app)
    await enterField(me)

    await me.inject({ method: 'POST', url: '/api/gather', payload: { instanceId: 'ice_vein-1' } })
    const res = await me.inject({
      method: 'POST',
      url: '/api/gather',
      payload: { instanceId: 'ice_vein-1' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ code: 'too_fast' })

    await app.close()
  })

  // 왜: 저장이 비동기가 된 순간 생긴 구멍이다. 두 요청이 **나란히** 들어오면
  //     `읽기 → 판정 → 쓰기` 사이에 서로가 통째로 끼어들 수 있다 — 둘 다 같은
  //     상태를 읽고, 둘 다 "간격이 지났다"고 판정하고, 나중에 쓴 쪽이 먼저 쓴
  //     쪽의 결과를 덮는다. 오류는 하나도 나지 않고 광석 하나와 숙련도 한 줌만
  //     조용히 사라진다. 위의 순차 테스트는 이것을 절대 잡지 못한다.
  //
  //     저장소를 일부러 기다리게 감싸는 이유: JSON 파일 저장소는 읽기가 메모리라
  //     읽기와 쓰기 사이에 **진짜 대기가 없고**, 그래서 이 구멍이 우연히 닫혀
  //     있다. 그 우연은 저장소가 프로세스 밖으로 나가는 순간(Postgres) 사라진다.
  //     정합성을 스케줄러의 운에 맡기지 않으려면 기다리는 저장소를 앉혀 놓고
  //     시험해야 한다. 판본을 견주는 저장(applyToCharacter)이 없으면 이 테스트는
  //     200 을 둘 받고 실패한다.
  it('동시에 들어온 두 채집 중 하나만 통과한다 — 나중 것이 먼저 것을 덮지 않는다', async () => {
    const app = await buildTestApp({ waitingStore: true })
    const me = await asPlayer(app)
    await enterField(me)

    const gather = () =>
      me.inject({ method: 'POST', url: '/api/gather', payload: { instanceId: 'ice_vein-1' } })
    const [first, second] = await Promise.all([gather(), gather()])

    const codes = [first.statusCode, second.statusCode].sort()
    expect(codes).toEqual([200, 400])
    const rejected = first.statusCode === 400 ? first : second
    expect(rejected.json()).toEqual({ code: 'too_fast' })

    // 통과한 쪽의 결과가 저장에 남아 있어야 한다 — 덮어써졌다면 간격이 0 으로
    // 돌아가 이 단정이 깨진다.
    const accepted = first.statusCode === 200 ? first : second
    const outcome = accepted.json() as { player: { nextActionAt: number } }
    const state = await me.inject({ method: 'GET', url: '/api/state' })
    expect((state.json() as { player: { nextActionAt: number } }).player.nextActionAt).toBe(
      outcome.player.nextActionAt,
    )

    await app.close()
  })

  it('심층 노드도 같은 기술의 시작 도구로 캘 수 있다 — 등급 게이트는 폐지됐다(§7-앞 8)', async () => {
    // 예전에는 심층 노드(tier 2)가 1티어 시작 도구를 거부했다. 표 모델에서
    // **도구 등급은 접근이 아니라 확률 보정(G3)의 재료**이므로 구리 손도 캔다.
    //
    // 이 사람이 결계를 실제로 넘어 들어가는 것은 그 사실을 재기 위한 준비일
    // 뿐이다 — 이 단정이 재는 것은 여전히 도구 등급이다. 예전에는 벽 **바깥**에
    // 선 채로 물어도 200 이 나왔고(맵 검사에게 결계 안팎은 같은 맵이다), B8 이
    // 그 구멍을 막으면서 이 무대도 정직해졌다: 안에 있는 사람에게 물어야
    // "도구 등급이 거절하지 않는다"가 실제로 증명된다.
    const deep = deepPlacement()
    const gate = barrierGateOf(deep.mapId)
    const seeded = await playerWithSkills({ [gate.gateSkill!]: gate.gateValue! })
    await walkTo(seeded.me, deep.mapId)
    await step(seeded.me, gate)

    const res = await seeded.me.inject({
      method: 'POST',
      url: '/api/gather',
      payload: { instanceId: deep.instanceId },
    })

    expect(res.statusCode).toBe(200)

    await seeded.close()
  })

  // 왜: **이 아크가 만든 구멍이다.** 결계는 맵 안 전환이라 맵 검사에게 안팎이
  //     같은 맵이고, 심층 instanceId 는 맵 JSON 을 받는 클라이언트의 손에 이미
  //     있다 — 이 줄이 없으면 결계가 이 아크의 전부인데 devtools 로 우회된다.
  //     서비스 단위 테스트가 판정을 보지만, 라우트가 그 코드를 그대로 내보내고
  //     저장을 막지 않으면 게임에서는 아무 일도 안 일어난다.
  it('결계 밖에 선 채로 심층 노드를 요청하면 400 wrong_side 이고 상태가 그대로다', async () => {
    const app = await buildTestApp()
    const me = await asPlayer(app)
    const deep = deepPlacement()
    // 문 **앞까지만** 간다. 넘지 않았으므로 저장된 위치는 벽 바깥이다.
    await walkTo(me, deep.mapId)

    const before = await me.inject({ method: 'GET', url: '/api/state' })
    const res = await me.inject({
      method: 'POST',
      url: '/api/gather',
      payload: { instanceId: deep.instanceId },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ code: 'wrong_side' })

    // 거절이 저장까지 갔는지 본다 — 숙련도 간격도 움직이면, 못 캐게 막은 것이
    // 아니라 "아이템 없이 캐게" 한 것이 된다.
    const after = await me.inject({ method: 'GET', url: '/api/state' })
    expect((after.json() as { player: unknown }).player).toEqual(
      (before.json() as { player: unknown }).player,
    )

    await app.close()
  })

  // 왜: **"게이트를 다시 검사한다"는 틀린 고침을 막는 회귀 테스트다.** 허브 결계는
  //     물이 빠졌을 때만 들어갈 수 있지만, 안내판이 "나오는 길은 막지 않았다"고
  //     약속했고(설계 §6) 들어간 뒤에는 물이 차도 안에서 계속 캘 수 있어야 한다.
  //     채집 판정이 조건을 다시 재면 정당하게 들어간 사람이 물이 들어오는 순간
  //     손을 놓는다 — 묻는 것은 "조건을 만족하는가"가 아니라 "지금 그 안에
  //     있는가" 뿐이다.
  it('물때 결계 안에서는 물이 들어와도 계속 캔다 — 들어간 뒤에는 자리만 본다', async () => {
    const data = loadGameData()
    const 물때결계 = data.transitions.find((t) => t.gateTide === true)
    if (!물때결계) throw new Error('물때를 지는 결계가 transitions.csv 에 없다')
    const deep = Object.values(data.placements).find(
      (p) => p.mapId === 물때결계.toMap && data.nodes[p.nodeId]?.variant === 'deep',
    )
    if (!deep) throw new Error(`${물때결계.toMap} 에 심층 배치가 없다`)

    const seeded = await playerWithSkills({ [물때결계.gateSkill!]: 물때결계.gateValue! })
    try {
      // 물이 빠진 시각에 들어간다. TIDE_WINDOWS 는 2~8·14~20 이다.
      vi.setSystemTime(atGameHour(4))
      expect(isLowTide(gameTimeAt(Date.now()).hour)).toBe(true)
      await walkTo(seeded.me, 물때결계.fromMap)
      await step(seeded.me, 물때결계)

      // 그리고 물이 찬다. 지금 이 사람은 저 문을 **다시는 못 지난다**.
      vi.setSystemTime(atGameHour(12))
      expect(isLowTide(gameTimeAt(Date.now()).hour)).toBe(false)
      const 다시못들어감 = await seeded.me.inject({
        method: 'POST',
        url: '/api/move',
        payload: { x: 물때결계.fromX, y: 물때결계.fromY },
      })
      expect(다시못들어감.json()).toEqual({ code: 'locked' })

      // 그래도 안에서는 캔다.
      const res = await seeded.me.inject({
        method: 'POST',
        url: '/api/gather',
        payload: { instanceId: deep.instanceId },
      })
      expect(res.statusCode).toBe(200)
    } finally {
      vi.useRealTimers()
      await seeded.close()
    }
  })

  // 왜: 결계가 없는 맵(개발용 시험장)의 노드는 이 검사가 손댈 것이 없다. 구운
  //     목록에 그 맵이 아예 안 들어가므로, 거기 서 있는 사람은 지금까지처럼 캔다.
  it('결계가 없는 맵의 노드는 영향을 받지 않는다', async () => {
    const app = await buildTestApp()
    const me = await asPlayer(app)
    const 결계없는맵 = fieldMapId()
    // 전제부터 확인한다 — 이 맵에 결계가 생기는 날 이 테스트는 다른 것을 재게 된다.
    expect(
      loadGameData().transitions.some((t) => t.fromMap === 결계없는맵 && t.toMap === 결계없는맵),
    ).toBe(false)
    await walkTo(me, 결계없는맵)

    const res = await me.inject({
      method: 'POST',
      url: '/api/gather',
      payload: { instanceId: 'copper_vein-1' },
    })
    expect(res.statusCode).toBe(200)

    await app.close()
  })

  it('없는 인스턴스는 400 을 반환한다', async () => {
    const app = await buildTestApp()
    const me = await asPlayer(app)

    const res = await me.inject({
      method: 'POST',
      url: '/api/gather',
      payload: { instanceId: 'ghost_vein-1' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ code: 'unknown_node' })

    await app.close()
  })

  it('instanceId 가 없으면 400 을 반환한다', async () => {
    const app = await buildTestApp()
    const me = await asPlayer(app)

    const res = await me.inject({ method: 'POST', url: '/api/gather', payload: {} })
    expect(res.statusCode).toBe(400)

    await app.close()
  })
})

describe('POST /api/craft', () => {
  it('재료가 없으면 400 missing_materials 를 반환한다', async () => {
    const app = await buildTestApp()
    const me = await asPlayer(app)

    // copper_ingot 의 요구 숙련도가 0 이 되어 신규 플레이어(조합 숙련도 0)도 숙련도
    // 검사를 통과한다. 요구 숙련도가 1이던 Task 2 시점에는 숙련도 검사에 먼저 걸려
    // 이 재료 부족 분기에 닿을 수 없었다.
    const res = await me.inject({
      method: 'POST',
      url: '/api/craft',
      payload: { recipeId: 'copper_ingot' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ code: 'missing_materials' })

    await app.close()
  })

  it('숙련도가 모자라면 400 level_too_low 를 반환한다', async () => {
    const app = await buildTestApp()
    const me = await asPlayer(app)

    // 신규 플레이어는 조합 숙련도가 0이라 요구 숙련도가 높은 레시피에 닿지 못한다
    // (iron_pickaxe 요구치 500). 재료도 없지만 숙련도 검사가 먼저이므로
    // level_too_low 가 나와야 한다.
    const res = await me.inject({
      method: 'POST',
      url: '/api/craft',
      payload: { recipeId: 'iron_pickaxe' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ code: 'level_too_low' })

    await app.close()
  })

  it('없는 레시피는 400 unknown_recipe 를 반환한다', async () => {
    const app = await buildTestApp()
    const me = await asPlayer(app)

    const res = await me.inject({
      method: 'POST',
      url: '/api/craft',
      payload: { recipeId: 'ghost' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ code: 'unknown_recipe' })

    await app.close()
  })

  it('recipeId 가 없으면 400 을 반환한다', async () => {
    const app = await buildTestApp()
    const me = await asPlayer(app)

    const res = await me.inject({ method: 'POST', url: '/api/craft', payload: {} })
    expect(res.statusCode).toBe(400)

    await app.close()
  })
})

describe('POST /api/equip', () => {
  it('자기 인스턴스를 지목하면 착용을 반영한 플레이어 통째를 돌려준다', async () => {
    const app = await buildTestApp()
    const me = await asPlayer(app)

    // 신규 캐릭터의 유일한 인스턴스는 시작 도구다. 착용 중인 것을 다시 지목해도
    // 같은 값을 다시 쓸 뿐이라 성공이다(§4 — "아무 일 없음"이 곧 성공). 교체
    // 시나리오 자체는 서비스 테스트가 지키고, 여기서는 라우트 배선(스키마 →
    // 서비스 → 저장 → { player } 응답)을 본다.
    const state = await me.inject({ method: 'GET', url: '/api/state' })
    const starter = (state.json() as { player: { instances: { instanceId: string; itemId: string }[] } })
      .player.instances[0]!
    const slot = loadGameData().items[starter.itemId]?.toolSkill
    if (!slot) throw new Error(`시작 도구 ${starter.itemId} 의 toolSkill 이 없다`)

    const res = await me.inject({
      method: 'POST',
      url: '/api/equip',
      payload: { instanceId: starter.instanceId },
    })

    expect(res.statusCode).toBe(200)
    // 응답이 { player } 통째 관례(§6-앞 11)를 지키는지 — 상태 응답과 같은 스키마다.
    expect(() => StateResponseSchema.parse(res.json())).not.toThrow()
    const body = res.json() as { player: { equipped: Record<string, string> } }
    expect(body.player.equipped[slot]).toBe(starter.instanceId)

    await app.close()
  })

  it('없는 인스턴스는 400 unknown_instance 다', async () => {
    const app = await buildTestApp()
    const me = await asPlayer(app)

    const res = await me.inject({ method: 'POST', url: '/api/equip', payload: { instanceId: 'ghost' } })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ code: 'unknown_instance' })

    await app.close()
  })

  it('instanceId 가 없으면 400 이다', async () => {
    const app = await buildTestApp()
    const me = await asPlayer(app)

    const res = await me.inject({ method: 'POST', url: '/api/equip', payload: {} })
    expect(res.statusCode).toBe(400)

    await app.close()
  })
})

describe('POST /api/use', () => {
  /**
   * 사용 효과를 가진 아이템 하나. id 를 적지 않는 것은 상점 테스트와 같은 이유다 —
   * 여기 이름을 박으면 items.csv 가 바뀔 때 이 배선 시험이 거짓말을 한다.
   */
  function usable(): ItemDef {
    const item = Object.values(loadGameData().items)
      .filter((def) => def.useEffect)
      .sort((a, b) => a.id.localeCompare(b.id))[0]
    if (!item) throw new Error('items.csv 에 사용 효과를 가진 아이템이 없다')
    return item
  }

  /** 그 가루를 세이브에 직접 심고 그 위에 앱을 다시 세운다. 제작으로 만들려면 얼음 1,000 이 필요하다. */
  async function withPowder(
    count: number,
    body: (me: TestPlayer, item: ItemDef) => Promise<void>,
  ): Promise<void> {
    const item = usable()
    const before = await buildTestApp()
    const me = await asPlayer(before)
    const file = saveFileOf(before)

    const raw = rawSaveOf(before)[me.id] as { stacks: Record<string, number> }
    raw.stacks[item.id] = count
    writeRawCharacter(file, me.id, raw)

    const app = await buildTestApp({ dataFile: file })
    await body(await asPlayer(app, { resume: me }), item)

    await app.close()
    // 임시 디렉터리를 지우는 것은 파일을 만든 쪽이다 — 나중에 닫는다.
    await before.close()
  }

  it('가루를 쓰면 날씨가 실린 플레이어 통째를 돌려주고 그 상태가 저장된다', async () => {
    await withPowder(2, async (me, item) => {
      const res = await me.inject({ method: 'POST', url: '/api/use', payload: { itemId: item.id } })

      expect(res.statusCode).toBe(200)
      // 응답이 { player } 통째 관례를 지키는지 — 상태 응답과 같은 스키마다.
      expect(() => StateResponseSchema.parse(res.json())).not.toThrow()
      const body = res.json() as { player: { weather: { kind: string; untilMs: number } | null } }
      expect(body.player.weather?.kind).toBe(item.useEffect?.weather)
      expect(body.player.weather?.untilMs).toBeGreaterThan(Date.now())

      // 저장까지 갔는지 — 응답에만 있고 세이브에 없으면 새로고침이 되돌린다.
      const state = await me.inject({ method: 'GET', url: '/api/state' })
      const saved = state.json() as { player: { stacks: Record<string, number>; weather: unknown } }
      expect(saved.player.stacks[item.id]).toBe(1)
      expect(saved.player.weather).toEqual(body.player.weather)
    })
  })

  it('가지고 있지 않으면 400 missing_items 다', async () => {
    await withPowder(0, async (me, item) => {
      const res = await me.inject({ method: 'POST', url: '/api/use', payload: { itemId: item.id } })
      expect(res.statusCode).toBe(400)
      expect(res.json()).toEqual({ code: 'missing_items' })
    })
  })

  it('없는 아이템은 400 unknown_item 이다', async () => {
    const app = await buildTestApp()
    const me = await asPlayer(app)

    const res = await me.inject({ method: 'POST', url: '/api/use', payload: { itemId: 'ghost_powder' } })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ code: 'unknown_item' })

    await app.close()
  })

  it('itemId 가 없으면 400 이다', async () => {
    const app = await buildTestApp()
    const me = await asPlayer(app)

    const res = await me.inject({ method: 'POST', url: '/api/use', payload: {} })
    expect(res.statusCode).toBe(400)

    await app.close()
  })
})

describe('POST /api/enhance', () => {
  /**
   * 신규 캐릭터의 세이브에 예비 도구와 (원하면) 재료·골드를 직접 심고, 그 파일로
   * 앱을 다시 세운다. API 로 예비 도구를 만들려면 제작 난수를 기다려야 해서
   * 라우트 시험이 결정적이지 않게 된다.
   *
   * 재료·골드까지 심게 된 것은 강화가 원작 UL4 로 돌아갔기 때문이다(§6-앞 11) —
   * 1티어 +1 은 `hard_log×5 + 5,000골드` 를 함께 먹는다.
   */
  async function withSpare(seed: { stacks?: Record<string, number>; gold?: number } = {}) {
    const before = await buildTestApp()
    const me = await asPlayer(before)
    const file = saveFileOf(before)

    const raw = rawSaveOf(before)[me.id] as {
      instances: { instanceId: string; itemId: string; enhanceLevel: number }[]
      stacks: Record<string, number>
      gold: number
    }
    raw.instances.push({ instanceId: 'spare-1', itemId: raw.instances[0]!.itemId, enhanceLevel: 0 })
    if (seed.stacks) raw.stacks = { ...raw.stacks, ...seed.stacks }
    if (seed.gold !== undefined) raw.gold = seed.gold
    writeRawCharacter(file, me.id, raw)

    const app = await buildTestApp({ dataFile: file })
    return { before, app, resumed: await asPlayer(app, { resume: me }) }
  }

  it('예비 도구·재료·골드를 함께 먹고 착용 도구가 +1 된 채 저장된다', async () => {
    const { before, app, resumed } = await withSpare({ stacks: { hard_log: 7 }, gold: 6_000 })
    const res = await resumed.inject({
      method: 'POST',
      url: '/api/enhance',
      payload: { materialInstanceId: 'spare-1' },
    })

    expect(res.statusCode).toBe(200)
    expect(() => StateResponseSchema.parse(res.json())).not.toThrow()
    const body = res.json() as {
      player: { instances: { enhanceLevel: number }[]; stacks: Record<string, number>; gold: number }
    }
    expect(body.player.instances).toHaveLength(1)
    expect(body.player.instances[0]!.enhanceLevel).toBe(1)
    // 재료·골드가 실제로 줄었다 = 라우트가 GameData(items·enhanceCosts)를 서비스에
    // 넘겼다는 증거다. 넘기지 않으면 이 라우트는 판정 자체를 할 수 없다.
    expect(body.player.stacks['hard_log']).toBe(2)
    expect(body.player.gold).toBe(1_000)

    // 저장까지 갔는지 — 강화가 응답에만 있고 세이브에 없으면 새로고침이 되돌린다.
    const state = await resumed.inject({ method: 'GET', url: '/api/state' })
    const saved = state.json() as {
      player: { instances: { enhanceLevel: number }[]; stacks: Record<string, number>; gold: number }
    }
    expect(saved.player.instances).toHaveLength(1)
    expect(saved.player.instances[0]!.enhanceLevel).toBe(1)
    expect(saved.player.stacks['hard_log']).toBe(2)
    expect(saved.player.gold).toBe(1_000)

    await app.close()
    // 임시 디렉터리를 지우는 것은 파일을 만든 쪽이다 — 나중에 닫는다.
    await before.close()
  })

  it('재료가 없으면 400 missing_enhance_materials 다 — 신규 캐릭터의 맨손 강화가 이 자리다', async () => {
    const { before, app, resumed } = await withSpare({ gold: 1_000_000 })
    const res = await resumed.inject({
      method: 'POST',
      url: '/api/enhance',
      payload: { materialInstanceId: 'spare-1' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ code: 'missing_enhance_materials' })

    await app.close()
    await before.close()
  })

  it('재료는 있는데 골드가 모자라면 400 not_enough_gold 다', async () => {
    const { before, app, resumed } = await withSpare({ stacks: { hard_log: 99 }, gold: 4_999 })
    const res = await resumed.inject({
      method: 'POST',
      url: '/api/enhance',
      payload: { materialInstanceId: 'spare-1' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ code: 'not_enough_gold' })

    await app.close()
    await before.close()
  })

  it('착용 중인 인스턴스를 재료로 지목하면 400 material_equipped 다', async () => {
    const app = await buildTestApp()
    const me = await asPlayer(app)

    // 신규 캐릭터의 유일한 인스턴스는 착용 중이다 — 그것을 재료로 지목한다.
    const state = await me.inject({ method: 'GET', url: '/api/state' })
    const starter = (state.json() as { player: { instances: { instanceId: string }[] } })
      .player.instances[0]!

    const res = await me.inject({
      method: 'POST',
      url: '/api/enhance',
      payload: { materialInstanceId: starter.instanceId },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ code: 'material_equipped' })

    await app.close()
  })

  it('없는 인스턴스는 400 unknown_instance 다', async () => {
    const app = await buildTestApp()
    const me = await asPlayer(app)

    const res = await me.inject({
      method: 'POST',
      url: '/api/enhance',
      payload: { materialInstanceId: 'ghost' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ code: 'unknown_instance' })

    await app.close()
  })

  it('materialInstanceId 가 없으면 400 이다', async () => {
    const app = await buildTestApp()
    const me = await asPlayer(app)

    const res = await me.inject({ method: 'POST', url: '/api/enhance', payload: {} })
    expect(res.statusCode).toBe(400)

    await app.close()
  })
})

/**
 * 거래 두 문. 서비스 테스트(tradeService.test.ts)가 판정을 지키므로 여기서
 * 보는 것은 **배선**이다: 스키마 → 서비스 → 저장 → `{ player }` 응답.
 *
 * 화자가 서 있는 시각으로 시계를 고정하는 이유는 대화 라우트와 같다 — 상점은
 * 그 사람이 그 자리에 있을 때만 열리므로(§6-앞 4), 벽시계에 맡기면 하루 중
 * 어느 순간에 돌리느냐에 따라 not_here 로 흔들린다.
 */
describe('POST /api/shop/sell·buy', () => {
  /** 채집장노인이 여는 상점. 어느 상점인지는 등록부가 말한다 — 이름을 적으면 CSV 가 바뀔 때 거짓말이 된다. */
  function elderShop(): ShopDef {
    const shop = Object.values(loadGameData().shops).find((s) => s.speakerId === ELDER)
    if (!shop) throw new Error(`shops.csv 에 ${ELDER} 가 여는 상점이 없다`)
    return shop
  }

  /**
   * 그 상점이 사 주는 재료 하나. 정렬해 고르는 것은 데이터가 늘어도 같은 것을 고르기 위해서다.
   *
   * 매도 대상의 정의는 shared 의 isSellTarget 하나가 소유한다(sellTarget.ts) — 여기서
   * 그 conjunction 을 다시 적으면, 훗날 그 정의가 바뀔 때 이 배선 테스트만 옛 규칙으로
   * 남아 조용히 틀린 재료를 고른다.
   */
  function sellableAt(shop: ShopDef): ItemDef {
    const item = Object.values(loadGameData().items)
      .filter((def) => isSellTarget(def, shop))
      .sort((a, b) => a.id.localeCompare(b.id))[0]
    if (!item) throw new Error(`${shop.id} 이 사 주는 재료가 items.csv 에 없다`)
    return item
  }

  /**
   * 그 상점에서 **숙련으로 열리는** 진열 한 칸. 요구치가 가장 낮은 것 — 그것을
   * 살 수 있으면 배선이 산 것이다.
   *
   * 숙련 칸만 고르는 이유: 되사기 진열이 생기면서 한 상점의 진열에 두 종류의
   * 문이 섞였고(§6-앞 7), 총점으로 열리는 칸의 요구치(30·60)는 숙련 요구치
   * (10,000)보다 늘 작다 — 그냥 최솟값을 고르면 이 도우미는 증표가 아니라
   * 채집물을 집어 온다. 이 도우미를 쓰는 테스트가 묻는 것은 증표의 규칙
   * (`already_owned`)이라 그 칸이어야 한다.
   */
  function stockedAt(shop: ShopDef): { def: ItemDef; unlockSkill: number } {
    const entry = shop.stock
      .filter((e) => e.unlockBy === 'skill')
      .sort((a, b) => a.unlockAt - b.unlockAt)[0]
    if (!entry) throw new Error(`${shop.id} 에 숙련으로 열리는 진열이 없다`)
    const def = loadGameData().items[entry.itemId]
    if (!def) throw new Error(`진열한 ${entry.itemId} 가 items.csv 에 없다`)
    return { def, unlockSkill: entry.unlockAt }
  }

  /** 숙련도·재고·골드를 세이브에 직접 심고 그 위에 앱을 다시 세운다. */
  async function withStocked(
    plant: (raw: { skills: Record<string, number>; stacks: Record<string, number>; gold?: number }) => void,
    body: (me: TestPlayer) => Promise<void>,
  ): Promise<void> {
    await withElderStanding(async () => {
      const before = await buildTestApp()
      const me = await asPlayer(before)
      const file = saveFileOf(before)

      // API 로 숙련 5,000 을 쌓으려면 채집을 수천 번 해야 한다 — 라우트 시험이
      // 그 시간(과 난수)에 매달리면 안 되므로 세이브에 직접 심는다.
      const raw = rawSaveOf(before)[me.id] as {
        skills: Record<string, number>
        stacks: Record<string, number>
        gold?: number
      }
      plant(raw)
      writeRawCharacter(file, me.id, raw)

      const app = await buildTestApp({ dataFile: file })
      const resumed = await asPlayer(app, { resume: me })
      await enterSpeakerMap(resumed)
      await body(resumed)

      await app.close()
      // 임시 디렉터리를 지우는 것은 파일을 만든 쪽이다 — 나중에 닫는다.
      await before.close()
    })
  }

  it('가진 재료를 팔면 골드가 늘고, 그 상태가 저장된다', async () => {
    const shop = elderShop()
    const item = sellableAt(shop)

    await withStocked(
      (raw) => {
        raw.skills[shop.skill] = shop.unlockSkill
        raw.stacks[item.id] = 5
      },
      async (me) => {
        const res = await me.inject({
          method: 'POST',
          url: '/api/shop/sell',
          payload: { shopId: shop.id, itemId: item.id, count: 2 },
        })

        expect(res.statusCode).toBe(200)
        // 응답이 { player } 통째 관례를 지키는지 — 상태 응답과 같은 스키마다.
        expect(() => StateResponseSchema.parse(res.json())).not.toThrow()
        const body = res.json() as { player: { gold: number; stacks: Record<string, number> } }
        expect(body.player.gold).toBe(Math.floor(item.price / 2) * 2)
        expect(body.player.stacks[item.id]).toBe(3)

        // 저장까지 갔는지 — 응답에만 있고 세이브에 없으면 새로고침이 되돌린다.
        const state = await me.inject({ method: 'GET', url: '/api/state' })
        expect((state.json() as { player: { gold: number } }).player.gold).toBe(body.player.gold)
      },
    )
  })

  it('진열된 증표를 사면 골드가 줄고, 같은 것을 또 사려 하면 400 already_owned 다', async () => {
    const shop = elderShop()
    const { def, unlockSkill } = stockedAt(shop)
    const purse = def.price * 2

    await withStocked(
      (raw) => {
        raw.skills[shop.skill] = unlockSkill
        raw.gold = purse
      },
      async (me) => {
        const payload = { shopId: shop.id, itemId: def.id, count: 1 }
        const res = await me.inject({ method: 'POST', url: '/api/shop/buy', payload })

        expect(res.statusCode).toBe(200)
        expect(() => StateResponseSchema.parse(res.json())).not.toThrow()
        const body = res.json() as { player: { gold: number; stacks: Record<string, number> } }
        expect(body.player.gold).toBe(purse - def.price)
        expect(body.player.stacks[def.id]).toBe(1)

        // 증표는 하나로 충분하다는 것이 서버 규칙이다(§6-앞 14) — 돈이 남아 있어도 거절이다.
        const again = await me.inject({ method: 'POST', url: '/api/shop/buy', payload })
        expect(again.statusCode).toBe(400)
        expect(again.json()).toEqual({ code: 'already_owned' })
      },
    )
  })

  it('접근이 막히면 그 코드를 그대로 400 으로 낸다 — 숙련이 모자란 상점은 shop_locked 다', async () => {
    const shop = elderShop()
    const item = sellableAt(shop)

    await withStocked(
      (raw) => {
        raw.skills[shop.skill] = shop.unlockSkill - 1
        raw.stacks[item.id] = 5
      },
      async (me) => {
        const res = await me.inject({
          method: 'POST',
          url: '/api/shop/sell',
          payload: { shopId: shop.id, itemId: item.id, count: 1 },
        })
        expect(res.statusCode).toBe(400)
        expect(res.json()).toEqual({ code: 'shop_locked' })
      },
    )
  })

  it('규격 밖의 수량은 서비스에 닿기 전에 400 이다 — 0개·1000개·수량 없음', async () => {
    const app = await buildTestApp()
    const me = await asPlayer(app)
    const shop = elderShop()
    const item = sellableAt(shop)

    for (const count of [0, 1_000, 1.5, Number.NaN]) {
      for (const url of ['/api/shop/sell', '/api/shop/buy']) {
        const res = await me.inject({ method: 'POST', url, payload: { shopId: shop.id, itemId: item.id, count } })
        expect({ url, count, status: res.statusCode }).toEqual({ url, count, status: 400 })
        expect(res.json()).toEqual({ code: 'bad_request' })
      }
    }
    const missing = await me.inject({
      method: 'POST',
      url: '/api/shop/sell',
      payload: { shopId: shop.id, itemId: item.id },
    })
    expect(missing.statusCode).toBe(400)

    await app.close()
  })
})

describe('POST /api/talk', () => {
  it('화자에게 말을 걸면 발화 전체가 온다', async () => {
    await withElderStanding(async () => {
      const app = await buildTestApp()
      const me = await asPlayer(app)
      await enterSpeakerMap(me)
      const data = loadGameData()

      // 어떤 규칙이 뽑힐지는 서버 난수라 이 테스트가 통제할 수 없다. 대신 응답의
      // 첫 줄로 실제 콘텐츠(loadGameData)에서 그 규칙을 되짚어, 그 규칙의 발화
      // 전체와 응답을 비교한다 — `lines.length > 0` 만 보면 서비스가 발화를
      // 한 줄로 잘라 보내도(칸 하나만 보내도) 이 테스트는 계속 통과한다.
      const talkAndAssertFullUtterance = async (): Promise<string[]> => {
        const res = await me.inject({ method: 'POST', url: '/api/talk', payload: { speakerId: ELDER } })
        expect(res.statusCode).toBe(200)
        const body = res.json() as { speaker: string; lines: string[] }
        expect(body.speaker).toBe(ELDER)
        expect(body.lines.length).toBeGreaterThan(0)

        const rule = data.dialogue.find((r) => r.speaker === ELDER && r.lines[0] === body.lines[0])
        expect(rule, `첫 줄 "${body.lines[0]}" 로 실제 콘텐츠에서 규칙을 찾지 못했다`).toBeDefined()
        expect(body.lines).toEqual(rule!.lines)
        return body.lines
      }

      // 신규 플레이어에게 채집장노인의 무조건 @greet 후보는 정확히 둘이다 —
      // 한 줄짜리("허어, 또 왔는가.")와 두 줄짜리("또 왔군." / "부지런하기도
      // 하지."). 첫 콜은 서버 난수로 둘 중 하나가 나오고, 두 번째 콜은
      // recent 제외로 나머지 하나가 결정적으로 나온다(dialogue.ts selectDialogue
      // 의 "방금 말한 것 제외" 규칙) — 그래서 두 번을 부르면 두 줄짜리 발화를
      // 반드시 한 번은 검증하게 되고, 발화를 자르는 변이를 이 테스트가 매번
      // 잡을 수 있다.
      const first = await talkAndAssertFullUtterance()
      const second = await talkAndAssertFullUtterance()
      expect(second).not.toEqual(first)

      await app.close()
    })
  })

  it('대화 이력을 저장해서 다음 조회에 반영한다', async () => {
    await withElderStanding(async () => {
      const app = await buildTestApp()
      const me = await asPlayer(app)
      await enterSpeakerMap(me)

      const talk = await me.inject({ method: 'POST', url: '/api/talk', payload: { speakerId: ELDER } })
      expect(talk.statusCode).toBe(200)

      const state = await me.inject({ method: 'GET', url: '/api/state' })
      const saved = state.json() as {
        player: { dialogueHistory: { recent: Record<string, string[]>; lastTalkAt: Record<string, number> } }
      }

      // 저장하지 않으면 같은 인사가 매번 처음처럼 나오고 once 규칙은 영원히 한 번째다.
      expect(saved.player.dialogueHistory.recent[ELDER]).toHaveLength(1)
      expect(saved.player.dialogueHistory.lastTalkAt[ELDER]).toBeGreaterThan(0)

      await app.close()
    })
  })

  it('대화는 행동 간격을 소비하지 않는다', async () => {
    // 왜 withElderStanding: 이 시각을 고정하지 않으면 실행 시각이 채집장노인의
    // 걷는 창(06:00→12:00, 12:00→15:00)에 걸릴 때마다 /api/talk 이 not_here 로
    // 400 을 반환한다 — 그러면 이 불변식이 실제 대화가 아니라 빈 400 경로에서
    // "통과"하는 착시가 생긴다(다른 4개 대화 테스트와 같은 이유, 88b6feb).
    await withElderStanding(async () => {
      const app = await buildTestApp()
      const me = await asPlayer(app)
      await enterSpeakerMap(me)

      // 서비스 단위 테스트가 같은 것을 보지만, 라우트가 나중에 채집처럼 간격을
      // 걸도록 "통일"되는 순간 그 단위 테스트는 아무것도 막지 못한다.
      const before = await me.inject({ method: 'GET', url: '/api/state' })
      const talk = await me.inject({ method: 'POST', url: '/api/talk', payload: { speakerId: ELDER } })
      expect(talk.statusCode).toBe(200)
      const after = await me.inject({ method: 'GET', url: '/api/state' })

      const nextActionAt = (res: typeof before) => (res.json() as { player: { nextActionAt: number } }).player.nextActionAt
      expect(nextActionAt(after)).toBe(nextActionAt(before))

      await app.close()
    })
  })

  it('연달아 말을 걸어도 거부하지 않는다', async () => {
    await withElderStanding(async () => {
      const app = await buildTestApp()
      const me = await asPlayer(app)
      await enterSpeakerMap(me)

      // 채집이라면 두 번째가 too_fast 다. 대화에는 간격이 없다.
      await me.inject({ method: 'POST', url: '/api/talk', payload: { speakerId: ELDER } })
      const res = await me.inject({ method: 'POST', url: '/api/talk', payload: { speakerId: ELDER } })

      expect(res.statusCode).toBe(200)

      await app.close()
    })
  })

  it('없는 화자는 400 unknown_speaker 를 반환한다', async () => {
    const app = await buildTestApp()
    const me = await asPlayer(app)

    const res = await me.inject({ method: 'POST', url: '/api/talk', payload: { speakerId: '유령' } })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ code: 'unknown_speaker' })

    await app.close()
  })

  it('speakerId 가 없으면 400 을 반환한다', async () => {
    const app = await buildTestApp()
    const me = await asPlayer(app)

    const res = await me.inject({ method: 'POST', url: '/api/talk', payload: {} })
    expect(res.statusCode).toBe(400)

    await app.close()
  })
})

describe('POST /api/move', () => {
  /**
   * 시작 맵에서 실제로 밟을 수 있는 전환 첫 줄. 픽스처를 지어내면 CSV 가 바뀔 때
   * 이 테스트가 거짓말을 한다 — 그렇다고 표의 맨 앞 줄을 쓸 수도 없다: 신규
   * 플레이어는 시작 맵에 서 있고, 다른 맵의 전환 칸은 밟을 수 없기 때문이다.
   */
  const first = () => {
    const data = loadGameData()
    const start = startLocation(data).mapId
    const t = data.transitions.find((x) => x.fromMap === start)
    if (!t) throw new Error(`transitions.csv 에 시작 맵 "${start}" 에서 나가는 전환이 하나도 없다`)
    return t
  }

  it('전환 칸을 밟았다고 하면 도착 맵·칸으로 옮기고 저장한다', async () => {
    const app = await buildTestApp()
    const me = await asPlayer(app)
    const t = first()

    const res = await me.inject({ method: 'POST', url: '/api/move', payload: { x: t.fromX, y: t.fromY } })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { player: { location: unknown } }).player.location).toEqual({
      mapId: t.toMap,
      x: t.toX,
      y: t.toY,
    })

    // 저장하지 않으면 새로고침할 때마다 첫 맵으로 돌아간다 — 위치를 서버가 갖기로 한 이유다.
    const state = await me.inject({ method: 'GET', url: '/api/state' })
    expect((state.json() as { player: { location: { mapId: string } } }).player.location.mapId).toBe(t.toMap)

    await app.close()
  })

  it('전환이 없는 칸은 400 no_transition 이다', async () => {
    const app = await buildTestApp()
    const me = await asPlayer(app)
    // 요청은 목적지를 담지 않으므로, 전환이 없는 칸을 밟았다고 우겨도 갈 곳이 없다.
    const res = await me.inject({ method: 'POST', url: '/api/move', payload: { x: 0, y: 0 } })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ code: 'no_transition' })
    await app.close()
  })

  it('x·y 가 없으면 400 이다', async () => {
    const app = await buildTestApp()
    const me = await asPlayer(app)
    const res = await me.inject({ method: 'POST', url: '/api/move', payload: {} })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  /**
   * 실제로 출하된 결계 하나 — 시작 맵에서 **한 걸음에 닿는** 채집장의 것.
   *
   * 좌표도 계열도 적지 않는다: 결계는 CSV 가 정하고 B6 이 조건을 더할 자리라,
   * 여기 숫자를 박으면 그날 이 배선 시험이 거짓말을 한다(deepPlacement 과 같은 자세).
   */
  function shippedGate(): TransitionDef {
    const data = loadGameData()
    const oneStep = new Set(
      data.transitions.filter((t) => t.fromMap === startLocation(data).mapId).map((t) => t.toMap),
    )
    const found = data.transitions.find((t) => t.gateSkill !== undefined && oneStep.has(t.fromMap))
    if (!found) throw new Error('시작 맵에서 한 걸음에 닿는 맵에 게이트가 걸린 전환이 없다')
    return found
  }

  // 왜: 서비스 단위 테스트가 판정을 보지만, 라우트가 그 코드를 그대로 내보내지
  //     않으면 게임에서는 아무 일도 안 일어난다 — 결계가 출하 첫날 장식이 된다.
  it('결계 칸은 숙련이 모자라면 400 locked 이고 위치가 그대로다', async () => {
    const app = await buildTestApp()
    const me = await asPlayer(app)
    const gate = shippedGate()
    await step(me, transitionBetween(startLocation(loadGameData()).mapId, gate.fromMap))

    const before = await me.inject({ method: 'GET', url: '/api/state' })
    const res = await me.inject({ method: 'POST', url: '/api/move', payload: { x: gate.fromX, y: gate.fromY } })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ code: 'locked' })

    // 거절이 저장까지 갔는지 본다 — 라우트는 성공한 판정만 저장해야 한다.
    const after = await me.inject({ method: 'GET', url: '/api/state' })
    expect((after.json() as { player: unknown }).player).toEqual((before.json() as { player: unknown }).player)
    await app.close()
  })

  it('요구치를 채운 사람은 그 칸으로 넘어간다', async () => {
    const gate = shippedGate()
    const before = await buildTestApp()
    const me = await asPlayer(before)
    const file = saveFileOf(before)

    // 그 계열 숙련을 세이브에 직접 심는다 — 85,000 을 캐서 올리려면 몇 시간이다.
    const raw = rawSaveOf(before)[me.id] as { skills: Record<string, number> }
    raw.skills[gate.gateSkill!] = gate.gateValue!
    writeRawCharacter(file, me.id, raw)

    const app = await buildTestApp({ dataFile: file })
    const seeded = await asPlayer(app, { resume: me })
    await step(seeded, transitionBetween(startLocation(loadGameData()).mapId, gate.fromMap))

    const res = await seeded.inject({ method: 'POST', url: '/api/move', payload: { x: gate.fromX, y: gate.fromY } })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { player: { location: unknown } }).player.location).toEqual({
      mapId: gate.toMap, x: gate.toX, y: gate.toY,
    })

    await app.close()
    await before.close()
  })

  it('맵을 넘어간 뒤에는 이전 맵의 화자에게 말을 걸 수 없다', async () => {
    await withElderStanding(async () => {
      const app = await buildTestApp()
      const me = await asPlayer(app)
      await enterSpeakerMap(me)
      // 여기서는 말이 통한다 — 아래의 거절이 "원래 안 되는 것" 이 아니라 맵을
      // 넘어간 결과임을 못 박는다.
      const inside = await me.inject({ method: 'POST', url: '/api/talk', payload: { speakerId: ELDER } })
      expect(inside.statusCode).toBe(200)

      // 서비스 단위 테스트가 같은 것을 보지만, 그 검사는 라우트가 위치를 실제로
      // 저장하고 다시 읽어 오지 않으면 게임에서는 아무 효과가 없다 — 여기서
      // 확인하는 것이 그 연결이다.
      await step(me, transitionBetween(speakerMapId(ELDER), startLocation(loadGameData()).mapId))

      const res = await me.inject({ method: 'POST', url: '/api/talk', payload: { speakerId: ELDER } })
      expect(res.statusCode).toBe(400)
      expect(res.json()).toEqual({ code: 'wrong_map' })

      await app.close()
    })
  })

  it('맵을 넘어간 뒤에는 이전 맵의 노드를 캘 수 없다', async () => {
    const app = await buildTestApp()
    const me = await asPlayer(app)
    await enterField(me)
    await step(me, transitionBetween(fieldMapId(), startLocation(loadGameData()).mapId))

    const res = await me.inject({
      method: 'POST',
      url: '/api/gather',
      payload: { instanceId: 'copper_vein-1' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ code: 'wrong_map' })

    await app.close()
  })
})

describe('GET /api/time', () => {
  it('서버 현재 시각을 반환한다', async () => {
    const app = await buildTestApp()
    const me = await asPlayer(app)
    const before = Date.now()
    const res = await me.inject({ method: 'GET', url: '/api/time' })
    const after = Date.now()

    expect(res.statusCode).toBe(200)
    const body = res.json() as { serverNowMs: number }
    expect(body.serverNowMs).toBeGreaterThanOrEqual(before)
    expect(body.serverNowMs).toBeLessThanOrEqual(after)

    await app.close()
  })
})

describe('x-server-now 헤더', () => {
  it('모든 응답에 서버 시각이 실린다', async () => {
    const app = await buildTestApp()
    const me = await asPlayer(app)

    for (const url of ['/api/health', '/api/state', '/api/time']) {
      const res = await me.inject({ method: 'GET', url })
      const header = res.headers['x-server-now']
      expect(header, `${url} 에 헤더가 없다`).toBeDefined()
      expect(Number(header)).toBeGreaterThan(0)
    }

    await app.close()
  })

  it('POST 응답에도 실린다', async () => {
    const app = await buildTestApp()
    const me = await asPlayer(app)
    const res = await me.inject({
      method: 'POST',
      url: '/api/craft',
      payload: { recipeId: 'ghost' },
    })

    expect(res.statusCode).toBe(400)
    expect(Number(res.headers['x-server-now'])).toBeGreaterThan(0)

    await app.close()
  })

  it('없는 경로(404) 응답에도 실린다', async () => {
    const app = await buildTestApp()
    const me = await asPlayer(app)
    const res = await me.inject({ method: 'GET', url: '/api/nope' })

    expect(res.statusCode).toBe(404)
    expect(Number(res.headers['x-server-now'])).toBeGreaterThan(0)

    await app.close()
  })

  it('CORS 프리플라이트(OPTIONS) 응답에도 실린다', async () => {
    const app = await buildTestApp()
    const me = await asPlayer(app)

    // onSend 훅이 캡슐화된 자식 컨텍스트로 옮겨지거나 누군가 OPTIONS 를 특별
    // 취급하도록 리팩터링하면, 프리플라이트 응답에서만 헤더가 조용히 빠질 수 있다.
    // 그러면 브라우저는 실제 요청을 보내기도 전에 드리프트 감지에 쓸 기준 시각을
    // 하나 놓치게 되는데, 테스트가 없으면 이 회귀는 아무 것도 빨갛게 만들지 않는다.
    const res = await me.inject({
      method: 'OPTIONS',
      url: '/api/time',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'GET',
      },
    })

    expect(res.statusCode).toBe(204)
    expect(Number(res.headers['x-server-now'])).toBeGreaterThan(0)

    await app.close()
  })
})

describe('CORS exposedHeaders 설정', () => {
  it('Origin 요청에 access-control-expose-headers 로 x-server-now 를 실어 보낸다', async () => {
    const app = await buildTestApp()
    const me = await asPlayer(app)

    // app.ts 의 exposedHeaders: ['x-server-now'] 한 줄이 빠지거나 값이 바뀌면, 헤더
    // 자체는 여전히 응답에 실리지만 브라우저의 fetch 는 이 헤더를 볼 수 없게 된다.
    // app.inject() 는 Node 의 raw 응답을 읽을 뿐 브라우저의 CORS 가시성 필터링을
    // 적용하지 않으므로, 여기서는 서버가 Access-Control-Expose-Headers 를 실제로
    // 보내는지만 확인한다 — 브라우저 쪽 강제 여부는 이 테스트의 검증 범위가 아니다.
    const res = await me.inject({
      method: 'GET',
      url: '/api/time',
      headers: { origin: 'http://localhost:5173' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers['access-control-expose-headers']).toBe('x-server-now')

    await app.close()
  })
})
