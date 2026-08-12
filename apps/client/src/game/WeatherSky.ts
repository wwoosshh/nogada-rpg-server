import type Phaser from 'phaser'
import type { WeatherKind, WeatherView } from '@nogada/shared'
import { DEPTH } from './depth.js'

/**
 * 입자 그림 두 장. **텍스처는 게임(로더)에 살고 씬보다 오래 산다** — 맵을 넘을
 * 때마다 WorldScene 이 다시 create() 되므로, 있는지 보고 없을 때만 만든다.
 * 없는 그림을 매번 다시 구우면 맵을 넘나든 만큼 텍스처가 쌓인다.
 */
const DROP_TEXTURE = 'weather-drop'
const FLAKE_TEXTURE = 'weather-flake'

/**
 * 비의 기울기(도). 0 이 오른쪽, 90 이 수직 낙하다.
 *
 * 수직으로 떨어지는 비는 정지 화면처럼 보인다 — 사선이어야 바람이 있는 것처럼
 * 읽힌다. 10도만 눕히는 이유는 그 이상이면 화면 옆으로 흘러가는 것처럼 보여
 * "내린다"가 아니라 "지나간다"가 되기 때문이다.
 */
const RAIN_ANGLE_DEG = 80

/** 초당 낙하 거리(px). 비는 빠르고 눈은 느리다 — 이 둘의 차이가 곧 두 하늘의 차이다. */
const RAIN_SPEED = 600
const SNOW_FALL_SPEED = 50

/**
 * 화면 위·옆으로 더 잡아 두는 여백(px).
 *
 * 위: 입자가 화면 밖에서 태어나야 "윗줄에서 갑자기 생겨나는" 것이 안 보인다.
 * 옆: 사선으로 떨어지는 비는 위쪽 바깥에서 시작해 화면 안으로 들어오므로,
 * 뿌리는 띠가 화면보다 넓지 않으면 바람이 불어오는 쪽 모서리가 늘 비어 있다.
 */
const SPAWN_MARGIN = 48

/**
 * 하늘 연출 — 비와 눈.
 *
 * **화면에 붙는다(`setScrollFactor(0)`).** 세계 좌표에 뿌리면 걸을 때 비가
 * 뒤로 흐르고, 맵 가장자리에서는 비 없는 구역이 생긴다. 하늘은 카메라가 보는
 * 창 전체의 사정이라 낮밤 명암(DayNightOverlay)과 같은 자세를 쓴다 — 확대된
 * 카메라 안에서 화면을 정확히 덮는 좌표 계산도 그 파일과 같다.
 *
 * **명암보다 위에 그린다**(DEPTH.weather > DEPTH.dayNight). 아래 두면 자정에는
 * 0.55 알파의 어둠이 입자를 함께 덮어 비가 거의 안 보인다 — 밤에 쓴 가루가
 * 아무 일도 안 한 것처럼 보이는 것이 최악이다. 대신 입자 자체를 반투명하게
 * (`alpha`) 두어 명암을 지우지 않는다: 밤은 여전히 밤이고 그 위로 비가 내린다.
 *
 * **자체 시계가 없다.** 시작과 그침은 매 프레임 받은 `WeatherView` 하나가
 * 정한다(만료는 저장된 타이머가 아니라 시각 비교다, shared 의 weatherView).
 * 취소해야 할 타이머가 없으므로 새로고침·재접속·맵 이동 어디에서도 하늘이
 * 상태와 어긋날 수 없다.
 */
export class WeatherSky {
  private readonly scene: Phaser.Scene
  /** 지금 그리고 있는 하늘. 같은 값이 다시 오면 아무 일도 하지 않는다. */
  private kind: WeatherKind | null = null
  private emitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null
  /**
   * 입자가 태어나는 띠 — 화면 위쪽 바깥의 가로줄 하나. 방출 구역이 아래
   * `zoneSource` 를 **참조로** 들고 있어, 여기 세 숫자를 고쳐 쓰면 emitter 를
   * 다시 만들지 않고도 화면 크기 변화를 따라간다.
   */
  private readonly band = { left: 0, top: 0, width: 0 }

  /**
   * Phaser 에 넘기는 방출 구역. `Phaser.Geom.Rectangle` 을 쓰지 않는 이유는
   * 그 타입의 `getRandomPoint` 가 `Point` 를 요구하는데 파티클 쪽은
   * `Vector2Like` 를 넘겨 주어(Phaser 자체 타입 정의의 어긋남) 캐스팅 없이는
   * 붙지 않기 때문이다. 어차피 우리가 원하는 분포는 "가로줄 위의 아무 점"
   * 하나뿐이라, 함수 세 줄이 사각형 한 개보다 정확하다.
   */
  private readonly zoneSource = {
    getRandomPoint: (point: Phaser.Types.Math.Vector2Like): void => {
      point.x = this.band.left + Math.random() * this.band.width
      point.y = this.band.top
    },
  }

  constructor(scene: Phaser.Scene) {
    this.scene = scene
    // 화면이 커지면 뿌리는 띠도 넓어져야 한다 — 낮밤 명암이 같은 이벤트로
    // 사각형을 다시 맞추는 것과 같은 이유다(가로세로 전환·창 크기 변경).
    scene.scale.on('resize', this.handleResize, this)
  }

  /**
   * 지금의 하늘 하나를 받아 그림을 맞춘다. 매 프레임 불려도 값이 그대로면
   * 아무 일도 하지 않는다 — 시작·전환·그침만이 일이다.
   */
  update(view: WeatherView | null): void {
    const next = view?.kind ?? null
    if (next === this.kind) return
    this.kind = next
    this.emitter?.destroy()
    this.emitter = next === null ? null : this.createEmitter(next)
  }

  destroy(): void {
    this.scene.scale.off('resize', this.handleResize, this)
    this.emitter?.destroy()
    this.emitter = null
    this.kind = null
  }

  private handleResize(): void {
    if (this.emitter) this.fit(this.emitter)
  }

  private createEmitter(kind: WeatherKind): Phaser.GameObjects.Particles.ParticleEmitter {
    const emitter =
      kind === 'rain' ? this.createRainEmitter() : this.createSnowEmitter()
    emitter.setScrollFactor(0).setDepth(DEPTH.weather)
    this.fit(emitter)
    return emitter
  }

  /**
   * 입자가 태어나는 자리 — 화면 위쪽 가로 띠 안의 아무 점.
   *
   * `source` 는 **복사되지 않고 참조로 들린다.** 그래서 화면 크기가 바뀌어도
   * emitter 를 다시 만들지 않고 fit() 이 band 세 숫자만 고치면 된다.
   */
  private emitZone(): Phaser.Types.GameObjects.Particles.ParticleEmitterRandomZoneConfig {
    return { type: 'random', source: this.zoneSource }
  }

  private createRainEmitter(): Phaser.GameObjects.Particles.ParticleEmitter {
    ensureTexture(this.scene, DROP_TEXTURE, 2, 10, (g) => g.fillRect(0, 0, 2, 10))
    return this.scene.add.particles(0, 0, DROP_TEXTURE, {
      // 방출 각도가 진행 방향이고, rotate 는 그림 자신의 기울기다. 세로 막대를
      // 그린 텍스처라 (각도 − 90) 만큼 눕혀야 빗줄기가 제 진행 방향을 가리킨다 —
      // 어긋나면 옆으로 날아가는 수직 막대가 된다.
      angle: { min: RAIN_ANGLE_DEG - 2, max: RAIN_ANGLE_DEG + 2 },
      rotate: RAIN_ANGLE_DEG - 90,
      speed: { min: RAIN_SPEED * 0.85, max: RAIN_SPEED * 1.15 },
      // 옅다. 빗줄기 하나하나가 진하면 맵이 안 보이고, 그때 사람들은 비를 끄는
      // 방법부터 찾는다 — 이 연출은 60분(게임) 동안 켜져 있는다.
      alpha: { min: 0.2, max: 0.5 },
      // tokens.css 에 없는 연출 전용 색이다(NodeMarker·FloatingText 와 같은 관습):
      // 창백한 푸른 흰색 — 낮의 밝은 타일 위에서도, 밤의 남색 위에서도 읽힌다.
      tint: 0xcfe3f7,
      quantity: 2,
      frequency: 25,
      emitZone: this.emitZone(),
    })
  }

  private createSnowEmitter(): Phaser.GameObjects.Particles.ParticleEmitter {
    ensureTexture(this.scene, FLAKE_TEXTURE, 4, 4, (g) => g.fillCircle(2, 2, 2))
    return this.scene.add.particles(0, 0, FLAKE_TEXTURE, {
      // 눈은 각도 대신 축을 따로 준다 — 가로 성분이 송이마다 좌우로 갈려야
      // 같은 바람에 실려 내려가는 대신 저마다 흔들리며 떨어지는 것처럼 보인다.
      speedX: { min: -20, max: 20 },
      speedY: { min: SNOW_FALL_SPEED * 0.7, max: SNOW_FALL_SPEED * 1.4 },
      scale: { min: 0.8, max: 1.6 },
      alpha: { min: 0.55, max: 1 },
      tint: 0xffffff,
      quantity: 1,
      // 비의 1/4 밀도다. 눈은 느려서 한 송이가 화면에 오래(약 8초) 머무르므로,
      // 같은 밀도로 뿌리면 화면이 하얗게 덮여 맵이 안 보인다.
      frequency: 110,
      emitZone: this.emitZone(),
    })
  }

  /**
   * 확대된 카메라 안에서 화면 위쪽에 뿌리는 띠를 놓고, 입자가 바닥을 지나
   * 사라지도록 수명을 맞춘다.
   *
   * 좌표 계산은 DayNightOverlay.fitToCamera 와 같다: `setScrollFactor(0)` 은
   * 카메라 스크롤에서만 벗어나고 줌에서는 벗어나지 않으므로, 화면을 덮으려면
   * 크기를 zoom 으로 나누고 좌상단을 중앙 쪽으로 당겨야 한다.
   *
   * **수명을 화면 높이에서 역산하는 이유:** 상수로 박으면 큰 화면에서는 비가
   * 화면 중간에서 사라지고, 작은 화면에서는 보이지도 않는 아래쪽에 입자를
   * 계속 살려 둔다. 화면이 정하게 두면 어느 기기에서도 "위에서 아래까지"다.
   */
  private fit(emitter: Phaser.GameObjects.Particles.ParticleEmitter): void {
    const cam = this.scene.cameras.main
    const w = cam.width / cam.zoom
    const h = cam.height / cam.zoom
    const left = cam.width * cam.originX - w / 2
    const top = cam.height * cam.originY - h / 2

    this.band.left = left - SPAWN_MARGIN
    this.band.top = top - SPAWN_MARGIN
    this.band.width = w + SPAWN_MARGIN * 2

    const fallSpeed = this.kind === 'rain' ? RAIN_SPEED : SNOW_FALL_SPEED
    emitter.setParticleLifespan(((h + SPAWN_MARGIN * 2) / fallSpeed) * 1000)
  }
}

/**
 * 단색 그림 한 장을 구워 텍스처로 올린다. 이 게임의 다른 그림들과 달리 파일이
 * 아닌 이유는 크기가 픽셀 몇 개짜리라서다 — 비 한 줄기와 눈 한 송이를 위해
 * PNG 두 장을 받아 오는 것은 라이선스 표기(assets/CREDITS.md)까지 딸린 일이고,
 * 그 대가로 얻는 것이 흰 사각형과 흰 동그라미다.
 *
 * 색은 흰색으로 굽고 실제 색은 `tint` 가 정한다 — 그래야 그림 한 장이 두 하늘을
 * 다 감당하고, 색을 바꾸려고 텍스처를 다시 구울 일이 없다.
 */
function ensureTexture(
  scene: Phaser.Scene,
  key: string,
  width: number,
  height: number,
  draw: (g: Phaser.GameObjects.Graphics) => void,
): void {
  if (scene.textures.exists(key)) return
  const g = scene.add.graphics()
  g.fillStyle(0xffffff, 1)
  draw(g)
  // generateTexture 는 동기라 이 그래픽이 화면에 한 프레임도 그려지지 않는다.
  g.generateTexture(key, width, height)
  g.destroy()
}
