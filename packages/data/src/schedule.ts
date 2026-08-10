import type { GameData, ScheduleDef, ScheduleEntry } from '@nogada/shared'
// 이름은 대사에서 왔지만 하는 일은 "파일:줄" 한 가지 꼴을 지키는 것이다.
// 여기서 따로 지으면 같은 빌드 출력 안에 위치 표기가 두 가지로 나온다.
import { dialogueLocation } from './dialogueParse.js'

/**
 * 일과 파일 하나 — 이름과 내용. 파일을 찾는 일은 부르는 쪽(build.ts)이 한다.
 * `.dlg` 와 같은 모양이다(DialogueSource).
 */
export interface ScheduleSource {
  file: string
  text: string
}

export const SCHEDULE_EXT = '.sched'

/**
 * 분을 작가가 파일에 쓴 꼴로 되돌린다.
 *
 * 검증 메시지가 "540분" 이라고 하면 작가는 그 줄을 눈으로 찾을 수 없다.
 * routeBake 의 시간표 메시지도 이 함수를 쓴다 — 같은 시각이 두 가지 글자로
 * 나오면 그것부터 대조해야 한다.
 */
export function formatMinute(minute: number): string {
  const h = Math.floor(minute / 60)
  const m = minute % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** "schedules/여관안주인.sched" 든 "여관안주인.sched" 든 화자 id 만 남긴다. */
function speakerIdFromFile(file: string): string {
  const base = file.split(/[\\/]/).pop() ?? file
  return base.endsWith(SCHEDULE_EXT) ? base.slice(0, -SCHEDULE_EXT.length) : base
}

/**
 * `HH:MM` 을 하루 중 분으로 편다.
 *
 * 두 자리가 아닌 시(9:00)도 받는다 — 그것을 막아서 얻는 것이 없다. 대신
 * **범위**는 막는다: 25:00 은 하루를 넘는 시각이라 그 줄이 영영 활성이 되지
 * 않고, 작가에게는 "왜 저기 안 가지"만 남는다.
 */
function parseMinute(raw: string, file: string, line: number): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(raw)
  if (!match) {
    throw new Error(
      `${dialogueLocation(file, line)}: 시각 "${raw}" 를 읽을 수 없다 — 줄은 "HH:MM 지점" 으로 시작한다 (예: 06:00 여관앞)`,
    )
  }
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) {
    throw new Error(
      `${dialogueLocation(file, line)}: 시각 "${raw}" 는 하루 안에 없다 — 00:00 부터 23:59 까지다`,
    )
  }
  return hour * 60 + minute
}

/**
 * `.sched` 파일 하나를 파싱한다. 파일 하나 = 화자 하나다(`.dlg` 와 같은 규칙).
 *
 * 형식:
 * ```
 * # 주석
 * 06:00 여관앞
 * 15:00 눈광장 | 여관앞
 * ```
 *
 * - `#` 로 시작하는 줄과 빈 줄은 무시한다.
 * - 시각은 **도착** 시각이다. 출발은 빌드가 경로 길이로 역산한다(routeBake).
 * - `A | B` 는 변주 후보다 — 날짜 시드가 그중 하나를 고른다.
 *
 * 오류를 던지는 것은 `.dlg` 와 같은 자세다: 파일 하나를 보는 함수로서는 그게
 * 맞고, 여러 파일을 모으는 parseScheduleFiles 가 그것을 목록으로 바꾼다.
 */
export function parseSchedule(text: string, file: string): ScheduleDef {
  const entries: ScheduleEntry[] = []
  const lineOfMinute = new Map<number, number>()

  text.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1
    const trimmed = raw.trim()
    if (trimmed === '' || trimmed.startsWith('#')) return

    // 첫 공백에서만 자른다 — 지점 이름에 공백이 들어갈 수 있다("여관 앞").
    const cut = trimmed.search(/\s/)
    const timeRaw = cut < 0 ? trimmed : trimmed.slice(0, cut)
    const rest = cut < 0 ? '' : trimmed.slice(cut).trim()

    const arriveMinute = parseMinute(timeRaw, file, line)

    if (rest === '') {
      throw new Error(
        `${dialogueLocation(file, line)}: 시각만 있고 지점이 없다 — "${timeRaw} <지점 이름>" 으로 적는다`,
      )
    }
    const placeIds = rest.split('|').map((s) => s.trim())
    if (placeIds.some((id) => id === '')) {
      throw new Error(
        `${dialogueLocation(file, line)}: 변주 후보 중 비어 있는 것이 있다 — "A | B" 처럼 | 양쪽에 지점 이름을 적는다`,
      )
    }

    const seen = lineOfMinute.get(arriveMinute)
    if (seen !== undefined) {
      throw new Error(
        `${dialogueLocation(file, line)}: 같은 시각 ${formatMinute(arriveMinute)} 이 ${seen}행에도 있다 — ` +
          `도착 시각이 같은 두 줄은 앞엣것이 조용히 죽는다. 시각을 벌리거나 한 줄로 합친다`,
      )
    }
    const last = entries[entries.length - 1]
    if (last && arriveMinute < last.arriveMinute) {
      throw new Error(
        `${dialogueLocation(file, line)}: 시각 ${formatMinute(arriveMinute)} 이 앞 줄 ${formatMinute(last.arriveMinute)} 보다 이르다 — ` +
          `일과는 하루 순서대로 적는다. 자정을 넘겨 이어지는 것은 마지막 줄에서 첫 줄로 돌아가는 구간 하나뿐이다`,
      )
    }
    lineOfMinute.set(arriveMinute, line)
    entries.push({ arriveMinute, placeIds })
  })

  if (entries.length === 0) {
    throw new Error(
      `${file}: 일과가 한 줄도 없다 — 빈 일과는 "어디에도 없는 NPC" 가 된다. ` +
        `한 줄이라도 적으면(예: 06:00 초소) 하루 종일 그 지점에 서 있는 것이 되고, ` +
        `일과를 아직 안 정했다면 이 파일을 지운다`,
    )
  }

  return { speakerId: speakerIdFromFile(file), entries }
}

export interface ScheduleParseResult {
  /** 파싱에 성공한 일과. 키는 화자 id 다. */
  schedules: Record<string, ScheduleDef>
  /** 실패한 파일마다 한 줄. 검증 위반과 같은 꼴이다. */
  errors: string[]
}

/**
 * `.sched` 여러 개를 파싱하되 문법 오류를 **던지지 않고 모은다.**
 *
 * parseDialogueFiles 와 같은 이유다 — 깨진 파일이 여럿이면 전부 보고해야
 * 작가가 한 번에 고친다. 한 파일 안의 두 번째 오류까지 모으지는 않는다.
 */
export function parseScheduleFiles(sources: readonly ScheduleSource[]): ScheduleParseResult {
  const schedules: Record<string, ScheduleDef> = {}
  const errors: string[] = []

  for (const { file, text } of sources) {
    try {
      const sched = parseSchedule(text, file)
      // 파일 이름이 화자 id 라 같은 id 가 둘일 수 없다(파일 시스템이 막는다).
      // 그래도 남겨 둔다 — 이 함수는 파일이 아닌 목록을 받으므로, 부르는 쪽이
      // 같은 화자를 두 번 넣는 것을 여기서 알아채는 편이 낫다.
      if (schedules[sched.speakerId]) {
        errors.push(`${file}: 화자 "${sched.speakerId}" 의 일과 파일이 둘이다 — 화자당 하나여야 한다`)
        continue
      }
      schedules[sched.speakerId] = sched
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err))
    }
  }

  return { schedules, errors }
}

/**
 * 일과가 가리키는 것들이 실재하는지 본다.
 *
 * 파서와 나란히 두는 것은 transitions.ts 의 선례다 — 같은 데이터를 읽는 두
 * 가지 일(파싱·검증)이 갈라져 있으면 한쪽만 고치기 쉽다. 경로가 실제로
 * 이어지는지·시간 안에 닿는지는 지형이 필요해서 routeBake 가 본다.
 */
export function validateSchedules(data: GameData): string[] {
  const violations: string[] = []

  for (const sched of Object.values(data.schedules)) {
    const at = `schedules[${sched.speakerId}]`

    if (!data.speakers[sched.speakerId]) {
      violations.push(
        `${at}: 이 이름의 화자가 speakers.csv 에 없다 — 파일 이름이 곧 화자 id 다. ` +
          `이름을 맞추거나 speakers.csv 에 그 화자를 추가한다`,
      )
    }

    for (const entry of sched.entries) {
      for (const placeId of entry.placeIds) {
        if (!data.places[placeId]) {
          violations.push(
            `${at} ${formatMinute(entry.arriveMinute)}: 없는 지점 "${placeId}" 를 가리킨다 — ` +
              `지점은 맵 파일의 places 오브젝트 레이어에 그 이름으로 찍혀 있어야 한다`,
          )
        }
      }
    }
  }

  return violations
}

/**
 * 두 NPC 가 같은 시각 같은 지점에 서는 것을 안내로 모은다. **막지 않는다.**
 *
 * 겹쳐 서기는 의도일 수 있다(둘이 마주 서서 이야기하는 그림). 그래서 위반이
 * 아니라 안내다 — collectDialogueNotices 와 같은 자리에서 같은 꼴로 나온다.
 *
 * 보는 것은 "도착 시각과 후보 지점이 같은 두 줄" 하나뿐이다. 서 있는 구간이
 * 실제로 겹치는지까지 따지려면 경로 길이와 변주 선택을 전부 펼쳐야 하는데,
 * 그건 추측이 섞인 넓은 검사가 된다 — 좁고 확실한 쪽을 고른다(validate.ts 의
 * contradicts 와 같은 저울).
 */
export function collectScheduleNotices(data: GameData): string[] {
  const standing = new Map<string, string[]>()

  for (const sched of Object.values(data.schedules)) {
    for (const entry of sched.entries) {
      for (const placeId of entry.placeIds) {
        const key = `${entry.arriveMinute} ${placeId}`
        const who = standing.get(key)
        if (who) {
          if (!who.includes(sched.speakerId)) who.push(sched.speakerId)
        } else {
          standing.set(key, [sched.speakerId])
        }
      }
    }
  }

  const notices: string[] = []
  for (const [key, who] of standing) {
    if (who.length < 2) continue
    const [minute, placeId] = key.split(' ')
    notices.push(
      `일과 ${who.length}개가 ${formatMinute(Number(minute))} 에 같은 지점 "${placeId}" 에 선다 (${who.join(', ')}) — 겹쳐 서는 것이 의도라면 그대로 두어도 된다`,
    )
  }
  return notices.sort()
}
