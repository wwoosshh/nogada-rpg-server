import { describe, expect, it } from 'vitest'
import { MINIMAP } from './minimap.js'
import { PANEL_BOX, overlapOf, panelBoxRect, panelHeaderRect, type ScreenRect } from './panelBox.js'

/**
 * 전면 패널 카드가 **화면의 어디를 차지하는가**, 그리고 그것이 미니맵과 어떻게
 * 겹치는가를 잰다.
 *
 * 이 자가 못 재는 것을 먼저 적는다: **닫힌 패널이 실제로 입력을 안 먹는지는
 * 브라우저에서만 보인다.** 그것을 정하는 것은 PanelScene.render() 의
 * `this.input.enabled = showMenu` 한 줄인데, 그 줄을 재려면 Phaser 를 켜고 씬
 * 다섯을 쌓아 손으로 pointerdown 을 던져야 한다 — 여기 있는 것은 좌표뿐이다.
 * 사람이 812×375 로 띄워 미니맵의 **위쪽**을 눌러 봐야 한다.
 *
 * 그래도 이 자가 값을 내는 곳이 있다: **왜 그 한 줄이 필요한가**가 좌표에 적혀
 * 있다. 아래 검사가 초록인 동안 「닫혀 있으니 안 먹어도 그만」이 아니라 「닫혀
 * 있는 동안 먹으면 미니맵이 죽는다」가 참이다. 그 겹침이 사라지는 날(누가 미니맵을
 * 옮기거나 패널 여백을 키우면) 이 자가 빨개지고, 그때 다시 볼 것은 그 한 줄이
 * 여전히 필요한가다.
 */

/** 미니맵 상자 — 테두리를 포함한 바깥 사각형(설계 ⑤ 의 `left:9 top:39` 116×116). */
const 미니맵상자: ScreenRect = { x: MINIMAP.x, y: MINIMAP.y, width: MINIMAP.size, height: MINIMAP.size }

/** 설계가 못박은 화면 — 812×375 모바일 가로 고정. */
const 화면 = { width: 812, height: 375 }

describe('패널 카드 — 자리', () => {
  it('812×375 에서 (16,40) 780×319 다 — 브라우저에서 잰 DOM 카드와 같은 수다', () => {
    // 같은 치수를 DOM 쪽 전면 패널(ui.css 의 `.panel`)도 쓴다. Q6 의 브라우저
    // 실측이 「카드 780×319 @(16,40)」이었고, Phaser 쪽 카드가 그것과 갈라지면
    // 가방을 닫고 메뉴를 여는 손가락이 카드가 한 칸 움직이는 것을 본다.
    expect(panelBoxRect(화면.width, 화면.height)).toEqual({ x: 16, y: 40, width: 780, height: 319 })
  })

  it('아주 좁고 낮은 창에서도 최소 치수 밑으로 안 내려간다', () => {
    const tiny = panelBoxRect(100, 50)
    expect(tiny.width).toBe(PANEL_BOX.minWidth)
    expect(tiny.height).toBe(PANEL_BOX.minHeight)
  })

  it('아주 넓은 창에서는 상한에 멈추고 가운데에 선다', () => {
    const wide = panelBoxRect(2000, 1200)
    expect(wide.width).toBe(PANEL_BOX.maxWidth)
    expect(wide.x).toBe((2000 - PANEL_BOX.maxWidth) / 2)
  })
})

describe('패널 카드 — 미니맵과의 겹침', () => {
  it('헤더 줄이 미니맵 상자의 위 48px 을 덮는다 — 닫힌 패널이 입력을 먹으면 죽는 자리다', () => {
    // 이 겹침이 실재한다는 것이 PanelScene.render() 의 `input.enabled` 한 줄이
    // 사는 이유 전부다. 헤더 줄에는 탭 칸 셋이 있고(설정·이정표·숙련도), 그
    // 히트 영역은 라벨과 달리 안 보일 때도 살아 있었다.
    const 겹침 = overlapOf(panelHeaderRect(화면.width, 화면.height), 미니맵상자)
    expect(겹침, '헤더 줄이 미니맵을 안 덮는다 — 이 자가 잴 것이 없다').not.toBeNull()
    // x 는 카드 왼변(16)부터 미니맵 오른끝(125)까지, y 는 카드 윗변(40)부터
    // 헤더 아랫변(88)까지다. 미니맵은 y=39 에서 시작하므로 위 1px 만 살아남는다.
    expect(겹침).toEqual({ x: 16, y: 40, width: 109, height: 48 })
  })

  it('카드 전체는 미니맵의 거의 전부를 덮는다 — 살아남는 것은 왼쪽 7px 뿐이다', () => {
    // 헤더 아래도 빈 자리가 아니다. 목록 뷰포트의 hitZone 은 ScrollList 가
    // 컨테이너와 **별개 오브젝트**로 만들어 `setVisible` 이 안 닿고(그 파일의
    // 주석), 카드 안쪽 거의 전부를 덮는다. 그래서 미니맵에서 확실히 살아 있던
    // 것은 카드 왼변(16)보다 왼쪽의 7px 띠와 카드 윗변 위의 1px 뿐이었다 —
    // 116px 짜리 상자에서.
    const 겹침 = overlapOf(panelBoxRect(화면.width, 화면.height), 미니맵상자)
    expect(겹침).toEqual({ x: 16, y: 40, width: 109, height: 115 })
    expect(겹침!.width / 미니맵상자.width).toBeGreaterThan(0.9)
  })

  it('닫기 버튼 자리는 미니맵과 안 겹친다 — 겹치는 것은 왼쪽 절반이다', () => {
    // 겹침이 「헤더 줄 전체」가 아니라 「카드 왼쪽」이라는 것을 못박는다. 닫기
    // 버튼은 카드 우상단이라 미니맵과 무관하고, 그래서 이 문제의 답이 "닫기
    // 버튼을 옮긴다" 가 아니었다.
    const box = panelBoxRect(화면.width, 화면.height)
    const 닫기 = { x: box.x + box.width - 52, y: box.y, width: 52, height: PANEL_BOX.headerHeight }
    expect(overlapOf(닫기, 미니맵상자)).toBeNull()
  })
})
