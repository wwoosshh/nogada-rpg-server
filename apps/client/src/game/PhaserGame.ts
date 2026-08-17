import Phaser from 'phaser'
import { ControlScene } from './scenes/ControlScene.js'
import { DialogueScene } from './scenes/DialogueScene.js'
import { HudScene } from './scenes/HudScene.js'
import { PanelScene } from './scenes/PanelScene.js'
import { WorldScene } from './scenes/WorldScene.js'
import { renderScale } from './viewport.js'

/**
 * Phaser 의 설정 객체는 CSS 커스텀 프로퍼티를 직접 읽지 못한다. 그렇다고 배경색을
 * '#241c1c' 로 여기 다시 적으면 tokens.css 의 --c-ink 와 값이 두 곳에 따로 존재하게
 * 되어, tokens.css 자신의 주석이 금지하는 "팔레트 단일 출처 밖에서 색상 리터럴을
 * 쓰는" 상황이 된다. 대신 게임 생성 시점에 실제 문서에서 --c-ink 값을 읽어와
 * 그대로 전달하는 다리 역할만 한다. 값이 비어 있을 때(스타일시트 로드 실패 등)만
 * 최후 수단으로 같은 리터럴을 fallback 으로 둔다.
 */
function readInkColor(): string {
  const fallback = '#241c1c'
  const value = getComputedStyle(document.documentElement).getPropertyValue('--c-ink').trim()
  return value || fallback
}

/** 부모의 현재 CSS 크기. 0 이 나오면 레이아웃 전이므로 최소값으로 버틴다. */
function parentSize(parent: HTMLElement): { width: number; height: number } {
  return {
    width: Math.max(1, Math.floor(parent.clientWidth)),
    height: Math.max(1, Math.floor(parent.clientHeight)),
  }
}

export function createPhaserGame(parent: HTMLElement): Phaser.Game {
  const scale = renderScale()
  const start = parentSize(parent)

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    pixelArt: true,
    roundPixels: true,
    backgroundColor: readInkColor(),
    // 게임 크기를 **기기 픽셀**로 잡고 zoom 으로 표시 크기를 되돌린다.
    //
    // ScaleManager.resize() 는 `canvas.width = 받은 크기` 로 백킹스토어를 정하고,
    // CSS 크기는 `받은 크기 × zoom` 으로 따로 정한다. 그래서 이 조합이 곧
    // "네이티브 해상도로 그리되 화면에는 원래 크기로 보여준다" 가 된다.
    //
    // RESIZE 모드로는 이게 불가능하다 — 그 모드는 백킹스토어를 부모의 CSS 픽셀
    // 크기로 못 박고 zoom 을 아예 읽지 않는다. 그래서 기기 픽셀비 2 인 화면에서
    // 캔버스 안의 글자만 흐리고 DOM 인 상단 바는 선명한 상태가 됐었다.
    //
    // NONE 이므로 부모 크기 변화는 우리가 감지해야 한다 — 아래 ResizeObserver 다.
    scale: {
      mode: Phaser.Scale.NONE,
      width: start.width * scale,
      height: start.height * scale,
      zoom: 1 / scale,
    },
    // ControlScene·PanelScene·DialogueScene 은 배열의 두 번째부터라 자동
    // 시작하지 않는다 — WorldScene.create() 가 this.scene.launch() 로 각각
    // 명시적으로 띄운다. 그래야 hub 가 만들어진 뒤에 연결할 수 있다.
    //
    // 배열 순서가 곧 그리는 순서다(뒤에 올수록 위) — PanelScene 을 WorldScene
    // 위에 두는 이유는 패널이 세계 위에 그려지되 낮밤 명암의 영향을 안 받기
    // 위해서다(PanelScene.ts 클래스 문서). PanelScene 과 ControlScene 의 상대
    // 순서는 더는 중요하지 않다 — 패널이 하나라도 열리면 컨트롤러 전체가
    // 스스로 숨고 인터랙티브도 꺼지므로(ControlScene.setControllerVisible),
    // 이 둘이 동시에 화면에 보이는 상태 자체가 없다.
    //
    // DialogueScene 은 맨 끝이다. 대사창도 같은 이유로 세계 위여야 하고(밤에
    // 어두워지면 안 되는 글이다), 열려 있는 동안은 패널도 컨트롤러도 화면에
    // 없으므로 이 자리를 두고 다툴 것이 없다.
    //
    // HudScene(띠)은 World 바로 뒤다. 세계 위여야 하는 이유는 셋과 같고(낮밤
    // 명암 밖의 글이다), 뒤의 셋과의 상대 순서는 다툴 것이 없다 — 패널이든
    // 대사창이든 열리면 세계 입력이 잠기고 띠는 스스로 숨는다(HudScene.update).
    scene: [WorldScene, HudScene, PanelScene, ControlScene, DialogueScene],
  })

  // NONE 모드는 부모가 커지고 줄어드는 것을 스스로 따라가지 않는다. 창 리사이즈뿐
  // 아니라 기기 회전과 주소창 접힘도 부모 크기를 바꾸므로 window 이벤트가 아니라
  // 부모 자체를 관찰한다.
  const observer = new ResizeObserver(() => {
    const { width, height } = parentSize(parent)
    const s = renderScale()
    if (game.scale.width === width * s && game.scale.height === height * s) return
    game.scale.resize(width * s, height * s)
  })
  observer.observe(parent)

  // App.tsx 가 game.destroy(true) 를 부르는 경로에서 관찰자도 끊는다. 남겨 두면
  // 사라진 게임의 ScaleManager 를 계속 건드린다.
  game.events.once(Phaser.Core.Events.DESTROY, () => observer.disconnect())

  return game
}
