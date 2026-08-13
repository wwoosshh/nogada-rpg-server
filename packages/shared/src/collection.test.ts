import { describe, expect, it } from 'vitest'
import {
  COLLECTION_MAX_GRADE,
  collectionGrade,
  collectionScore,
  type CollectionTable,
  type CollectionThresholds,
} from './collection.js'

const thresholds = (itemId: string, steps: [number, number, number, number]): CollectionThresholds => ({
  itemId,
  steps,
})

const ORE = thresholds('copper_ore', [50, 130, 430, 1300])

describe('collectionGrade', () => {
  it('한 개도 안 바친 칸은 0 등급이다 — 잠긴 칸도 화면에 보이므로(§6-앞 3) 0 은 "없음"이 아니라 "아직"이다', () => {
    expect(collectionGrade(0, ORE)).toBe(0)
  })

  it('문턱에 **닿으면** 오른다 — 딱 맞춘 개수가 등급을 못 올리면 화면의 "50/50" 이 거짓말이 된다', () => {
    expect(collectionGrade(49, ORE)).toBe(0)
    expect(collectionGrade(50, ORE)).toBe(1)
    expect(collectionGrade(130, ORE)).toBe(2)
    expect(collectionGrade(430, ORE)).toBe(3)
    expect(collectionGrade(1300, ORE)).toBe(COLLECTION_MAX_GRADE)
  })

  it('마지막 문턱을 아무리 넘겨도 4 에서 멈춘다 — 총점 100 만점(25칸 × 4)이 상한을 가진 수라야 이정표가 비율을 말할 수 있다', () => {
    expect(collectionGrade(1_000_000, ORE)).toBe(COLLECTION_MAX_GRADE)
  })

  it('문턱 사이의 개수는 넘긴 문턱 수만큼이다 — 등급은 "몇 단을 넘었나"이지 순위가 아니다', () => {
    expect(collectionGrade(129, ORE)).toBe(1)
    expect(collectionGrade(429, ORE)).toBe(2)
    expect(collectionGrade(1299, ORE)).toBe(3)
  })
})

describe('collectionScore', () => {
  const table: CollectionTable = {
    copper_ore: ORE,
    iron_ore: thresholds('iron_ore', [1, 180, 600, 1800]),
  }

  it('빈 사람의 총점은 0 이다', () => {
    expect(collectionScore({}, table)).toBe(0)
  })

  it('칸마다의 등급을 더한다 — 총점은 "칸 몇 개를 얼마나 채웠나" 하나의 수다', () => {
    expect(collectionScore({ copper_ore: 130, iron_ore: 1 }, table)).toBe(3)
  })

  it('만점은 칸 수 × 4 다 — 25칸이면 100 이고, 이정표가 그 수를 비율로 읽는다(§6-앞 8)', () => {
    expect(collectionScore({ copper_ore: 1300, iron_ore: 1800 }, table)).toBe(
      Object.keys(table).length * COLLECTION_MAX_GRADE,
    )
  })

  it('칸이 아닌 아이템을 바친 기록은 총점에 안 들어간다 — 표를 돌지 세이브를 돌지 않는다', () => {
    // 세이브의 키는 사람이 손으로 고칠 수도 있는 문자열이다. 표에 없는 키가
    // 점수를 만들면 만점이 100 이 아니게 되고, 그 순간 이정표의 비율이 깨진다.
    expect(collectionScore({ copper_ore: 1300, mithril_pickaxe: 999 }, table)).toBe(COLLECTION_MAX_GRADE)
  })

  it('상속 키(constructor 등)를 바친 것으로 세지 않는다 — 세이브에서 온 문자열로 표를 읽는 경로를 만들지 않는다', () => {
    // gatherHand.holdsToken 이 카탈로그를 돌고 스택을 조회하는 것과 같은 이유다.
    const donated = Object.create({ copper_ore: 1300 }) as Record<string, number>
    expect(collectionScore(donated, table)).toBe(0)
  })
})
