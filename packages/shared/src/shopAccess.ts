import { npcStateAt } from './npcSchedule.js'
import type { GameData, PlayerState } from './types.js'

/**
 * 접근 술어 둘이 사는 곳 — **난수도 이력도 부작용도 없다**(설계 §6-앞 3).
 *
 * 왜 순수 술어인가: "서버가 대사 규칙을 다시 평가해 인가한다"는 성립하지 않는다.
 * `selectDialogue` 재실행은 난수와 `recent` 에 의존해 비결정적이고, `performTalk`
 * 재실행은 `said`·`lastTalkAt` 을 태운다 — 물건 하나 팔 때마다 그 화자의 1회성
 * 대사가 소진된다. 그래서 인가는 상태만 보는 함수 하나가 판정하고, talk·sell·buy
 * 셋이 **같은 함수**를 부른다.
 *
 * 두 술어가 한 파일에 사는 것도 같은 이유다: `shopAccess` 는 `speakerPresence`
 * 에 두 검사를 얹은 것이라, 떨어뜨려 두면 언젠가 현장 판정의 사본이 하나 더 생긴다.
 */

/**
 * 지금 이 화자에게 말이 걸리는가.
 *
 * `not_here` 는 "맵에는 맞게 왔는데 그 사람이 지금 여기 없다" 다 — 실내로
 * 들어갔거나 길 위를 걷는 중이다. `wrong_map` 과 나누는 이유는 플레이어가 할
 * 일이 다르기 때문이다: 저쪽은 따라가면 되고, 이쪽은 기다리거나 다시 와야 한다.
 */
export type SpeakerPresence = 'ok' | 'unknown_speaker' | 'wrong_map' | 'not_here'

/**
 * 화자 현장 판정. `talkService.performTalk` 의 그 블록을 **판정 한 글자 바꾸지
 * 않고** 옮겨 온 것이고, 이제 talk·sell·buy 가 이 하나를 나눠 쓴다(§6-앞 3).
 * 두 벌로 적으면 "말은 걸리는데 못 파는" 화면이 온다.
 *
 * 시각은 인자로 받는다 — 여기서 `Date.now()` 를 읽으면 라우트가 판정에 쓴 시각과
 * 갈라지고, 테스트는 시간을 고정할 방법을 잃는다.
 */
export function speakerPresence(
  data: GameData,
  speakerId: string,
  player: PlayerState,
  nowMs: number,
): SpeakerPresence {
  // speakerId 는 클라이언트가 그대로 보낸 문자열이다. data.speakers[speakerId] 로
  // 바로 읽으면 "constructor" 같은 상속 키가 프로토타입 체인에서 값을 찾아
  // truthy 를 반환한다 — gatherService 가 placements 에서 막는 것과 같은 구멍이다.
  const speaker = Object.hasOwn(data.speakers, speakerId) ? data.speakers[speakerId] : undefined
  if (!speaker) return 'unknown_speaker'

  // 일과가 있는 화자는 speakers.csv 의 좌표에 있지 않다 — 그 사람의 자리는
  // 시각이 정한다(설계 §5). 위 speakerId 검사를 통과했으므로 이것은 실재하는
  // 화자 id 지만, 그래도 hasOwn 으로 읽는다: "constructor" 같은 이름의 화자가
  // 있으면 프로토타입 체인의 값이 일과 행세를 한다.
  const schedule = Object.hasOwn(data.schedules, speakerId) ? data.schedules[speakerId] : undefined

  if (schedule) {
    const state = npcStateAt(schedule, data.places, data.routes, nowMs)

    // 걷는 중에는 몸이 없고(통과 장식), 실내면 맵에 없다 — 둘 다 "여기 없다"다.
    // 맵 검사보다 먼저 보는 이유: 길 위의 NPC 는 어느 맵에 있든 말이 걸리지
    // 않으므로, 맵이 맞다는 이유로 통과시키면 걷는 사람과 대화가 열린다.
    if (state.activity !== 'standing') return 'not_here'
    if (state.mapId !== player.location.mapId) return 'wrong_map'
    return 'ok'
  }

  // 이것이 대화 스펙이 남긴 구멍이다. 앞칸 판정은 클라이언트에만 있어서, 서버가
  // 어느 맵인지 모르면 화자 id 하나로 맵 너머의 화자와 대화가 열린다 — 그리고
  // 그 대화가 said·recent 에까지 남아 다시 되돌릴 수도 없다. gatherService 와
  // 같은 검사이고 같은 근거다: 맵이 다르면 앞칸일 수가 없다.
  if (speaker.mapId !== player.location.mapId) return 'wrong_map'
  return 'ok'
}

/** 상점 문이 열리는가. 다섯 결과 전부가 화면에서 서로 다른 안내가 된다. */
export type ShopAccess = 'ok' | 'unknown_shop' | 'shop_locked' | 'wrong_map' | 'not_here'

/**
 * 상점 접근 판정 — **상점이 열리는 유일한 출처**다(설계 §6-앞 1·3).
 *
 * 순서가 규범이다: 존재 → 해금 → 현장. "지금 여기 없다"는 기다리면 되는
 * 안내이고 "숙련이 모자라다"는 숫자를 올려야 하는 안내다. 현장을 먼저 보면
 * 요구치를 못 채운 플레이어가 영원히 "조금 있다 다시 오라"는 말만 듣는다.
 *
 * 재는 숙련도는 언제나 **그 상점의 계열**이다(§6-앞 14) — 남의 계열을 팔려면
 * 그 마을에 가야 한다는 것이 이 게임의 월드가 살아 있는 이유다.
 */
export function shopAccess(data: GameData, shopId: string, player: PlayerState, nowMs: number): ShopAccess {
  // shopId 도 클라이언트가 보낸 문자열이다 — speakerId 와 같은 이유의 hasOwn.
  const shop = Object.hasOwn(data.shops, shopId) ? data.shops[shopId] : undefined
  if (!shop) return 'unknown_shop'

  if (player.skills[shop.skill] < shop.unlockSkill) return 'shop_locked'

  const presence = speakerPresence(data, shop.speakerId, player, nowMs)
  // 없는 화자를 가리키는 상점은 빌드 검증이 막으므로 정상 데이터에서는 오지
  // 않는다. 그래도 총체적으로 답해야 하고, 그때의 답은 unknown_shop 이다 —
  // 영영 닿을 수 없는 상점은 플레이어에게 없는 상점과 같다. 여기서 화자의
  // 부재를 상점의 부재로 번역하지 않으면 클라이언트가 다룰 수 없는 코드가
  // 하나 새어 나간다.
  return presence === 'unknown_speaker' ? 'unknown_shop' : presence
}
