/**
 * mulberry32 — 시드 기반 결정적 PRNG.
 *
 * 난수 시드는 서버가 독점한다. 클라이언트는 이 함수를 호출하지 않으며,
 * 테스트와 밸런스 시뮬레이터만이 결정적 재현을 위해 직접 시드를 넣는다.
 */
export function createRng(seed: number): () => number {
  let a = seed >>> 0
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** min 이상 max 이하의 정수. 양 끝을 포함한다. */
export function rollInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1))
}
