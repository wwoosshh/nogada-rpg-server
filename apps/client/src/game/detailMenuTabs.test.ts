import { emptyPlayer, loadGameData } from '@nogada/data'
import { describe, expect, it } from 'vitest'
import { SETTINGS_ACTION, TABS } from './detailMenuTabs.js'

function settingsLines() {
  const tab = TABS.find((t) => t.id === 'settings')!
  return tab.buildLines(loadGameData(), emptyPlayer())
}

describe('설정 탭', () => {
  // 왜: 이 두 줄이 계정을 놓는 유일한 문이다. groupId 가 빠지면 줄은 그대로
  //     보이는데 눌리지만 않아서, 화면만 봐서는 고장인지 원래 그런 것인지
  //     구별되지 않는다 — ScrollList 는 groupId 없는 줄을 표시 전용으로 다룬다.
  it('로그아웃과 캐릭터 삭제는 누를 수 있는 줄이다', () => {
    const groups = new Set(settingsLines().map((l) => l.groupId).filter(Boolean))
    expect(groups).toContain(SETTINGS_ACTION.logout)
    expect(groups).toContain(SETTINGS_ACTION.deleteCharacter)
  })

  // 왜: 같은 groupId 를 쓰면 로그아웃을 누른 사람에게 삭제 확인 창이 뜬다.
  //     되돌릴 수 있는 일과 없는 일이 한 버튼이 되는 것이 이 검사가 막는 것이다.
  it('둘은 서로 다른 줄이다', () => {
    expect(SETTINGS_ACTION.logout).not.toBe(SETTINGS_ACTION.deleteCharacter)
  })

  // 왜: 누르기 전에 되돌릴 수 없다는 것을 말해야 한다. 누른 뒤에 처음 듣는
  //     경고는 이미 마음을 정한 사람에게 하는 확인일 뿐이다.
  it('삭제 줄이 되돌릴 수 없음을 미리 말한다', () => {
    const warning = settingsLines()
      .filter((l) => l.groupId === SETTINGS_ACTION.deleteCharacter)
      .map((l) => l.text)
      .join(' ')
    expect(warning).toContain('되돌릴 수 없습니다')
  })

  // 왜: 삭제와 로그아웃이 나란히 있는 화면에서 "지금 누구인가"를 모르면,
  //     계정을 두 개 쓰는 사람이 지우려던 것과 다른 캐릭터를 지운다.
  it('지금 누구로 놀고 있는지 함께 보여준다', () => {
    const player = { ...emptyPlayer(), name: '항구사람' }
    const tab = TABS.find((t) => t.id === 'settings')!
    const text = tab.buildLines(loadGameData(), player).map((l) => l.text).join(' ')
    expect(text).toContain('항구사람')
  })
})
