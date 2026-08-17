import { readFileSync, readdirSync } from 'node:fs'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { emptyPlayer, loadGameData, startVillages, storyChainOf } from '@nogada/data'
import type { GameData, PlayerState, StoryStepDef } from '@nogada/shared'
import { describe, expect, it } from 'vitest'
import { FONT_SIZE } from './gameText.js'
import { BAND, questBandView } from './questBand.js'

/**
 * 헤더 밑 띠(설계 ⑧-6)가 **무엇을 적는가**를 잰다.
 *
 * 이 자가 못 재는 것을 먼저 적는다: **실제로 그려지는 모양은 브라우저에서만
 * 보인다.** 여기 있는 것은 글자를 만드는 함수 하나와 파일들을 읽는 검사라, 띠가
 * 정말 (131,39) 에 서는지·글자가 잘리는지는 사람이 812×375 로 띄워 봐야 한다
 * (태스크 보고에 적었다).
 *
 * 그래서 잡으려는 실패가 넷이다:
 * ① 문구가 두 벌이 되는 것 — `ALREADY_FULL_TEXT` 의 그 교훈이다. 띠가 story.csv
 *    를 읽지 않고 화면 쪽에 같은 글을 다시 타이핑하면, 언젠가 한쪽만 고쳐진다.
 * ② 사슬이 끝났는데도 띠가 남는 것 — 설계가 약속한 "끝나면 사라지고 다시 안
 *    뜬다"가 깨진다.
 * ③ 진행 숫자가 엉뚱한 수를 세는 것.
 * ④ 글이 띠(672px)보다 길어지는 것 — 화면에서는 잘리거나 넘쳐 보이는데, 표에
 *    글자를 더한 사람은 그 사실을 모른다.
 */

const data = loadGameData()

/** 마을 넷 각각에서 태어난 사람. 사슬은 한 벌이지만 슬롯은 마을마다 다르게 편다. */
function 마을사람들(): PlayerState[] {
  return startVillages(data).map((village) => {
    const player = emptyPlayer()
    player.location = { mapId: village.id, x: 0, y: 0 }
    return player
  })
}

/** 그 사람이 마디 `step` 에 서 있는 상태. 델타는 0 이다. */
function 마디에서(player: PlayerState, step: number, count = 0): PlayerState {
  return { ...player, story: step, storyCount: count }
}

describe('띠 — 문구의 출처', () => {
  it('마디마다의 글이 story.csv 에서 나온다 — 마을 넷 전부', () => {
    for (const player of 마을사람들()) {
      const chain = storyChainOf(data, player)
      expect(chain.length).toBeGreaterThan(0)
      for (const [step, def] of chain.entries()) {
        const line = questBandView(data, 마디에서(player, step)).line
        expect(line, `마디 ${step} 이 아무 말도 안 한다`).not.toBeNull()
        // 진행 숫자가 뒤에 붙을 수 있으므로 "그 문장으로 시작한다"까지 잰다.
        // 같기만 요구하면 숫자를 붙이는 마디를 이 자가 통째로 놓친다.
        expect(line!.startsWith(def.objective), `마디 ${step}: "${line}"`).toBe(true)
      }
    }
  })

  it('그 글자가 출하되는 클라이언트 소스에 한 벌도 없다 — 두 벌이 되면 한쪽만 고쳐진다', () => {
    // 띠의 문구는 전부 데이터에서 온다. 그래서 화면 쪽 코드 어디에도 사본이
    // 없어야 한다 — 이 검사 자신도 문장을 타이핑하지 않고 표에서 읽어 온다
    // (`ALREADY_FULL_TEXT` 의 교훈: 자가 곧 두 번째 사본이 되면 안 된다).
    //
    // 검사 파일은 세지 않는다. 재려는 실패는 **출하되는 화면 코드가 문장을 다시
    // 타이핑하는 것**이고, 검사의 산문은 그 사본이 될 수 없다 — 게다가 실제로
    // 물었다: gameStore.test.ts 가 붉은 얼음 광맥 이야기를 하다가 마디 1 의
    // 목적을 통째로 부분 문자열로 물고 있다.
    const 소스 = 소스파일들().map((f) => readFileSync(f, 'utf8'))
    for (const player of 마을사람들()) {
      for (const step of storyChainOf(data, player)) {
        if (step.objective === '') continue
        const 가진곳 = 소스.filter((s) => s.includes(step.objective))
        expect(가진곳, `"${step.objective}" 이 클라이언트 소스에 박혀 있다`).toHaveLength(0)
      }
    }
  })
})

describe('띠 — 언제 사라지는가', () => {
  it('사슬이 끝나면 안 뜬다', () => {
    for (const player of 마을사람들()) {
      const chain = storyChainOf(data, player)
      expect(questBandView(data, 마디에서(player, chain.length)).line).toBeNull()
      // 더 지나간 세이브(마디를 지운 날의 옛 세이브)도 같은 답이어야 한다 —
      // 색인이 표를 넘으면 사슬이 끝난 것이다(advanceStory 와 같은 자세).
      expect(questBandView(data, 마디에서(player, chain.length + 5)).line).toBeNull()
    }
  })

  it('캐릭터가 아직 없으면 안 뜬다', () => {
    expect(questBandView(data, null)).toEqual({ line: null, teachAction: false })
  })

  it('discoverable 이 아닌 마디는 목적도 테두리도 없다', () => {
    // 오늘 표는 열두 행이 전부 discoverable 이다(아크 1). 그래서 손잡이가 실제로
    // 도는지는 표를 바꿔 끼워서만 잴 수 있다 — 설계 ⑥ 방어①이 남긴 그 칸 하나가
    // 유도등을 통째로 끄는지가 이 검사의 질문이다.
    const 꺼진표: StoryStepDef[] = data.story.map((def) => ({
      ...def,
      discoverable: false,
      announce: def.announce === '' ? '지나갔다' : def.announce,
    }))
    const 꺼진세계: GameData = { ...data, story: 꺼진표 }
    for (const player of 마을사람들()) {
      expect(questBandView(꺼진세계, 마디에서(player, 0))).toEqual({ line: null, teachAction: false })
      expect(questBandView(꺼진세계, 마디에서(player, 1))).toEqual({ line: null, teachAction: false })
    }
  })
})

describe('띠 — 진행 숫자', () => {
  it('여러 번 세는 마디는 델타와 요구치를 함께 적는다', () => {
    for (const player of 마을사람들()) {
      const chain = storyChainOf(data, player)
      for (const [step, def] of chain.entries()) {
        const count = def.goal.count
        if (count === undefined || count <= 1) continue
        const line = questBandView(data, 마디에서(player, step, 3)).line
        expect(line, `마디 ${step}`).toContain(`3 / ${count.toLocaleString('ko-KR')}`)
      }
    }
  })

  it('한 번짜리 마디에는 숫자를 안 적는다 — 「0 / 1」 은 문장이 이미 한 말이다', () => {
    for (const player of 마을사람들()) {
      const chain = storyChainOf(data, player)
      for (const [step, def] of chain.entries()) {
        if (def.goal.count !== 1) continue
        expect(questBandView(data, 마디에서(player, step)).line, `마디 ${step}`).toBe(def.objective)
      }
    }
  })

  it('문을 나서는 마디에는 숫자가 없다 — 반쯤 나설 수는 없다', () => {
    for (const player of 마을사람들()) {
      const chain = storyChainOf(data, player)
      const step = chain.findIndex((s) => s.goal.kind === 'arrive')
      expect(step, 'arrive 마디가 사라졌다').toBeGreaterThanOrEqual(0)
      expect(questBandView(data, 마디에서(player, step)).line).toBe(chain[step]!.objective)
    }
  })

  it('숙련 마디는 이정표에서 지금 값을 읽는다 — 세이브에 그 수가 없다', () => {
    for (const player of 마을사람들()) {
      const chain = storyChainOf(data, player)
      const step = chain.findIndex((s) => s.goal.kind === 'reach')
      expect(step, 'reach 마디가 사라졌다').toBeGreaterThanOrEqual(0)
      const def = data.milestones.find((m) => m.id === chain[step]!.goal.arg)
      expect(def, '가리키는 이정표가 없다').toBeDefined()
      const metric = def!.metric
      expect(metric.kind, '이 검사는 숙련도 지표를 전제한다').toBe('skill')
      if (metric.kind !== 'skill') return

      // storyCount 를 엉뚱하게 읽는 구현이 초록이 되지 않게, 델타는 일부러 다른
      // 수로 둔다 — 이 마디가 봐야 하는 것은 숙련도다.
      const 걸어온사람 = 마디에서(player, step, 7)
      걸어온사람.skills = { ...player.skills }
      걸어온사람.skills[metric.skill] = 823
      expect(questBandView(data, 걸어온사람).line).toContain(
        `823 / ${def!.threshold.toLocaleString('ko-KR')}`,
      )
    }
  })
})

describe('A 테두리', () => {
  it('사슬이 A 를 처음 요구하는 마디에만 붙는다', () => {
    for (const player of 마을사람들()) {
      const chain = storyChainOf(data, player)
      const 첫채집 = chain.findIndex((s) => s.goal.kind === 'gather')
      expect(첫채집, 'gather 마디가 사라졌다').toBeGreaterThanOrEqual(0)
      for (const step of chain.keys()) {
        expect(questBandView(data, 마디에서(player, step)).teachAction, `마디 ${step}`).toBe(
          step === 첫채집,
        )
      }
      // 두 번째 채집 마디(손에 익을 때까지 캐라)에는 안 붙는다 — 이미 배운 것을
      // 다시 가르치지 않는다. 위 루프가 그것을 이미 재지만, 그 마디가 실제로
      // 존재한다는 것까지 못 박아 둔다.
      expect(chain.filter((s) => s.goal.kind === 'gather').length).toBeGreaterThan(1)
    }
  })

  it('사슬이 끝나면 테두리도 없다', () => {
    for (const player of 마을사람들()) {
      const chain = storyChainOf(data, player)
      expect(questBandView(data, 마디에서(player, chain.length)).teachAction).toBe(false)
    }
  })
})

/**
 * 한 글자가 화면에서 차지하는 폭 — **브라우저에서 실측해 옮긴 값이고, 위로 잡았다.**
 *
 * Neo둥근모 Pro 는 16 단위 격자 글꼴이라(gameText.FONT_SIZE) 글자 크기 16 에서
 * 한글이 정확히 16px 다. 아스키는 최대 8px 인데(숫자·영문 8), 실제로는 그보다
 * 좁은 것들이 섞인다 — 실측: 공백 5 · `,` 5 · `]` 5 · `[` 6 · `/` 6.2. 그래서 이
 * 모형은 **참값 아니면 그보다 크다**: 마을 넷 × 마디 전부(21줄)를 실제 Phaser
 * Text 로 재서 모형이 한 줄도 실측보다 작지 않은 것을 확인했다(가장 긴 줄
 * 실측 367px, 모형 400px).
 *
 * 위로 잡는 것이 이 자리에서 옳은 방향인 이유: 이 자가 막으려는 사고는 "글이
 * 띠보다 길어지는 것" 이므로, 틀리더라도 **빨리 빨개지는** 쪽으로 틀려야 한다.
 */
const 아스키폭 = FONT_SIZE.body / 2
const 한글폭 = FONT_SIZE.body

/** 그 글이 몇 px 인가. 아스키 반, 나머지 한 자. */
function 글폭(text: string): number {
  let sum = 0
  for (const ch of text) sum += (ch.codePointAt(0) ?? 0) < 0x80 ? 아스키폭 : 한글폭
  return sum
}

describe('띠 — 폭 예산', () => {
  it('마을 넷 × 마디 전부가 672px 안에 들어간다 — 진행 숫자가 가장 클 때까지', () => {
    // 안쪽 폭. 왼쪽 여백만큼 오른쪽도 비워 둔다(HudScene.layout).
    const 예산 = BAND.width - BAND.padding * 2
    for (const player of 마을사람들()) {
      const chain = storyChainOf(data, player)
      for (const [step, def] of chain.entries()) {
        // 가장 긴 순간은 델타가 요구치까지 찬 때다 —「200 / 200」이 「0 / 200」보다
        // 길다. 숙련 마디는 그 이정표의 문턱이 그 자리에 온다.
        const 최대 =
          def.goal.count ??
          data.milestones.find((m) => m.id === def.goal.arg)?.threshold ??
          0
        const line = questBandView(data, 마디에서(player, step, 최대)).line ?? ''
        expect(글폭(line), `마디 ${step}: "${line}"`).toBeLessThanOrEqual(예산)
      }
    }
  })
})

/**
 * apps/client/src 아래에서 **출하되는** 소스 전부 — 검사 파일은 뺀다.
 * 문구 사본을 셀 때 쓴다(orientationNotice.test 와 같은 자세).
 */
function 소스파일들(): string[] {
  const srcDir = fileURLToPath(new URL('..', import.meta.url))
  const 모은것: string[] = []
  const 걷기 = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) 걷기(p)
      else if (/\.test\.tsx?$/.test(e.name)) continue
      else if (['.ts', '.tsx', '.css', '.html'].includes(extname(e.name))) 모은것.push(p)
    }
  }
  걷기(srcDir)
  return 모은것
}
