import Phaser from 'phaser'
import { ControlScene } from './scenes/ControlScene.js'
import { PanelScene } from './scenes/PanelScene.js'
import { WorldScene } from './scenes/WorldScene.js'

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

export function createPhaserGame(parent: HTMLElement): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    pixelArt: true,
    roundPixels: true,
    backgroundColor: readInkColor(),
    // RESIZE 는 캔버스를 부모 크기에 그대로 맞춘다. 폰 화면비가 제각각이라
    // 레터박스(검은 띠)가 생기는 FIT 보다 낫고, 확대 배율이 1 이라 정수 배율
    // 제약도 자연히 지켜진다.
    //
    // 여기에 zoom 을 주지 않는 이유: Phaser 의 ScaleManager 는 RESIZE 모드에서
    // zoom 을 아예 읽지 않는다(NONE 모드 전용이다). 예전에 있던 정수 zoom 계산은
    // 그래서 한 번도 적용된 적이 없고, 값도 틀렸다 — 적용됐다면 세로로 4 타일도
    // 안 보였을 것이다. 큰 화면에서 스프라이트를 키우려면 카메라 zoom 을 써야 하며,
    // 그때는 DayNightOverlay 가 cam.width / cam.zoom 으로 크기를 잡아야 한다.
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    // ControlScene·PanelScene 은 배열의 두 번째부터라 자동 시작하지 않는다 —
    // WorldScene.create() 가 this.scene.launch() 로 각각 명시적으로 띄운다.
    // 그래야 hub 가 만들어진 뒤에 연결할 수 있다.
    //
    // 배열 순서가 곧 그리는 순서다(뒤에 올수록 위) — PanelScene 을 WorldScene
    // 위에 두는 이유는 패널이 세계 위에 그려지되 낮밤 명암의 영향을 안 받기
    // 위해서다(PanelScene.ts 클래스 문서). PanelScene 과 ControlScene 의 상대
    // 순서는 더는 중요하지 않다 — 패널이 하나라도 열리면 컨트롤러 전체가
    // 스스로 숨고 인터랙티브도 꺼지므로(ControlScene.setControllerVisible),
    // 이 둘이 동시에 화면에 보이는 상태 자체가 없다.
    scene: [WorldScene, PanelScene, ControlScene],
  })
}
