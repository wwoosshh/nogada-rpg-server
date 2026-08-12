import {
  GAME_EPOCH_MS,
  REAL_MS_PER_GAME_MINUTE,
  npcStateAt,
  shopAccess,
  type PlayerState,
} from '@nogada/shared'
import { describe, expect, it } from 'vitest'
import { emptyPlayer } from './emptyPlayer.js'
import { loadGameData } from './load.js'

/**
 * 출하되는 상점 넷의 **영업 시간**을 실물 데이터로 못박는다.
 *
 * 상점은 사람이다 — 상인이 자기 일과대로 자러 들어가면 그 상점은 닫힌다(경제 설계
 * §6-앞 4). 이것은 버그가 아니라 세계가 살아 있다는 증거이고, 그래서 **의도라는
 * 사실 자체가 검증 대상**이다: 누가 일과를 고쳐 상점 하나가 24시간이 되거나
 * 반대로 종일 닫히면 이 파일이 먼저 말한다.
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
  player.skills[shop.skill] = shop.unlockSkill
  player.location = { mapId: speaker.mapId, x: speaker.x, y: speaker.y }
  return player
}

describe('상점의 영업 시간 — 상인이 자러 가면 상점도 닫힌다(§6-앞 4)', () => {
  it('한낮에는 상점 넷이 전부 열려 있다', () => {
    const noon = atGameMinute(12 * 60)
    for (const shop of Object.values(data.shops)) {
      expect(shopAccess(data, shop.id, customerAt(shop.id), noon), shop.id).toBe('ok')
    }
  })

  it('한밤(02:00)에는 실내로 들어간 상인의 상점만 닫힌다 — 어느 상점이 24시간인지가 데이터에 적혀 있다', () => {
    const night = atGameMinute(2 * 60)
    const closed: string[] = []
    for (const shop of Object.values(data.shops)) {
      const access = shopAccess(data, shop.id, customerAt(shop.id), night)
      if (access !== 'ok') {
        expect(access, shop.id).toBe('not_here')
        closed.push(shop.id)
      }
    }
    // 채집장노인만 실내 지점이 없다 — 문턱 대사의 주인이 밤마다 사라지면 핵심
    // 루프의 반응성이 죽기 때문이다(NPC 일과 설계 §8). 그래서 얼음 상점은 24시간이다.
    expect(closed.sort()).toEqual(['광물상점', '나무상점', '허브상점'])
  })

  it('닫힌 이유가 "숙련 부족"이 아니라 "지금 여기 없다"다 — 플레이어가 원인을 오해하면 안 된다', () => {
    const night = atGameMinute(2 * 60)
    const shop = data.shops['광물상점']!
    const rich = customerAt('광물상점')
    rich.skills[shop.skill] = shop.unlockSkill * 100

    expect(shopAccess(data, shop.id, rich, night)).toBe('not_here')

    // 그 시각 상인은 정말로 실내에 있다 — 술어가 우연히 맞은 것이 아님을 일과로 확인한다.
    const state = npcStateAt(data.schedules[shop.speakerId]!, data.places, data.routes, night)
    expect(state.activity).toBe('indoor')
  })
})
