import type Phaser from 'phaser'
import { DEPTH } from './depth.js'

/** tokens.css 의 --c-success / --c-danger 와 같은 값이다. 바꿀 때 함께 고친다. */
const TONE_COLORS = {
  good: '#7fa650',
  bad: '#b4543a',
} as const

const RISE_PX = 28
const DURATION_MS = 900

/**
 * 머리 위 글자의 모양을 만든다. spawnFloatingText 와 FloatingTextGroup 이
 * 둘 다 이것을 쓴다 — 같은 모양의 글자를 두 곳에서 따로 만들면 한쪽만
 * 고치는 일이 생긴다.
 */
function createFloatingLabel(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  tone: keyof typeof TONE_COLORS,
): Phaser.GameObjects.Text {
  return scene.add
    .text(x, y, text, {
      fontSize: '12px',
      color: TONE_COLORS[tone],
      stroke: '#241c1c',
      strokeThickness: 3,
    })
    .setOrigin(0.5, 1)
    .setDepth(DEPTH.floatingText)
}

/**
 * 캐릭터 머리 위에서 떠오르며 사라지는 한 줄.
 *
 * 패널로 알리지 않는 이유는 가로 화면에서 시선이 캐릭터에 머물고, 패널은
 * 그 자체로 화면을 가리기 때문이다.
 */
export function spawnFloatingText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  tone: keyof typeof TONE_COLORS,
): void {
  const label = createFloatingLabel(scene, x, y, text, tone)

  scene.tweens.add({
    targets: label,
    y: y - RISE_PX,
    alpha: 0,
    duration: DURATION_MS,
    ease: 'Cubic.easeOut',
    onComplete: () => label.destroy(),
  })
}

interface LiveText {
  label: Phaser.GameObjects.Text
  tween: Phaser.Tweens.Tween
  amount: number
  tone: 'good' | 'bad'
  baseText: string
}

/**
 * 같은 종류의 결과를 하나의 글자에 누적한다.
 *
 * 자동 반복이 열리면 초당 20번까지 결과가 온다. 매번 새 글자를 만들면 900ms
 * 동안 18개가 같은 자리에 겹쳐서 아무것도 읽을 수 없다. 대신 살아 있는 글자에
 * 수치를 더하고 수명을 늘린다 — 반복이 멈추면 자연히 사라진다.
 */
export class FloatingTextGroup {
  private readonly live = new Map<string, LiveText>()

  push(
    scene: Phaser.Scene,
    x: number,
    y: number,
    feedback: { text: string; tone: 'good' | 'bad'; groupKey: string | null; amount: number },
  ): void {
    if (!feedback.groupKey) {
      spawnFloatingText(scene, x, y, feedback.text, feedback.tone)
      return
    }

    const existing = this.live.get(feedback.groupKey)
    if (existing) {
      existing.amount += feedback.amount
      existing.label.setText(this.render(existing))
      existing.label.setPosition(x, y)
      // 수명을 처음부터 다시 센다(반복이 이어지는 동안 사라지지 않는다) —
      // 그런데 tween.restart() 를 쓰지 않는다. restart() → seek(0) →
      // TweenData.reset(true) 는 `target[key] = this.start` 를 쓴다. 그
      // this.start 는 트윈을 "만들 때" 값을 한 번 찍어 둔 것이라, 방금 위에서
      // setPosition 으로 옮긴 y 는 무시되고 맨 처음 이 글자가 태어난 자리의
      // y 로 되돌아간다(alpha 는 시작값이 우리가 원하는 값(1)과 같아서
      // 우연히 맞았을 뿐이다). 그래서 같은 수확의 두 번째 노드로 걸어가면
      // x 는 따라오는데 y 는 첫 노드 자리로 튀는 결함이 생긴다. 대신 트윈을
      // 새로 만든다 — 방금 setPosition 이 써 둔 y 를 Phaser 가 생성 시점의
      // 현재값으로 그대로 시작점 삼는다.
      existing.tween.stop()
      existing.tween = this.spawnTween(scene, existing.label, y, feedback.groupKey)
      return
    }

    this.spawn(scene, x, y, feedback)
  }

  destroy(): void {
    for (const entry of this.live.values()) {
      entry.tween.stop()
      entry.label.destroy()
    }
    this.live.clear()
  }

  private render(entry: LiveText): string {
    // 성공은 몇 개인지가 정보이고, 실패는 몇 번인지가 정보다.
    return entry.tone === 'good'
      ? `${entry.baseText} +${entry.amount}`
      : `${entry.baseText} ×${entry.amount}`
  }

  private spawn(
    scene: Phaser.Scene,
    x: number,
    y: number,
    feedback: { text: string; tone: 'good' | 'bad'; groupKey: string | null; amount: number },
  ): void {
    const key = feedback.groupKey
    if (!key) return

    // 첫 글자는 스토어가 만든 문구를 그대로 쓰고, 두 번째부터 render() 가 만든다.
    const label = createFloatingLabel(scene, x, y, feedback.text, feedback.tone)
    const entry: LiveText = {
      label,
      amount: feedback.amount,
      tone: feedback.tone,
      baseText: baseTextOf(feedback.text, feedback.tone),
      tween: this.spawnTween(scene, label, y, key),
    }
    this.live.set(key, entry)
  }

  /**
   * 글자 하나의 "떠오르며 사라짐" 트윈을 만든다. spawn() 과 push() 의 갱신
   * 경로가 둘 다 쓴다 — 둘이 각자 트윈 설정을 따로 들면 한쪽만 고치는 일이
   * 생긴다(RISE_PX 대신 24 를 박아 둔 채 남았던 것도 그렇게 생긴 어긋남이었다).
   */
  private spawnTween(
    scene: Phaser.Scene,
    label: Phaser.GameObjects.Text,
    y: number,
    key: string,
  ): Phaser.Tweens.Tween {
    return scene.tweens.add({
      targets: label,
      y: y - RISE_PX,
      alpha: { from: 1, to: 0 },
      duration: DURATION_MS,
      onComplete: () => {
        this.live.delete(key)
        label.destroy()
      },
    })
  }
}

/** "구리 원석 +2" 에서 "구리 원석" 만 남긴다. 실패 문구는 그대로 쓴다. */
function baseTextOf(text: string, tone: 'good' | 'bad'): string {
  if (tone !== 'good') return text
  const cut = text.lastIndexOf(' +')
  return cut === -1 ? text : text.slice(0, cut)
}
