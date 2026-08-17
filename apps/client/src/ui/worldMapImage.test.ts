import { describe, expect, it } from 'vitest'
import { forgetIfRejected } from './worldMapImage.js'

/**
 * 전체화면 지도가 **한 번 실패한 뒤에도 다시 시도하는가**를 잰다.
 *
 * 이 자가 못 재는 것을 먼저 적는다: **그림이 실제로 나오는지도, 첫 열림이 몇 ms
 * 인지도 브라우저에서만 보인다.** `worldMapImage()` 자신은 `fetch`·`Image`·
 * `canvas` 셋을 다 쓰므로 여기서 부를 수 없다. 여기 있는 것은 그 함수의 캐시
 * 규칙 한 줄이고, 하필 그 한 줄이 **혼자만 틀릴 수 있는 종류**였다.
 *
 * 잡으려는 실패는 하나다: `x ??= 만들기()` 가 거절된 약속까지 붙잡는 것. 그러면
 * 지하철에서 한 번 끊긴 사람은 그 세션 내내 지도를 못 연다 — 두 번째 열림은
 * 요청조차 안 내보내고 같은 오류 문구만 다시 그린다. 화면에는 「지도를 못 그렸다」
 * 가 뜨므로 「지금 안 되는 것」이 아니라 「안 되는 것」으로 보이고, 새로고침이
 * 답이라는 것은 아무 데도 안 적혀 있다.
 */

/** `worldMapImage()` 안의 모듈 변수와 같은 모양의 칸 하나. */
function 캐시칸<T>(): { get: (make: () => Promise<T>) => Promise<T>; 남은것: () => Promise<T> | null } {
  let cell: Promise<T> | null = null
  return {
    get(make) {
      cell ??= forgetIfRejected(make(), () => {
        cell = null
      })
      return cell
    },
    남은것: () => cell,
  }
}

describe('worldMapImage — 캐시', () => {
  it('성공하면 두 번째부터 다시 안 만든다 — 「두 번째 열림 0ms」가 그 약속이다', async () => {
    const 칸 = 캐시칸<number>()
    let 만든횟수 = 0
    const make = async (): Promise<number> => {
      만든횟수++
      return 42
    }

    expect(await 칸.get(make)).toBe(42)
    expect(await 칸.get(make)).toBe(42)
    expect(await 칸.get(make)).toBe(42)
    expect(만든횟수, '성공한 뒤에도 다시 받았다').toBe(1)
  })

  it('실패하면 두 번째 열림이 **다시 시도한다**', async () => {
    const 칸 = 캐시칸<number>()
    let 만든횟수 = 0
    const make = async (): Promise<number> => {
      만든횟수++
      if (만든횟수 === 1) throw new Error('끊겼다')
      return 7
    }

    await expect(칸.get(make)).rejects.toThrow('끊겼다')
    // 거절된 약속이 칸에 남아 있으면 아래 호출은 make 를 안 부르고 같은 거절만
    // 되돌려준다 — 그것이 이 자가 잡는 실패다.
    expect(await 칸.get(make)).toBe(7)
    expect(만든횟수).toBe(2)
  })

  it('실패한 약속은 칸에서 지워진다 — 다음 사람이 붙잡는 것이 없다', async () => {
    const 칸 = 캐시칸<number>()
    await expect(칸.get(async () => Promise.reject(new Error('끊겼다')))).rejects.toThrow('끊겼다')
    expect(칸.남은것(), '거절된 약속이 캐시에 남았다').toBeNull()
  })

  it('두 번째가 성공하면 그때부터는 다시 붙잡는다', async () => {
    const 칸 = 캐시칸<number>()
    let 만든횟수 = 0
    const make = async (): Promise<number> => {
      만든횟수++
      if (만든횟수 === 1) throw new Error('끊겼다')
      return 7
    }

    await expect(칸.get(make)).rejects.toThrow()
    expect(await 칸.get(make)).toBe(7)
    expect(await 칸.get(make)).toBe(7)
    // 「실패하면 다시 시도한다」를 「매번 다시 받는다」로 고치면 폰이 열 때마다
    // 58KB 를 새로 받는다 — 그 둘은 다른 약속이다.
    expect(만든횟수).toBe(2)
  })

  it('원래의 거절 이유를 그대로 다시 던진다 — 화면에 뜨는 문장이 그것이다', async () => {
    const 칸 = 캐시칸<number>()
    const 이유 = new Error('전체 지도: "월드맵" 의 JSON 을 못 받았다 (503)')
    await expect(칸.get(async () => Promise.reject(이유))).rejects.toBe(이유)
  })
})
