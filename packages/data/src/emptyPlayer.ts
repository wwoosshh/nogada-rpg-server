import {
  DEFAULT_APPEARANCE,
  SKILL_IDS,
  defaultCombatState,
  emptyDialogueHistory,
  type PlayerState,
  type SkillId,
} from '@nogada/shared'
import { loadGameData } from './load.js'
import { startLocation } from './maps.js'

/**
 * "빈 플레이어" — 숙련도 전부 0, 이정표 전부 미달성, 대화 이력 없음(한 번도
 * 말해 본 적 없음).
 *
 * 대사 시뮬레이터(`pnpm content dialogue`, content-cli.ts)의 기본 사실 뭉치와
 * 공급자↔선언 드리프트 테스트(facts.test.ts)가 둘 다 이 개념을 쓴다. 예전엔
 * 두 곳이 각자 이 리터럴을 손으로 적어 뒀는데, 그러면 PlayerState 에 필드가
 * 추가될 때 한쪽만 고치고 잊는 경우가 생긴다 — 여기 하나로 모아 그 여지를
 * 없앤다.
 *
 * `id` 는 임의의 자리표시자다. buildFacts 를 비롯해 이 값을 들여다보는 코드가
 * 없으므로 무엇을 넣어도 결과가 달라지지 않는다.
 */
export function emptyPlayer(): PlayerState {
  return {
    id: 'empty',
    // 이름도 외형도 시뮬레이터가 보지 않는다(대사 조건은 숙련도·이력·자리를 본다).
    // id 와 같은 성격의 자리표시자다.
    name: '',
    appearance: DEFAULT_APPEARANCE,
    skills: Object.fromEntries(SKILL_IDS.map((skill) => [skill, 0])) as Record<SkillId, number>,
    stacks: {},
    // 수집의 방이 통째로 비어 있다 — 총점 0 이고, 그것이 "아직 아무것도 하지
    // 않았다"의 이 아크 몫이다.
    donated: {},
    // 한 번도 팔아 본 적 없는 사람이다 — 숙련도 0 과 같은 성격의 "아직 아무것도
    // 하지 않았다"이고, 신규 캐릭터(createInitialPlayer)의 시작 골드와 같은 값이다.
    gold: 0,
    instances: [],
    equipped: {},
    nextActionAt: 0,
    celebrated: [],
    // 사슬의 첫 마디에 서 있고 아직 아무것도 세지 않았다 — 숙련도 0 과 같은
    // 성격의 "아직 아무것도 하지 않았다" 이고, 신규 캐릭터와 같은 값이다.
    story: 0,
    storyCount: 0,
    // **마을도 아직 안 골랐다.** 빈 문자열은 "모른다" 이지 눈의마을이 아니다
    // (PlayerState.startVillage) — 여기 마을 하나를 적으면 이 함수를 바탕으로
    // 재는 것들이 전부 그 마을 사람이 되고, 그중에는 "마을을 무엇으로 유도하는가"
    // 를 재는 검사들이 있다. 아래 `location` 이 시작 맵인 것과 어긋나지 않는다:
    // 유도는 서 있는 자리를 보므로(storyVillage ②) 같은 답을 낸다.
    startVillage: '',
    // 아직 어떤 달인의 문턱도 넘지 않은 사람이다 — celebrated 와 같은 성격의
    // "아직 아무 일도 없었다"이고, 시뮬레이터가 흉내 내는 것이 정확히 그 상태다.
    rewarded: [],
    dialogueHistory: emptyDialogueHistory(),
    // 아직 아무 가루도 써 보지 않은 사람이다 — 그 하늘에는 아무 일도 없다.
    // 시뮬레이터는 `--weather=rain` 으로 비 오는 날을 따로 그려 볼 수 있다.
    weather: null,
    combat: defaultCombatState(),
    // 시뮬레이터가 "아직 아무 데도 안 간 사람" 을 흉내 내는 것이므로 시작 맵의
    // 시작 칸이다. 좌표를 여기 적지 않는다 — 그 칸은 world.tmx 의 spawn
    // 오브젝트가 갖고 있고, 맵을 고쳐 그리면 이 값도 함께 움직여야 한다.
    location: startLocation(loadGameData()),
  }
}
