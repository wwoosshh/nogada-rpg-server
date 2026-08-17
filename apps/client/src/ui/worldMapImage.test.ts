import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { WORLD_MAP_ID, type TiledMapJson } from '@nogada/data'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { forgetIfRejected } from './worldMapImage.js'

/**
 * 전체화면 지도의 **그림 한 장**을 잰다 — 받고, 굽고, 붙잡는 규칙 전부.
 *
 * 이 자가 못 재는 것을 먼저 적는다: **그려진 그림이 월드맵처럼 보이는지도, 첫
 * 열림이 몇 ms 인지도 브라우저에서만 보인다.** 여기서 잴 수 있는 것은 「몇 번
 * 받았는가 · 몇 배로 구웠는가 · 언제 다시 굽는가」다.
 *
 * **예전 이 파일은 구현을 한 번도 안 불렀다.** `worldMapImage()` 가 `fetch`·
 * `Image`·`canvas` 셋을 다 쓴다는 이유로, 파일 안에 같은 모양의 캐시 모형
 * (`캐시칸<T>()`)을 새로 적고 그 모형을 쟀다 — 92줄이 전부 그것이었다. 그래서
 * 검토가 `forgetIfRejected(…)` 를 통째로 벗겨 `mapJsonOnce ??= loadMapJson()` 으로
 * 바꿨을 때 118 파일 2,495 개가 전부 초록이었다. **이 파일 자신의 주석이
 * 「안 그러면 첫 열림이 네트워크 오류로 실패한 사람은 새로고침 전까지 지도를
 * 영영 못 연다」고 적은 그 버그다.** 같은 이유로 `bakedOnce` 의 키 규칙도,
 * `drawn === 0` 가드도, contain-fit 배율도 아무도 안 물었다.
 *
 * 그래서 셋을 흉내 내고 **진짜 함수를 부른다.** 흉내 내는 것은 브라우저가 주는
 * 것뿐이고 판정은 전부 구현의 것이다 — `InputState.test` 가 입력 소스를 흉내
 * 내는 것과 같은 자세다.
 *
 * 모듈 변수 셋(`mapJsonOnce`·`imagesOnce`·`bakedOnce`)이 캐시 그 자체라, 검사마다
 * `vi.resetModules()` 로 **새 모듈**을 들여온다. 안 그러면 첫 검사가 채운 캐시
 * 위에서 나머지가 돌아 "두 번째부터 0" 만 재고 첫 열림을 한 번도 안 잰다.
 */

/** 빌드가 구워 둔 월드맵 — 클라이언트가 실행 중에 받아 가는 바로 그 파일이다. */
const 월드맵: TiledMapJson = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL(
        `../../../../packages/data/src/generated/maps/${WORLD_MAP_ID}.json`,
        import.meta.url,
      ),
    ),
    'utf8',
  ),
) as TiledMapJson

interface 세계 {
  /** 나간 요청의 URL 들. 「두 번째 열림 0」이 이 배열 길이다. */
  요청: string[]
  /** 세운 `Image` 의 `src` 들 — 타일셋 쪽 캐시도 같은 규칙을 지는지 여기서 갈린다. */
  그림요청: string[]
  /** `createElement('canvas')` 가 내준 캔버스들. 「다시 구웠는가」가 이 길이다. */
  캔버스: { width: number; height: number; 붓질: number }[]
}

/** 이 세계가 무엇을 실패시키는가. 안 적으면 전부 성공한다. */
interface 세계설정 {
  /** 맵 JSON 응답. `n` 은 몇 번째 요청인가(1부터) — 첫 열림만 실패시킬 수 있다. */
  맵?: (n: number) => { ok: boolean; status: number; map: TiledMapJson }
  /** 이 수만큼의 그림 요청은 `onerror` 로 떨어진다. */
  그림실패?: number
}

/**
 * 브라우저가 주는 것 셋을 흉내 낸다 — `fetch` · `Image` · `document`.
 *
 * 실패를 인자로 받는 이유: 첫 열림만 실패하고 두 번째는 성공하는 자리가 이 파일이
 * 재는 것의 절반이다.
 */
function 브라우저(설정: 세계설정 = {}): 세계 {
  const 세계: 세계 = { 요청: [], 그림요청: [], 캔버스: [] }
  const 맵응답 = 설정.맵 ?? (() => ({ ok: true, status: 200, map: 월드맵 }))
  let 남은그림실패 = 설정.그림실패 ?? 0
  let 횟수 = 0

  vi.stubGlobal('fetch', async (url: string) => {
    세계.요청.push(url)
    const { ok, status, map } = 맵응답(++횟수)
    return { ok, status, json: async () => map }
  })

  vi.stubGlobal(
    'Image',
    class {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      #src = ''
      get src(): string {
        return this.#src
      }
      set src(value: string) {
        this.#src = value
        세계.그림요청.push(value)
        const 실패한다 = 남은그림실패 > 0
        if (실패한다) 남은그림실패--
        queueMicrotask(() => (실패한다 ? this.onerror?.() : this.onload?.()))
      }
    },
  )

  vi.stubGlobal('document', {
    createElement: (tag: string) => {
      if (tag !== 'canvas') throw new Error(`안 흉내 내는 태그: ${tag}`)
      const 칸 = { width: 0, height: 0, 붓질: 0 }
      세계.캔버스.push(칸)
      return {
        get width() {
          return 칸.width
        },
        set width(v: number) {
          칸.width = v
        },
        get height() {
          return 칸.height
        },
        set height(v: number) {
          칸.height = v
        },
        getContext: (kind: string) => (kind === '2d' ? { drawImage: () => void 칸.붓질++ } : null),
      }
    },
  })

  return 세계
}

/** 모듈 변수 셋을 비운 새 `worldMapImage`. */
async function 새로열기(): Promise<typeof import('./worldMapImage.js')> {
  vi.resetModules()
  return await import('./worldMapImage.js')
}

/** 그 맵을 늘 내주는 세계 설정. */
const 잘된다 = (map: TiledMapJson = 월드맵): 세계설정 => ({
  맵: () => ({ ok: true, status: 200, map }),
})

/** 첫 `n` 번의 맵 요청만 503 인 세계 설정. */
const 처음만끊긴다 = (n: number): 세계설정 => ({
  맵: (회) => ({ ok: 회 > n, status: 회 > n ? 200 : 503, map: 월드맵 }),
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('worldMapImage — 받고 굽는다', () => {
  it('월드맵 한 장을 상자에 contain-fit 으로 굽는다', async () => {
    const 세계 = 브라우저(잘된다())
    const { worldMapImage } = await 새로열기()

    const 그림 = await worldMapImage(251, 1)

    expect(세계.요청).toEqual([`maps/${encodeURIComponent(WORLD_MAP_ID)}.json`])
    // 두 축 중 **작은** 배율이 contain-fit 이다 — 큰 쪽을 쓰면 지도가 잘린다.
    const 배율 = Math.min(251 / 월드맵.width, 251 / 월드맵.height)
    expect(그림.cssWidth).toBeCloseTo(월드맵.width * 배율, 6)
    expect(그림.cssHeight).toBeCloseTo(월드맵.height * 배율, 6)
    expect(Math.max(그림.cssWidth, 그림.cssHeight)).toBeLessThanOrEqual(251)
    // 한 조각도 안 그린 채 끝나면 화면은 빈 상자로 선다.
    expect(세계.캔버스[0]!.붓질).toBeGreaterThan(0)
  })

  // 왜: 세로로 긴 세계를 그리는 날, 두 축 중 큰 배율을 쓰면 지도의 절반이 조용히
  //     사라진다. 오늘 월드맵은 80×80 이라 두 축이 같아서 위 검사만으로는
  //     `Math.min` 을 `Math.max` 로 바꿔도 답이 안 바뀐다.
  it('정사각이 아닌 세계도 안 잘린다 — 긴 축이 상자에 맞는다', async () => {
    const 긴맵: TiledMapJson = { ...월드맵, width: 40, height: 80 }
    브라우저(잘된다(긴맵))
    const { worldMapImage } = await 새로열기()

    const 그림 = await worldMapImage(200, 1)
    expect([그림.cssWidth, 그림.cssHeight]).toEqual([100, 200])
  })

  // 왜: 캔버스를 기기 픽셀로 굽고 CSS 크기로 되돌려 놓아야 원본 한 픽셀이 화면 한
  //     픽셀로 떨어진다. 안 하면 배율 2 인 폰에서 두 배로 늘어나 뭉갠다.
  it('기기 픽셀비만큼 크게 굽고, CSS 크기는 그대로 둔다', async () => {
    const 세계 = 브라우저(잘된다())
    const { worldMapImage } = await 새로열기()

    const 하나 = await worldMapImage(251, 1)
    const 둘 = await worldMapImage(251, 2)

    expect([둘.cssWidth, 둘.cssHeight]).toEqual([하나.cssWidth, 하나.cssHeight])
    // 올림이다 — 반올림하면 지도의 가장자리 한 줄이 반 px 잘린다.
    expect(세계.캔버스[1]!.width).toBe(Math.ceil(둘.cssWidth * 2))
    expect(세계.캔버스[1]!.height).toBe(Math.ceil(둘.cssHeight * 2))
  })

  // 왜: 올림이라야 지도의 마지막 줄·칸이 안 잘린다. 월드맵은 80×80 이라 두 축이
  //     상자 크기와 정확히 같아 반올림해도 답이 같다 — 그래서 짝수가 안 나오는
  //     맵으로 한 번 물어야 이 항이 물린다(30×80 을 251 상자에 → 짧은 축 94.125px).
  it('캔버스 픽셀은 올림이다 — 반올림하면 가장자리 한 줄이 잘린다', async () => {
    const 세로긴 = 브라우저(잘된다({ ...월드맵, width: 30, height: 80 }))
    const { worldMapImage } = await 새로열기()
    const 세로 = await worldMapImage(251, 1)
    expect(세로.cssWidth).toBeCloseTo(94.125, 6)
    expect(세로긴.캔버스[0]!.width).toBe(95)

    // 축을 눕혀 한 번 더 — 짧은 축이 어느 쪽이냐에 따라 소수가 붙는 칸이 갈리므로,
    // 한쪽만 재면 나머지 한 줄을 반올림으로 바꿔도 아무도 안 짖는다.
    vi.unstubAllGlobals()
    const 가로긴 = 브라우저(잘된다({ ...월드맵, width: 80, height: 30 }))
    const 다시 = await 새로열기()
    const 가로 = await 다시.worldMapImage(251, 1)
    expect(가로.cssHeight).toBeCloseTo(94.125, 6)
    expect(가로긴.캔버스[0]!.height).toBe(95)
  })

  // 왜: 한 조각도 못 그린 채 조용히 끝나면 화면은 빈 상자로 서고, 그것은 "맵이
  //     어두운 곳" 과 구분되지 않는다.
  it('한 조각도 못 그리면 던진다 — 빈 상자로 서지 않는다', async () => {
    브라우저(잘된다({ ...월드맵, layers: [] }))
    const { worldMapImage } = await 새로열기()

    await expect(worldMapImage(251, 1)).rejects.toThrow('한 조각도 못 그렸다')
  })
})

describe('worldMapImage — 붙잡는 규칙', () => {
  it('두 번째 열림은 아무것도 안 받고 안 굽는다 — 「두 번째 열림 0ms」가 그 약속이다', async () => {
    const 세계 = 브라우저(잘된다())
    const { worldMapImage } = await 새로열기()

    const 하나 = await worldMapImage(251, 1)
    const 둘 = await worldMapImage(251, 1)

    expect(둘.canvas).toBe(하나.canvas)
    expect(세계.요청, '두 번째 열림이 맵 JSON 을 또 받았다').toHaveLength(1)
    expect(세계.캔버스, '두 번째 열림이 또 구웠다').toHaveLength(1)
  })

  // 왜: 상자 크기는 창을 리사이즈하면 바뀌고, 기기 픽셀비는 창을 다른 배율의
  //     모니터로 옮기면 바뀐다. 키에서 둘 중 하나를 빼면 그날부터 지도가 옛
  //     크기의 그림을 늘려 그린다 — 받는 것은 그래도 한 번뿐이다.
  it('상자 크기나 밀도가 바뀌면 다시 굽는다 — 받는 것은 여전히 한 번이다', async () => {
    const 세계 = 브라우저(잘된다())
    const { worldMapImage } = await 새로열기()

    await worldMapImage(251, 1)
    await worldMapImage(300, 1)
    await worldMapImage(300, 2)
    await worldMapImage(300, 2)

    expect(세계.캔버스, '크기·밀도가 바뀌었는데 옛 그림을 그대로 내줬다').toHaveLength(3)
    expect(세계.요청, '다시 구우면서 맵 JSON 도 다시 받았다').toHaveLength(1)
  })

  /*
   * 아래 둘이 이 파일의 값이 가장 큰 자리다: `x ??= 만들기()` 는 「값이 있으면
   * 다시 안 만든다」이지 「성공했으면」이 아니다. 거절된 Promise 도 값이라 그대로
   * 캐시에 남고, 그 뒤의 모든 호출이 요청조차 안 내보낸 채 같은 거절을 즉시
   * 되돌려준다 — 지하철에서 한 번 끊긴 사람은 그 세션 내내 지도를 못 연다.
   */
  it('첫 열림이 실패하면 두 번째 열림이 **다시 받는다**', async () => {
    const 세계 = 브라우저(처음만끊긴다(1))
    const { worldMapImage } = await 새로열기()

    await expect(worldMapImage(251, 1)).rejects.toThrow('503')
    // 거절된 약속이 칸에 남아 있으면 아래 호출은 요청을 안 내보내고 같은 거절만
    // 되돌려준다 — 그것이 이 자가 잡는 실패다.
    await expect(worldMapImage(251, 1)).resolves.toBeTruthy()
    expect(세계.요청).toHaveLength(2)
  })

  // 왜: 캐시칸이 둘이다(맵 JSON · 타일셋 그림). 한쪽에만 손잡이를 달면 그림 쪽이
  //     한 번 실패한 사람은 새로고침 전까지 지도를 영영 못 연다 — 맵 JSON 은 이미
  //     캐시에 남아 성공한 상태이므로 요청조차 안 나가고 거절만 되돌아온다.
  it('타일셋 그림이 한 번 실패해도 두 번째 열림이 다시 받는다', async () => {
    const 세계 = 브라우저({ 그림실패: 1 })
    const { worldMapImage } = await 새로열기()

    await expect(worldMapImage(251, 1)).rejects.toThrow('타일셋')
    await expect(worldMapImage(251, 1)).resolves.toBeTruthy()
    // 맵 JSON 은 성공했으므로 한 번뿐이고, 그림만 다시 세운다.
    expect(세계.요청, '맵 JSON 까지 다시 받았다').toHaveLength(1)
    expect(세계.그림요청.length, '그림을 다시 안 세웠다').toBeGreaterThan(월드맵.tilesets.length)
  })

  it('두 번째가 성공하면 그때부터는 다시 붙잡는다 — 매번 58KB 를 받지 않는다', async () => {
    const 세계 = 브라우저(처음만끊긴다(1))
    const { worldMapImage } = await 새로열기()

    await expect(worldMapImage(251, 1)).rejects.toThrow()
    await worldMapImage(251, 1)
    await worldMapImage(251, 1)

    expect(세계.요청, '성공한 뒤에도 매번 다시 받았다').toHaveLength(2)
  })

  it('원래의 거절 이유를 그대로 다시 던진다 — 화면에 뜨는 문장이 그것이다', async () => {
    브라우저({ 맵: () => ({ ok: false, status: 503, map: 월드맵 }) })
    const { worldMapImage } = await 새로열기()

    await expect(worldMapImage(251, 1)).rejects.toThrow(WORLD_MAP_ID)
  })
})

/**
 * 손잡이 그 자체 — 위 검사들이 `worldMapImage` 를 통해 재는 것을 한 번 직접 잰다.
 * 실패 경로가 둘(맵 JSON · 타일셋)이라 함수 쪽에도 자가 있어야 어느 쪽이 깨졌는지
 * 갈린다.
 */
describe('forgetIfRejected', () => {
  it('성공한 약속은 그대로 흘려보낸다 — 지우지 않는다', async () => {
    let 지웠나 = false
    await expect(forgetIfRejected(Promise.resolve(42), () => void (지웠나 = true))).resolves.toBe(42)
    expect(지웠나).toBe(false)
  })

  it('거절되면 지우고, 같은 이유를 다시 던진다', async () => {
    let 지웠나 = false
    const 이유 = new Error('끊겼다')
    await expect(
      forgetIfRejected(Promise.reject(이유), () => void (지웠나 = true)),
    ).rejects.toBe(이유)
    expect(지웠나).toBe(true)
  })
})
