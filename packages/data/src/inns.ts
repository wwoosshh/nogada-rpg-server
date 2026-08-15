import type { InnDef, SpeakerDef } from '@nogada/shared'
import { addUnique, requireCell, toInt } from './parse.js'

type Row = Record<string, string>

/**
 * `inns.csv` 를 파싱한다 — 여관 등록부다(아크 D §2). 상점(parseShops)·달인
 * (parseMasters)과 같은 줄의 결정: **대사가 아니라 등록부가 문을 연다.**
 *
 * **파서가 검증까지 진다**(계획 D2: 파서+검증). 상점의 화자 실재 검사는
 * validateGameData 에 있지만, 여관은 여기서 speakers 를 받아 그 자리에서
 * 거절한다 — 등록부가 한 행짜리라 파싱과 검증을 나누면 갈라질 자리만 하나 는다.
 * 없는 화자를 가리키는 여관은 아무도 못 연다: talkService 가 화자로 조회하므로
 * (§6-앞 1 그대로) 그 문은 존재하지 않는 것과 같고, 조용히 구우면 여관비만
 * 정해 둔 채 기계가 없던 그 상태로 되돌아간다.
 *
 * `gold` 는 toInt 의 기본 최솟값 1 을 그대로 쓴다 — 0 원 여관은 "공짜"가 아니라
 * 값을 안 적은 것과 구별되지 않는 데이터이고, §6 부등식(innPricing.test 가 구운
 * 이 값을 읽어 잰다)은 값이 있어야 성립한다.
 */
export function parseInns(rows: Row[], speakers: Record<string, SpeakerDef>): Record<string, InnDef> {
  const out: Record<string, InnDef> = {}
  for (const row of rows) {
    const speakerId = requireCell(row, 'speakerId', 'inns.csv')
    const ctx = `inns.csv[${speakerId}]`
    if (!Object.hasOwn(speakers, speakerId)) {
      throw new Error(`${ctx}: 없는 화자 "${speakerId}" 를 가리킨다 — speakers.csv 의 id 중 하나여야 한다`)
    }
    const def: InnDef = { speakerId, gold: toInt(requireCell(row, 'gold', ctx), ctx, 'gold') }
    // 한 화자에 여관 하나 — 두 행이면 어느 값이 그 여관비인지 정해지지 않는다
    // (상점의 "한 화자가 두 상점을 열 수 없다"와 같은 규범).
    addUnique(out, speakerId, def, 'inns.csv')
  }
  return out
}
