import type { MasterDef, ShopDef, ShopStockEntry } from '@nogada/shared'
import { addUnique, assertNotIntegerId, requireCell, toInt, toSkillId, toSkillOrCombat } from './parse.js'

type Row = Record<string, string>

/**
 * 진열 한 줄의 문 하나를 CSV 의 두 칸에서 접는다(설계 §6-앞 7).
 *
 * **정확히 하나여야 한다.** 둘 다 적히면 어느 쪽이 이기는지를 아무도 적어 두지
 * 않은 규칙이 되고(그 답은 판정과 화면에서 각자 다르게 굳는다), 둘 다 비면 그
 * 칸이 언제 열리는지가 없어진다 — 조용히 "0" 으로 읽어 열어 버리면 잠근 줄 알았던
 * 진열이 처음부터 열려 있다. 그래서 이 갈림길은 파서가 그 자리에서 거절한다.
 *
 * 빈칸과 `0` 은 다르다: `0` 은 "처음부터 열려 있다"라는 유효한 설계이고(상점
 * unlockSkill 0 과 같은 뜻), 빈칸은 "이 문은 안 쓴다"이다. 그래서 값이 있는지를
 * `requireCell` 이 아니라 문자열 길이로 먼저 묻는다.
 */
function toStockUnlock(row: Row, ctx: string): Pick<ShopStockEntry, 'unlockBy' | 'unlockAt'> {
  const skill = (row['unlockSkill'] ?? '').trim()
  const collection = (row['unlockCollection'] ?? '').trim()

  if (skill !== '' && collection !== '') {
    throw new Error(
      `${ctx}: unlockSkill(${skill}) 과 unlockCollection(${collection}) 이 둘 다 적혔다 — 진열 한 칸은 문 하나로만 열린다. 숙련으로 열 것이면 unlockCollection 을, 수집 총점으로 열 것이면 unlockSkill 을 비운다`,
    )
  }
  if (skill === '' && collection === '') {
    throw new Error(
      `${ctx}: unlockSkill 과 unlockCollection 이 둘 다 비었다 — 이 칸이 언제 열리는지가 없다. 처음부터 열어 두려면 unlockSkill 에 0 을 적는다(빈칸은 0 이 아니다)`,
    )
  }

  // min 0 을 명시한다 — toInt 의 기본 최솟값 1 을 그대로 쓰면 "처음부터 열려
  // 있다"를 적을 방법이 없어 작가가 1 이라는 거짓 문턱을 적게 된다.
  return collection === ''
    ? { unlockBy: 'skill', unlockAt: toInt(skill, ctx, 'unlockSkill', 0) }
    : { unlockBy: 'collection', unlockAt: toInt(collection, ctx, 'unlockCollection', 0) }
}

/**
 * `shops.csv` 와 `shop_stock.csv` 를 함께 읽어 상점 등록부를 만든다.
 *
 * 두 파일을 **한 함수가** 읽는 이유는 진열이 상점 없이 존재할 수 없기 때문이다 —
 * 따로 파싱해 나중에 잇게 두면 "어느 상점에도 안 붙은 진열"이라는 중간 상태가
 * 생기고, 그 상태를 검사하는 일이 부르는 쪽마다 하나씩 늘어난다. 여기서 붙이면
 * 오타 난 shopId 는 붙일 자리가 없는 그 자리에서 바로 드러난다.
 *
 * **되사기는 `buybackFrom` 이라는 새 칸으로 오지 않았다**(설계 §6-앞 7). 그 자리를
 * 비워 둔 옛 이유("아무도 읽지 않는 칸은 오타가 조용히 사는 자리다")가 그대로
 * 답이 됐다: 되사기는 진열 행 몇 줄과 그 행을 여는 문 하나일 뿐이라, 이미 있는
 * 진열 문법에 `unlockCollection` 한 칸을 더하는 것으로 전부 표현된다.
 */
export function parseShops(shopRows: Row[], stockRows: Row[]): Record<string, ShopDef> {
  const out: Record<string, ShopDef> = {}
  for (const row of shopRows) {
    const id = requireCell(row, 'shopId', 'shops.csv')
    const ctx = `shops.csv[${id}]`
    assertNotIntegerId(id, ctx)
    const def: ShopDef = {
      id,
      name: requireCell(row, 'name', ctx),
      // 화자가 실재하는지는 화자 등록부를 함께 보는 validateGameData 의 몫이다.
      speakerId: requireCell(row, 'speakerId', ctx),
      // 계열은 SkillId ∨ 'combat' 이다(아크 E §4 — 사냥 판로). 아이템의 skill
      // 칸과 같은 변환기를 쓴다: 매도 판정이 두 칸의 동치라, 허용값이 한쪽만
      // 넓어지면 팔리지 않는 계열이 조용히 생긴다.
      skill: toSkillOrCombat(requireCell(row, 'skill', ctx), ctx),
      // min 0 을 명시한다 — toInt 의 기본 최솟값 1 을 그대로 쓰면 "처음부터 열려
      // 있다"를 적을 방법이 없어 작가가 1 이라는 거짓 문턱을 적게 된다.
      unlockSkill: toInt(requireCell(row, 'unlockSkill', ctx), ctx, 'unlockSkill', 0),
      stock: [],
    }
    addUnique(out, id, def, 'shops.csv')
  }

  for (const row of stockRows) {
    const shopId = requireCell(row, 'shopId', 'shop_stock.csv')
    const itemId = requireCell(row, 'itemId', `shop_stock.csv[${shopId}]`)
    const ctx = `shop_stock.csv[${shopId}/${itemId}]`
    const shop = out[shopId]
    if (!shop) {
      throw new Error(`${ctx}: 없는 상점 "${shopId}" 의 진열이다 — shops.csv 의 shopId 중 하나여야 한다`)
    }
    // 유일해야 하는 것은 (상점, 아이템) 짝이지 아이템이 아니다 — 두 상점이 같은
    // 물건을 파는 것은 정상이다(§6-앞 14). 같은 상점에 두 번 적히면 목록에 같은
    // 물건이 두 줄로 뜨고, 요구치가 다르면 어느 쪽이 그 문턱인지 정해지지 않는다.
    if (shop.stock.some((entry) => entry.itemId === itemId)) {
      throw new Error(`${ctx}: 같은 상점에 같은 아이템을 두 번 진열했다`)
    }
    shop.stock.push({ itemId, ...toStockUnlock(row, ctx) })
  }

  return out
}

/**
 * `masters.csv` 를 파싱한다 — 달인 넷의 1회성 대금이다(설계 §6-앞 2).
 *
 * 레코드가 아니라 배열인 이유는 찾는 키가 하나로 정해지지 않아서다: 서버는
 * 화자로 찾고(말을 건 사람이 달인인가), 검증은 기술로 센다(한 기술에 달인 하나).
 * 그래도 id 중복은 막는다 — 지급 여부가 그 id 로 기억되므로(`PlayerState.rewarded`)
 * 두 행이 같은 id 를 쓰면 한쪽을 받은 사람이 다른 쪽도 받은 것이 된다.
 */
export function parseMasters(rows: Row[]): MasterDef[] {
  const seen: Record<string, true> = {}
  const out: MasterDef[] = []
  for (const row of rows) {
    const id = requireCell(row, 'id', 'masters.csv')
    const ctx = `masters.csv[${id}]`
    addUnique(seen, id, true, 'masters.csv')
    out.push({
      id,
      speakerId: requireCell(row, 'speakerId', ctx),
      skill: toSkillId(requireCell(row, 'skill', ctx), ctx),
      // 둘 다 toInt 의 기본 최솟값 1 을 그대로 쓴다 — 0 을 허용할 이유가 없다.
      // threshold 0 은 아무것도 안 한 사람에게 주는 것이고, gold 0 은 지급이
      // 일어났는지 화면에서 구별되지 않는 지급이다.
      threshold: toInt(requireCell(row, 'threshold', ctx), ctx, 'threshold'),
      gold: toInt(requireCell(row, 'gold', ctx), ctx, 'gold'),
    })
  }
  return out
}
