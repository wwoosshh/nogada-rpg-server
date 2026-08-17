import { describe, expect, it } from 'vitest'
import { buildFacts, emptyDialogueHistory, selectDialogue } from '@nogada/shared'
import type { DialogueRule } from '@nogada/shared'
import { emptyPlayer } from './emptyPlayer.js'
import { loadGameData } from './load.js'

/**
 * **첫 만남 인사에는 두 번째 기회가 없다.**
 *
 * `talkedBefore` 는 한 번 말하면 영원히 참이다(shared/src/facts.ts) — 그래서 이
 * 네 줄은 규칙 중에 유일하게 **한 사람당 한 번만 나올 수 있는 @greet** 이고,
 * 그 한 번을 동점에서 잃으면 그 사람은 그 줄을 평생 못 듣는다. 되풀이되는 줄
 * (지점·날씨·숙련 구간)은 다음 대화에서 다시 기회가 오지만 이쪽은 아니다.
 *
 * 처음 넣었을 때 이 네 규칙은 조건이 하나뿐이라 지점·날씨 인사(조건 하나)와
 * 50:50 이었고, 일과로 재면 새 계정의 6분의 1(벌목꾼)·6%(약초지기)가 그 줄을
 * 못 듣고 지나갔다. 지금은 위끝(`skill.{계열}<{첫 구간 아래끝}`)을 얹어 조건
 * 둘로 세워 두었다 — 숙련 구간 인사와는 **동시에 참이 될 수 없어서** 그쪽과도
 * 동점이 안 난다.
 *
 * **이 검사가 조건 개수를 안 세고 실제 선택을 재는 이유**: 세는 것은 지금의
 * 처방을 재는 것이고, 지키려는 것은 처방이 아니라 「새 계정이 그 줄을 듣는다」다.
 * 다음 사람이 다른 방법으로 같은 것을 지키면 이 검사는 그대로 통과해야 한다.
 */
describe('첫 만남 인사 — 새 계정은 어느 자리·어느 날씨에서도 그 줄을 듣는다', () => {
  const data = loadGameData()

  /** 겨울 3일 07:12 근처 — 시각은 이 네 규칙 어디에도 조건으로 안 걸려 있다. */
  const FIXED_NOW = 1_700_000_000_000

  /** 네 계열 주인. 이 넷만 초면 인사를 갖는다(설계 ⑧-10). */
  const OWNERS = [
    ['채집장노인', 'ice'],
    ['숲마을벌목꾼', 'wood'],
    ['항구약초지기', 'herb'],
    ['광산노인', 'mineral'],
  ] as const

  /** 그 화자의 초면 인사 — `talkedBefore` 를 조건에 건 @greet 은 하나뿐이다. */
  function firstMeetingRuleOf(speaker: string): DialogueRule {
    const rules = data.dialogue.filter(
      (r) => r.speaker === speaker && r.event === 'greet' && r.conditions.some((c) => c.fact === 'talkedBefore'),
    )
    expect(rules, `${speaker} 의 초면 인사`).toHaveLength(1)
    return rules[0]!
  }

  /**
   * 그 화자의 규칙들이 조건으로 쓰는 지점 전부 + 아무 데도 아닌 자리.
   *
   * 목록을 손으로 적지 않는 이유: 일과가 자리를 하나 더 얻는 날 이 검사가 그
   * 자리를 자동으로 함께 재야 한다. 벌목꾼이 목재소 앞에서만 밀리던 것이
   * 정확히 「그 자리에서만 지는 규칙」이었다.
   */
  function placesOf(speaker: string): (string | undefined)[] {
    const named = new Set(
      data.dialogue
        .filter((r) => r.speaker === speaker)
        .flatMap((r) => r.conditions.filter((c) => c.fact === 'place').map((c) => String(c.value))),
    )
    return [undefined, ...named]
  }

  it.each(OWNERS)('%s 의 초면 인사가 지점·날씨 인사를 전부 이긴다', (speaker, skill) => {
    const first = firstMeetingRuleOf(speaker)
    // 아무것도 안 캔 새 계정이다 — 숙련 0 이라 구간 인사는 애초에 안 걸린다.
    expect(emptyPlayer().skills[skill]).toBe(0)

    for (const place of placesOf(speaker)) {
      for (const weather of [undefined, 'rain'] as const) {
        const facts = buildFacts({ speaker, player: emptyPlayer(), world: data, nowMs: FIXED_NOW, place })
        expect(facts.talkedBefore, '새 계정은 아무와도 말해 본 적이 없다').toBe(false)
        // 비 가루를 쓴 사람의 자리다 — 이 사실은 날씨가 실제로 서 있을 때만 찬다.
        if (weather) facts.weather = weather

        // 동점이면 뽑기 값에 따라 답이 갈린다 — 양 끝과 가운데를 다 물어본다.
        for (const roll of [0, 0.4, 0.6, 0.99]) {
          const got = selectDialogue(speaker, data.dialogue, facts, emptyDialogueHistory(), () => roll)
          expect(got?.rule, `place=${place ?? '없음'} weather=${weather ?? '없음'} rng=${roll}`).toBe(first)
        }
      }
    }
  })

  /**
   * **이미 그 계열을 캐고 온 사람에게는 초면 인사부터 하지 않는다** — 위끝을 얹으며
   * 잃지 않았어야 하는 쪽이다.
   *
   * 아래끝을 그 화자의 첫 숙련 구간 아래끝으로 잡았으므로, 그 구간에 들어선
   * 사람에게는 이 규칙이 아예 안 걸리고 구간 인사(상점이 열렸다는 정보까지
   * 실린 쪽)가 그대로 이긴다. 위끝을 잘못 잡으면 여기서 드러난다.
   */
  it.each(OWNERS)('%s: 숙련 구간에 들어선 사람에게는 초면 인사가 안 나온다', (speaker, skill) => {
    const first = firstMeetingRuleOf(speaker)
    // 그 화자의 구간 인사 중 가장 낮은 아래끝 — 초면 인사의 위끝이 이 값이어야 한다.
    const brackets = data.dialogue
      .filter((r) => r.speaker === speaker && r.event === 'greet' && r !== first)
      .flatMap((r) =>
        r.conditions
          .filter((c) => c.fact === `skill.${skill}` && (c.op === '>=' || c.op === '>') && typeof c.value === 'number')
          .map((c) => (c.op === '>' ? (c.value as number) + 1 : (c.value as number))),
      )
    expect(brackets.length, `${speaker} 의 숙련 구간 인사`).toBeGreaterThan(0)
    const lowest = Math.min(...brackets)

    const veteran = { ...emptyPlayer(), skills: { ...emptyPlayer().skills, [skill]: lowest } }
    const facts = buildFacts({ speaker, player: veteran, world: data, nowMs: FIXED_NOW })
    for (const roll of [0, 0.99]) {
      const got = selectDialogue(speaker, data.dialogue, facts, emptyDialogueHistory(), () => roll)
      expect(got?.rule, `skill.${skill}=${lowest} rng=${roll}`).not.toBe(first)
    }
  })
})
