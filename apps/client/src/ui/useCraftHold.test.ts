import { describe, expect, it } from 'vitest'
import { createCraftHoldController, type CraftHoldDeps } from './useCraftHold.js'

/*
 * 홀드 반복의 순수부(createCraftHoldController)만 검사한다 — rAF 와 포인터
 * 이벤트는 훅(useCraftHold)이 얇게 두르는 배선이고, 게이트 규칙은 전부 이
 * 컨트롤러 안에 있다. 의존(시각·판정·요청)은 값으로 주입하므로 서버도 DOM 도
 * 필요 없다 — InputState.test 가 입력 소스를 흉내 내는 것과 같은 자세다.
 */

interface Harness {
  deps: CraftHoldDeps
  fired: string[]
  setNow(v: number): void
  setNextActionAt(v: number): void
  setAfford(v: boolean): void
  /** 떠 있는 craft 응답을 전부 되돌려주고 .finally 가 돌 때까지 기다린다. */
  settle(): Promise<void>
}

function harness(overrides: Partial<CraftHoldDeps> = {}): Harness {
  const fired: string[] = []
  const resolvers: Array<() => void> = []
  let now = 1_000
  let nextActionAt = 0
  let afford = true

  const deps: CraftHoldDeps = {
    now: () => now,
    nextActionAt: () => nextActionAt,
    canAfford: () => afford,
    repeatUnlocked: () => true,
    craft: (recipeId) => {
      fired.push(recipeId)
      return new Promise<void>((resolve) => resolvers.push(resolve))
    },
    ...overrides,
  }

  return {
    deps,
    fired,
    setNow: (v) => (now = v),
    setNextActionAt: (v) => (nextActionAt = v),
    setAfford: (v) => (afford = v),
    settle: async () => {
      for (const r of resolvers.splice(0)) r()
      await new Promise((r) => setTimeout(r, 0))
    },
  }
}

describe('반복 해금 게이트(§8-앞 1)', () => {
  // 왜: 홀드 반복은 crafting 10,000 이정표로 해금되는 기능이다. 미해금이면
  //     누르고 있어도 탭 1회로 끝나야 한다 — 조용히 반복이 켜지면 원작의
  //     첫 동기부여 장치가 죽는다.
  it('미해금이면 눌러도 held 가 남지 않아 tick 이 아무것도 안 쏜다', async () => {
    const h = harness({ repeatUnlocked: () => false })
    const c = createCraftHoldController(h.deps)

    c.press('copper_ingot')
    expect(h.fired).toEqual(['copper_ingot'])
    expect(c.held()).toBeNull()

    await h.settle()
    for (let i = 0; i < 5; i += 1) c.tick()
    expect(h.fired).toHaveLength(1)
  })

  it('해금이면 쥔 레시피가 남고 tick 이 반복을 잇는다', async () => {
    const h = harness()
    const c = createCraftHoldController(h.deps)

    c.press('copper_ingot')
    expect(c.held()).toBe('copper_ingot')
    await h.settle()

    c.tick()
    expect(h.fired).toEqual(['copper_ingot', 'copper_ingot'])
  })
})

describe('요청 게이트 셋 — pending · nextActionAt · afford(§8-앞 2)', () => {
  // 왜: 응답을 기다리는 동안 또 쏘면 서버 간격 판정과 무관하게 요청이 쌓인다.
  //     pending 하나가 패널 전역의 문이다.
  it('응답 대기 중에는 tick 이 겹쳐도 요청이 하나다', async () => {
    const h = harness()
    const c = createCraftHoldController(h.deps)

    c.press('copper_ingot')
    for (let i = 0; i < 5; i += 1) c.tick()
    expect(h.fired).toHaveLength(1)

    await h.settle()
    c.tick()
    expect(h.fired).toHaveLength(2)
  })

  // 왜: 서버 간격은 숙련도에 따라 500→50ms 로 준다 — 고정 타이머 대신 매 tick
  //     nextActionAt 을 폴링해야 고숙련을 스로틀하지도, 거부 스팸을 만들지도
  //     않는다.
  it('다음 행동 시각 전에는 쏘지 않고, 지나면 쏜다', async () => {
    const h = harness()
    const c = createCraftHoldController(h.deps)

    c.press('copper_ingot')
    await h.settle()

    h.setNextActionAt(1_500)
    c.tick()
    expect(h.fired).toHaveLength(1)

    h.setNow(1_500)
    c.tick()
    expect(h.fired).toHaveLength(2)
  })

  // 왜: 재료가 떨어지는 것은 반복 중에 일어나는 정상 종료다 — 거부 응답을
  //     받으러 계속 왕복하면 안 된다.
  it('재료가 떨어지면 루프가 멈춘다', async () => {
    const h = harness()
    const c = createCraftHoldController(h.deps)

    c.press('copper_ingot')
    await h.settle()

    h.setAfford(false)
    c.tick()
    expect(h.fired).toHaveLength(1)
  })

  // 왜: 잠긴/재료 부족 카드는 눌러도 서버로 보내지 않는다 — 옛 tryCraft 와
  //     같은 문이 탭 1회에도 걸린다.
  it('afford 가 안 되면 탭 1회도 보내지 않는다', () => {
    const h = harness({ canAfford: () => false })
    const c = createCraftHoldController(h.deps)

    c.press('copper_ingot')
    expect(h.fired).toHaveLength(0)
  })

  // 왜: 방금 제작한 직후의 탭은 서버가 too_fast 로 거부할 게 뻔하다 —
  //     sendGather 가 하는 것과 같은 확인을 탭에도 한다.
  it('다음 행동 시각 전의 탭은 보내지 않는다', () => {
    const h = harness()
    h.setNextActionAt(2_000)
    const c = createCraftHoldController(h.deps)

    c.press('copper_ingot')
    expect(h.fired).toHaveLength(0)
  })
})

describe('멀티터치 — 두 카드를 쥐어도 요청 루프는 하나(§8-앞 2)', () => {
  it('두 번째 누름이 쥔 것을 덮고, pending 은 여전히 하나다', async () => {
    const h = harness()
    const c = createCraftHoldController(h.deps)

    c.press('copper_ingot')
    c.press('copper_hammer') // 첫 요청이 아직 pending — 즉시 발화는 없다
    expect(h.fired).toEqual(['copper_ingot'])
    expect(c.held()).toBe('copper_hammer')

    await h.settle()
    c.tick()
    expect(h.fired).toEqual(['copper_ingot', 'copper_hammer'])
  })

  // 왜: 쥔 것은 하나뿐이므로, 이미 덮인 손가락이 떨어져도 지금 쥔 카드의
  //     반복은 끊기지 않아야 한다.
  it('덮인 카드의 release 는 지금 쥔 카드를 놓지 않는다', () => {
    const h = harness()
    const c = createCraftHoldController(h.deps)

    c.press('copper_ingot')
    c.press('copper_hammer')
    c.release('copper_ingot')
    expect(c.held()).toBe('copper_hammer')

    c.release('copper_hammer')
    expect(c.held()).toBeNull()
  })
})

describe('놓으면 멈춘다', () => {
  it('release 뒤의 tick 은 아무것도 쏘지 않는다', async () => {
    const h = harness()
    const c = createCraftHoldController(h.deps)

    c.press('copper_ingot')
    await h.settle()
    c.release('copper_ingot')

    c.tick()
    expect(h.fired).toHaveLength(1)
  })
})
