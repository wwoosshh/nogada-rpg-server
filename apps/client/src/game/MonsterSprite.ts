import Phaser from 'phaser'
import {
  DIRECTIONS,
  monsterAlive,
  monsterStateAt,
  type CombatState,
  type Direction,
  type MonsterDef,
  type MonsterPlacement,
  type MonsterState,
} from '@nogada/shared'
import { idleFrame, walkFrames } from './charSheet.js'
import { DEPTH } from './depth.js'
import { addText, FONT_SIZE } from './gameText.js'
import { monsterSpriteKey } from './monsterSprites.js'
import { monsterHpOf, monsterPixelCenter, warningStyle } from './monsterView.js'

/** NpcSprite 의 이름표와 같은 색 — 지도 위 글자가 한 종류로 읽혀야 한다. */
const CAPTION_COLOR = '#e8dcc0'
/** 타일 한 칸. WorldScene 과 같은 값이고 이유도 같다(월드는 32px 격자다). */
const TILE = 32

/**
 * 장판 색 하나에 알파 셋 — 예고는 옅게, 스미어는 중간, 휩쓸기는 진하게(설계 §7).
 *
 * 색이 하나인 것이 뜻이다: 셋 다 같은 구역("지금 여기서 공격하면 맞는다"의
 * 자리, §2-4)이고 다른 것은 **지금이냐 곧이냐**뿐이라, 색을 가르면 구역들이
 * 다른 위험처럼 읽힌다. 에셋이 아니라 코드 렌더인 것은 §10 의 결정이다.
 *
 * 옅음(0.24) < 스미어(0.32) < 진함(0.42)의 계단 — 진하기가 곧 위험의 서열로
 * 읽힌다. 예고 알파가 0.24 인 이유: 첫 값 0.16 은 실측 바닥색 RGB(176,186,163)
 * 위에서 명도대비 1.17:1 로 사실상 안 보였다(C6 화면 심사 실측) — 예고가 안
 * 보이면 예고 시간만큼의 회피 예산이 화면에서 깎인다.
 */
const ZONE_COLOR = 0xd8422a
const WARNING_ALPHA = 0.24
/** 예고 중 휩쓸기까지 ε 이하 — 판정상 이미 확정 피격 구간이다(monsterView.warningStyle). */
const SMEAR_ALPHA = 0.32
const DANGER_ALPHA = 0.42
/**
 * 장판 칸 테두리 — 바닥색에 의존하지 않는 대비(화면 심사관의 실측 처방).
 * 채움 알파는 바닥이 밝으면 묻히지만 테두리 선은 어떤 바닥에서도 윤곽을 남긴다.
 */
const ZONE_BORDER_WIDTH = 2
const ZONE_BORDER_ALPHA = 0.5

/** 몬스터 머리 위 HP 바 — 이름표와 겹치지 않게 몸 위에 얇게 얹는다. */
const HP_BAR_WIDTH = 26
const HP_BAR_HEIGHT = 3
const HP_BAR_Y = -TILE / 2 - 5
const HP_BAR_BG = 0x241c1c
const HP_BAR_FILL = 0xb4543a

/** 이 시트의 이 방향 걷기 애니메이션 키. NpcSprite 의 walkKey 와 같은 규칙, 접두사만 다르다. */
function walkAnimKey(monsterId: string, facing: Direction): string {
  return `monsterwalk:${monsterId}:${facing}`
}

export interface MonsterSpriteOptions {
  scene: Phaser.Scene
  def: MonsterDef
  placement: MonsterPlacement
}

/**
 * 맵 위 몬스터 하나 — 몸·이름표·HP 바·위험 장판을 그린다. **보여주기만 한다**:
 * 겨냥은 combatTarget(A 술어)이, 판정은 서버가 한다(NodeMarker·NpcSprite 의 약속).
 *
 * **NpcSprite 를 재사용하지 않는 이유(설계 §12-앞 16):** NpcSprite 는 스케줄러가
 * 400ms 마다 알려 주는 목표 칸을 향해 초당 일정 픽셀로 **추격**한다 — 추격 속도가
 * 목표 속도와 같아 정상 상태에서 수학 위치보다 0~1칸 뒤진다(그 파일의
 * WALK_SPEED_PX_PER_MS, 실측). 화자에게 그 지연은 무해한 연출이지만 몬스터에게는
 * 판정 오차다: 서버의 사거리·피격은 `monsterStateAt` 의 수학 위치를 보므로,
 * 화면의 몸이 뒤지면 장판과 몸이 어긋나 "본 대로 피했는데 맞았다"가 된다.
 * 그래서 여기는 채널도 추격도 없다 — 매 프레임 `monsterStateAt` 의
 * tile·nextTile·progress 로 픽셀을 **직접** 계산해 놓는다(monsterView.ts).
 */
export class MonsterSprite {
  readonly instanceId: string
  private readonly def: MonsterDef
  private readonly placement: MonsterPlacement
  private readonly container: Phaser.GameObjects.Container
  private readonly body: Phaser.GameObjects.Sprite
  private readonly hpBar: Phaser.GameObjects.Graphics
  /**
   * 위험 장판. 컨테이너 밖(월드 좌표)이다 — 부채꼴의 앵커는 예고 시작 시점의
   * 순찰 칸이라(monster.ts) 걷는 몸을 따라가면 안 되고, 깊이도 바닥(§7)이다.
   */
  private readonly zone: Phaser.GameObjects.Graphics
  /** 지금 보고 있는 쪽. facing 이 null 인 슬롯(제자리 대기)에서 방향을 지어내지 않으려고 기억한다. */
  private facing: Direction
  private walking = false
  /** 마지막으로 그린 HP — 매 프레임 같은 바를 다시 그리지 않으려고 기억한다. */
  private drawnHp = -1

  constructor(options: MonsterSpriteOptions) {
    const { scene, def, placement } = options
    this.instanceId = placement.instanceId
    this.def = def
    this.placement = placement
    this.facing = 'down'

    const key = monsterSpriteKey(placement.monsterId)
    this.body = scene.add.sprite(0, 0, key, idleFrame(this.facing))
    this.hpBar = scene.add.graphics()
    this.hpBar.setPosition(-HP_BAR_WIDTH / 2, HP_BAR_Y)
    this.container = scene.add.container(0, 0, [
      this.body,
      this.hpBar,
      // 이름표는 칸 바로 아래 — NpcSprite 와 같은 자리·같은 글자라 지도 위
      // 글자가 한 종류로 읽힌다.
      addText(scene, 0, TILE / 2 + 2, def.name, {
        fontSize: `${FONT_SIZE.caption}px`,
        color: CAPTION_COLOR,
      }).setOrigin(0.5, 0),
    ])
    this.container.setDepth(DEPTH.monster)

    this.zone = scene.add.graphics()
    this.zone.setDepth(DEPTH.dangerZone)

    // 애니메이션은 씬이 아니라 게임 전체가 갖는다(NpcSprite 와 같은 이유 —
    // 맵 재시작마다 이 생성자가 다시 돈다). 걸음 프레임 속도를 슬롯 길이에서
    // 끌어내는 것도 같은 이유다: 다른 숫자를 적으면 발이 헛돈다. 한 칸에 두 프레임.
    const slotMs = def.periodMs / def.patrol.length
    for (const facing of DIRECTIONS) {
      const animKey = walkAnimKey(placement.monsterId, facing)
      if (scene.anims.exists(animKey)) continue
      scene.anims.create({
        key: animKey,
        frames: walkFrames(facing).map((frame) => ({ key, frame })),
        frameRate: 1000 / (slotMs / 2),
        repeat: -1,
      })
    }
  }

  /**
   * 그 시각의 상태를 통째로 다시 그린다. 씬의 update() 가 매 프레임 부른다.
   *
   * 인자가 시각과 전투 상태뿐인 것이 요점이다 — 이전 프레임이 어디였는지는
   * 아무 데도 없다(§12-앞 16: 숨은 상태가 끼면 화면의 늑대와 판정의 늑대가
   * 다른 자리에 선다).
   */
  update(nowMs: number, combat: Pick<CombatState, 'slain' | 'hunt'>): void {
    // 리스폰 대기 중의 배치는 부재다 — 몸도 장판도 없다. 서버(fightService)가
    // 같은 술어로 명중·피격을 전부 건너뛰는 그 상태의 화면판이다.
    if (!monsterAlive(combat.slain, this.instanceId, nowMs)) {
      this.container.setVisible(false)
      this.zone.clear()
      return
    }
    this.container.setVisible(true)

    const state = monsterStateAt(this.def, nowMs + this.placement.phaseOffsetMs)
    const px = monsterPixelCenter(state)
    this.container.setPosition(px.x, px.y)

    // 방향: 상태가 말하면 그대로, null(제자리 대기)이면 보던 쪽을 유지한다 —
    // monsterStateAt 이 같은 칸 사이에서 방향을 지어내지 않는 것과 같은 자세다.
    if (state.facing) this.facing = state.facing
    this.setWalking(state.tile.x !== state.nextTile.x || state.tile.y !== state.nextTile.y)

    this.drawZone(state)
    this.drawHpBar(monsterHpOf(this.placement, combat.hunt))
  }

  /**
   * 예고는 옅게(스미어 구간은 중간), 휩쓸기는 진하게(§7). 두 목록은 국면상
   * 동시에 비지 않는 일이 없다(monster.ts). 어느 쪽이냐의 판단은 순수 함수
   * warningStyle(monsterView.ts)이 진다 — 여기는 그리기만 한다.
   */
  private drawZone(state: MonsterState): void {
    this.zone.clear()
    this.zone.lineStyle(ZONE_BORDER_WIDTH, ZONE_COLOR, ZONE_BORDER_ALPHA)
    this.zone.fillStyle(ZONE_COLOR, warningStyle(state) === 'smear' ? SMEAR_ALPHA : WARNING_ALPHA)
    for (const tile of state.warningTiles) this.fillTile(tile)
    this.zone.fillStyle(ZONE_COLOR, DANGER_ALPHA)
    for (const tile of state.dangerTiles) this.fillTile(tile)
  }

  /** 장판 한 칸 — 채움 + 테두리. 테두리는 바닥색과 무관하게 윤곽을 남긴다(상수 주석). */
  private fillTile(tile: { x: number; y: number }): void {
    this.zone.fillRect(tile.x * TILE, tile.y * TILE, TILE, TILE)
    this.zone.strokeRect(tile.x * TILE, tile.y * TILE, TILE, TILE)
  }

  private drawHpBar(hp: number): void {
    if (hp === this.drawnHp) return
    this.drawnHp = hp
    this.hpBar.clear()
    this.hpBar.fillStyle(HP_BAR_BG, 1)
    this.hpBar.fillRect(0, 0, HP_BAR_WIDTH, HP_BAR_HEIGHT)
    this.hpBar.fillStyle(HP_BAR_FILL, 1)
    this.hpBar.fillRect(0, 0, HP_BAR_WIDTH * Math.max(0, hp / this.placement.maxHp), HP_BAR_HEIGHT)
  }

  private setWalking(walking: boolean): void {
    if (this.walking === walking) {
      // 걷는 중의 방향 전환은 애니메이션 키를 갈아 끼워야 한다(NpcSprite.apply 와 같다).
      if (walking) this.body.anims.play(walkAnimKey(this.placement.monsterId, this.facing), true)
      else this.body.setFrame(idleFrame(this.facing))
      return
    }
    this.walking = walking
    if (walking) this.body.anims.play(walkAnimKey(this.placement.monsterId, this.facing), true)
    else {
      this.body.anims.stop()
      this.body.setFrame(idleFrame(this.facing))
    }
  }
}
