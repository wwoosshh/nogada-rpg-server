import { useEffect, useMemo, useRef } from 'react'
import { useGameStore } from '../store/gameStore.js'
import { worldNow } from '../time/clock.js'
import { canAffordCraft, craftRepeatUnlocked } from './craftCardModel.js'

/**
 * 제작 버튼의 "누르고 있으면 반복" — 옛 Phaser 조합(ScrollList.heldGroup +
 * PanelScene.pollCraftPress/tryCraft)을 DOM 포인터 이벤트로 재현한다.
 * 처음에는 카드마다 붙었지만, 좌 목록·우 상세 재작업(설계 §8-뒤)으로 실행이
 * 상세 칸의 제작 버튼 하나에 모였다 — 컨트롤러의 규칙(게이트 3종·전역 pending
 * 하나)은 그대로고, 훅이 붙는 요소가 하나로 준 것뿐이다.
 *
 * 규칙은 순수부(createCraftHoldController)에 모두 있고, 훅은 포인터 이벤트와
 * rAF 를 그 위에 얇게 두른다:
 *
 * - pointerdown → 즉시 1회 시도. **반복은 craftRepeatUnlocked(조합 10,000
 *   이정표)가 참일 때만 쥔다**(설계 §8-앞 1) — 탭 1회는 항상 허용.
 * - 반복 루프는 고정 타이머가 아니라 rAF 폴링(프레임당 1회, ≤50ms)이다.
 *   서버의 행동 간격이 숙련도에 따라 500→50ms 로 줄기 때문에(§8-앞 2), 고정
 *   타이머는 고숙련을 스로틀하거나 거부 스팸을 만든다. 매 tick 세 문을 본다:
 *   패널 전역 pending 하나 · nextActionAt · canAffordCraft — 옛 tryCraft 의
 *   문 그대로다.
 * - pointerup/pointercancel/이동 10px 초과 → 중단. 10px 은 ScrollList 의
 *   PRESS_CANCEL_DISTANCE 와 같은 값이다. 스크롤 영역(레시피 목록·상세 본문)의
 *   pan-y 계약(§8-앞 10)은 그대로다 — 거기서 네이티브 스크롤이 개시되면
 *   pointercancel 이 오고, 그것도 같은 중단 경로를 탄다. 제작 버튼 자체는
 *   스크롤 영역 밖의 고정 발판이라 pan 할 것이 없다(ui.css 의 버튼 주석 참고).
 */

/** 누름을 취소하는 이동 임계값(px) — ScrollList.PRESS_CANCEL_DISTANCE 와 같은 스펙값. */
const PRESS_CANCEL_DISTANCE = 10

export interface CraftHoldDeps {
  /** 세계 시각(worldNow) — nextActionAt 과 같은 시계다. */
  now(): number
  nextActionAt(): number
  canAfford(recipeId: string): boolean
  repeatUnlocked(): boolean
  craft(recipeId: string): Promise<void>
}

export interface CraftHoldController {
  /** pointerdown — 즉시 1회 시도하고, 반복이 해금돼 있으면 쥔다. */
  press(recipeId: string): void
  /** pointerup/cancel/이동 초과 — 그 레시피를 쥐고 있었으면 놓는다. */
  release(recipeId: string): void
  /** 반복 루프의 한 걸음. 쥔 레시피가 없으면 아무 일도 없다. */
  tick(): void
  held(): string | null
}

/**
 * 홀드 반복의 순수부. 의존(시각·판정·요청)을 값으로 받아 rAF 도 DOM 도 없이
 * 검사할 수 있다.
 *
 * pending 이 **컨트롤러(=패널) 전역 하나**인 것이 요점이다(§8-앞 2): 어떤
 * 경로로 쥐어도 서버로 나가는 요청 루프는 하나여야 한다. 쥔 레시피(heldRecipe)도
 * 하나라서 나중 누름이 먼저 것을 덮는다 — ScrollList 의 heldGroupId 가 하나였던
 * 것과 같은 모양이다.
 */
export function createCraftHoldController(deps: CraftHoldDeps): CraftHoldController {
  let pending = false
  let heldRecipe: string | null = null

  /**
   * 옛 PanelScene.tryCraft 의 세 문 그대로: 응답을 기다리는 중이면 넘어가고,
   * 서버의 다음 행동 시각 전이면 넘어가고, 이미 화면에 보이는 이유(숙련도·
   * 재료 부족)로 거부될 게 뻔하면 보내지 않는다. 서버는 이 확인 없이도 스스로
   * 거부하므로 안전이 아니라 왕복 낭비를 막는 문이다.
   */
  const tryCraft = (recipeId: string): void => {
    if (pending) return
    if (deps.now() < deps.nextActionAt()) return
    if (!deps.canAfford(recipeId)) return

    pending = true
    void deps.craft(recipeId).finally(() => {
      pending = false
    })
  }

  return {
    press: (recipeId) => {
      tryCraft(recipeId)
      // 해금 전에는 쥐지 않는다 — 쥔 것이 없으면 tick 은 영원히 조용하므로,
      // "반복 타이머를 arm 하지 않는다"가 이 한 줄로 지켜진다(§8-앞 1).
      if (deps.repeatUnlocked()) heldRecipe = recipeId
    },
    release: (recipeId) => {
      if (heldRecipe === recipeId) heldRecipe = null
    },
    tick: () => {
      if (heldRecipe !== null) tryCraft(heldRecipe)
    },
    held: () => heldRecipe,
  }
}

/**
 * 실제 게임에 묶인 컨트롤러 하나 — 모듈 전역이다. 카드마다 훅이 붙지만 전부
 * 이 하나를 공유하므로 "패널 전역 pending 하나"가 성립한다. 판정은 스토어를
 * 매번 읽는다(반복 중에 재료·숙련도·nextActionAt 이 계속 변한다).
 */
const controller = createCraftHoldController({
  now: worldNow,
  nextActionAt: () => useGameStore.getState().player?.nextActionAt ?? Number.POSITIVE_INFINITY,
  canAfford: (recipeId) => {
    const { data, player } = useGameStore.getState()
    return player !== null && canAffordCraft(data, player, recipeId)
  },
  repeatUnlocked: () => {
    const { data, player } = useGameStore.getState()
    return player !== null && craftRepeatUnlocked(data, player)
  },
  craft: (recipeId) => useGameStore.getState().craft(recipeId),
})

let rafId: number | null = null

/** 쥔 레시피가 있는 동안만 도는 rAF 루프. 손을 놓으면 스스로 멎는다. */
function pumpLoop(): void {
  if (rafId !== null) return
  const step = (): void => {
    controller.tick()
    rafId = controller.held() === null ? null : requestAnimationFrame(step)
  }
  rafId = requestAnimationFrame(step)
}

export interface CraftHoldHandlers {
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void
  onPointerMove: (e: React.PointerEvent<HTMLElement>) => void
  onPointerUp: () => void
  onPointerCancel: () => void
}

/**
 * 제작 버튼에 붙일 포인터 핸들러 묶음. `recipeId` 는 지금 선택된 레시피,
 * `enabled` 는 그 레시피가 지금 제작 가능한가(state === 'ready')다 — 잠김/재료
 * 부족이면 pointerdown 자체를 무시해 서버로 아무것도 보내지 않는다(컨트롤러의
 * canAfford 문과 겹치지만, 둘 다 같은 canAffordCraft 를 읽으므로 판정 복제가
 * 아니다). 버튼에는 disabled 속성도 같이 걸리므로 이 가드는 이중 안전벨트다.
 */
export function useCraftHold(recipeId: string, enabled: boolean): CraftHoldHandlers {
  const origin = useRef<{ x: number; y: number } | null>(null)

  // 패널이 닫히거나(언마운트) 선택이 다른 레시피로 옮겨가면 쥔 것을 놓는다 —
  // 안 놓으면 rAF 루프가 화면에 없는 레시피를 계속 제작한다.
  useEffect(() => () => controller.release(recipeId), [recipeId])

  // 쥔 채로 재료가 떨어지면 버튼이 disabled 로 바뀌는데, disabled 요소는
  // pointerup 을 전달하지 않을 수 있다 — 그 순간 여기서 놓아야 rAF 루프가
  // (게이트에 막혀 조용하긴 해도) 헛돌지 않고 멎는다.
  useEffect(() => {
    if (!enabled) controller.release(recipeId)
  }, [recipeId, enabled])

  return useMemo(() => {
    const stop = (): void => {
      origin.current = null
      controller.release(recipeId)
    }

    return {
      onPointerDown: (e) => {
        if (!enabled) return
        origin.current = { x: e.clientX, y: e.clientY }
        // 손가락이 버튼 밖으로 흘러도 up/move 가 이 요소로 오게 한다 — 버튼
        // 가장자리에서 살짝 벗어난 채 떼면 놓은 줄 모르고 반복이 이어지는
        // 구멍을 캡처가 막는다.
        e.currentTarget.setPointerCapture(e.pointerId)
        controller.press(recipeId)
        if (controller.held() !== null) pumpLoop()
      },
      onPointerMove: (e) => {
        if (origin.current === null) return
        const dx = e.clientX - origin.current.x
        const dy = e.clientY - origin.current.y
        if (Math.hypot(dx, dy) > PRESS_CANCEL_DISTANCE) stop()
      },
      onPointerUp: stop,
      onPointerCancel: stop,
    }
  }, [recipeId, enabled])
}
