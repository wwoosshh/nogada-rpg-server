import {
  GAME_EPOCH_MS,
  GAME_MINUTES_PER_DAY,
  REAL_MS_PER_GAME_MINUTE,
  npcStateAt,
  shopAccess,
  type PlayerState,
} from '@nogada/shared'
import { describe, expect, it } from 'vitest'
import { emptyPlayer } from './emptyPlayer.js'
import { loadGameData } from './load.js'

/**
 * 출하되는 상점 다섯의 **영업 시간**을 실물 데이터로 못박는다.
 *
 * 상점은 사람이다 — 상인이 자기 일과대로 자러 들어가면 그 상점은 닫힌다(경제 설계
 * §6-앞 4). 이것은 버그가 아니라 세계가 살아 있다는 증거이고, 그래서 **의도라는
 * 사실 자체가 검증 대상**이다: 누가 일과를 고쳐 상점 하나가 종일 닫히거나 밤샘
 * 영업을 시작하면 이 파일이 먼저 말한다.
 *
 * **하루 1,440분을 전수로 훑는다.** 두 순간(정오·새벽 2시)만 찍던 시절에는
 * 그 두 점 사이의 일이 전부 보이지 않았고, 그래서 이 파일은 "채집장노인은
 * 24시간"이라는 **거짓말**을 적어 두고 있었다 — 실내 지점이 없는 것은 맞지만
 * 그 사람도 채집장을 도는 동안에는 길 위에 있고, 걷는 사람은 `speakerPresence`
 * 가 `activity !== 'standing'` 으로 접어 `not_here` 가 된다. 전수로 훑으면
 * 닫힘 구간이 데이터에서 그대로 나오므로, 이 파일이 사실을 지어낼 자리가 없다.
 *
 * 게임 하루는 실제 1시간이라 밤 창은 실제로 20여 분마다 돌아온다 — 사람이 그
 * 시각을 기다릴 필요가 없도록, 시각을 인자로 받는 순수 술어(shopAccess)에 직접
 * 넣어 본다. 서버가 부르는 그 함수 그대로다.
 */

const data = loadGameData()

/** 그 게임 시각(분)의 실제 ms — 게임 하루의 시작에서 minuteOfDay 만큼 지난 순간. */
function atGameMinute(minuteOfDay: number): number {
  return GAME_EPOCH_MS + minuteOfDay * REAL_MS_PER_GAME_MINUTE
}

/** 그 상점 앞에 서 있는, 그 계열 숙련이 충분한 사람. */
function customerAt(shopId: string): PlayerState {
  const shop = data.shops[shopId]!
  const speaker = data.speakers[shop.speakerId]!
  const player = emptyPlayer()
  // combat 상점의 눈금은 skills 가 아니라 combat.proficiency 다(아크 E 규범 3) —
  // skills['combat'] 에 적으면 아무 문도 안 열리는 유령 숙련이 된다.
  if (shop.skill === 'combat') player.combat.proficiency = shop.unlockSkill
  else player.skills[shop.skill] = shop.unlockSkill
  player.location = { mapId: speaker.mapId, x: speaker.x, y: speaker.y }
  return player
}

const hhmm = (minute: number): string =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`

/**
 * 하루를 1분 단위로 훑어 그 상점이 닫혀 있던 구간을 잇는다 — `["22:00~23:59", …]`.
 *
 * 구간으로 접는 이유는 사람이 읽을 수 있어야 하기 때문이다: 닫힌 분의 개수만
 * 세면 일과가 바뀌었을 때 "몇 분이 달라졌다"까지만 알고 **어느 시간대가**
 * 달라졌는지는 모른다.
 */
function closedWindows(shopId: string): string[] {
  const windows: string[] = []
  let openedAt: number | null = null

  for (let minute = 0; minute < GAME_MINUTES_PER_DAY; minute++) {
    const access = shopAccess(data, shopId, customerAt(shopId), atGameMinute(minute))
    if (access === 'ok') {
      if (openedAt !== null) windows.push(`${hhmm(openedAt)}~${hhmm(minute - 1)}`)
      openedAt = null
      continue
    }
    // 손님은 요구치를 채웠고 화자의 칸에 서 있다 — 그러니 닫힘의 이유는 언제나
    // "그 사람이 지금 여기 없다" 하나여야 한다. 다른 코드가 섞이면 이 목록은
    // 영업 시간이 아니라 다른 무언가를 재고 있는 것이다.
    expect(access, `${shopId} ${hhmm(minute)}`).toBe('not_here')
    if (openedAt === null) openedAt = minute
  }
  if (openedAt !== null) windows.push(`${hhmm(openedAt)}~${hhmm(GAME_MINUTES_PER_DAY - 1)}`)
  return windows
}

describe('상점의 영업 시간 — 상인이 자리를 뜨면 상점도 닫힌다(§6-앞 4)', () => {
  it('한낮에는 상점 다섯이 전부 열려 있다', () => {
    const noon = atGameMinute(12 * 60)
    for (const shop of Object.values(data.shops)) {
      expect(shopAccess(data, shop.id, customerAt(shop.id), noon), shop.id).toBe('ok')
    }
  })

  // 채집장노인만 일과에 실내 지점이 없다 — 문턱 대사의 주인이 밤마다 사라지면
  // 핵심 루프의 반응성이 죽기 때문이다(NPC 일과 설계 §8). 그래서 얼음 상점은
  // **밤에도 열려 있다.** 다만 24시간은 아니다: 그 사람도 채집장을 도는 동안에는
  // 길 위에 있고, 걷는 사람에게는 말이 걸리지 않는다. 하루 10분이 그 이동 시간이다.
  it('얼음 상점은 밤에도 열려 있다 — 닫히는 것은 노인이 채집장을 도는 10분뿐이다', () => {
    expect(closedWindows('얼음상점')).toEqual(['11:55~11:59', '14:55~14:59'])
  })

  // 나머지 셋은 일과에 실내 지점이 있어 밤이 통째로 닫힌다. 여기에 낮의 이동
  // 구간이 몇 분씩 얹힌다 — 이것도 "지금 여기 없다"라 화면에서는 밤과 같은 안내다.
  it('나무 상점은 밤(22시~6시)과 두 번의 이동 동안 닫힌다', () => {
    expect(closedWindows('나무상점')).toEqual([
      '00:00~05:59',
      '07:56~07:59',
      '18:56~18:59',
      '22:00~23:59',
    ])
  })

  it('광물 상점은 밤(21시~6시)과 세 번의 이동 동안 닫힌다', () => {
    expect(closedWindows('광물상점')).toEqual([
      '00:00~05:59',
      '08:56~08:59',
      '12:55~12:59',
      '18:56~18:59',
      '21:00~23:59',
    ])
  })

  it('허브 상점은 밤(21시~6시)과 네 번의 이동 동안 닫힌다', () => {
    expect(closedWindows('허브상점')).toEqual([
      '00:00~05:59',
      '07:54~07:59',
      '12:55~12:59',
      '15:55~15:59',
      '18:54~18:59',
      '21:00~23:59',
    ])
  })

  // 사냥꾼은 일과가 없다 — speakers.csv 좌표(눈의마을 동쪽 문 곁)에 하루 종일
  // 서 있다(아크 E §4). 채집장노인의 "밤에도 열림"보다도 넓다: 걷는 10분조차
  // 없다. 누가 사냥꾼에게 일과를 달아 이 상점이 닫히기 시작하면 여기가 먼저 말한다.
  it('사냥 상점은 24시간 열려 있다 — 사냥꾼에게는 일과가 없다', () => {
    expect(data.schedules['사냥꾼']).toBeUndefined()
    expect(closedWindows('사냥상점')).toEqual([])
  })

  // 구간을 분으로 합친 것 — 하루의 몇 할이 영업 시간인가를 한 줄로 본다.
  // 얼음이 나머지 셋과 두 자릿수 배로 갈리는 것이 §6-앞 4 의 결정 그 자체다.
  it('하루 중 닫힌 시간이 얼음 10분 · 나무 488분 · 광물 553분 · 허브 562분이다', () => {
    const closedMinutes = (shopId: string): number =>
      closedWindows(shopId).reduce((sum, window) => {
        const [from, to] = window.split('~').map((clock) => {
          const [hour, minute] = clock.split(':').map(Number)
          return hour! * 60 + minute!
        })
        return sum + (to! - from! + 1)
      }, 0)

    expect(closedMinutes('얼음상점')).toBe(10)
    expect(closedMinutes('나무상점')).toBe(488)
    expect(closedMinutes('광물상점')).toBe(553)
    expect(closedMinutes('허브상점')).toBe(562)
  })

  it('닫힌 이유가 "숙련 부족"이 아니라 "지금 여기 없다"다 — 플레이어가 원인을 오해하면 안 된다', () => {
    const night = atGameMinute(2 * 60)
    const shop = data.shops['광물상점']!
    const rich = customerAt('광물상점')
    // customerAt 의 그 분기다 — 광물상점이라 아래 가지는 죽어 있지만, 눈금이
    // 둘(캐는 skills·전투 proficiency)이 된 세계에서 총체적으로 적는다.
    if (shop.skill === 'combat') rich.combat.proficiency = shop.unlockSkill * 100
    else rich.skills[shop.skill] = shop.unlockSkill * 100

    expect(shopAccess(data, shop.id, rich, night)).toBe('not_here')

    // 그 시각 상인은 정말로 실내에 있다 — 술어가 우연히 맞은 것이 아님을 일과로 확인한다.
    const state = npcStateAt(data.schedules[shop.speakerId]!, data.places, data.routes, night)
    expect(state.activity).toBe('indoor')
  })

  it('낮에 닫히는 10분 동안 채집장노인은 실내가 아니라 길 위에 있다 — 얼음 상점에 밤 개념이 없다는 것의 뒷면', () => {
    const walking = atGameMinute(11 * 60 + 57)
    const state = npcStateAt(data.schedules['채집장노인']!, data.places, data.routes, walking)
    expect(state.activity).toBe('walking')
    expect(shopAccess(data, '얼음상점', customerAt('얼음상점'), walking)).toBe('not_here')
  })
})
