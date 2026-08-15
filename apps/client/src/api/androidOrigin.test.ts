import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import capacitorConfig from '../../capacitor.config.js'

/**
 * **APK 가 서버에 보내는 Origin 은 무엇인가.**
 *
 * 이 물음의 답이 저장소 여섯 곳에 `capacitor://localhost` 라고 **틀리게** 적혀
 * 있었다. 실제는 `https://localhost` 다 — 그리고 실서버의 CORS 목록은 정확히
 * 뒤집혀 있어서, 앱은 아무도 안 쓰는 오리진이 열린 채로 자기 오리진에서 막혔다.
 * 그 증상을 쫓으면 트러블슈팅 표가 다시 틀린 답을 가리켰다.
 *
 * 왜 이것이 테스트일 값어치가 있는가: 이 사실이 다시 틀려지는 길은 문서를 잘못
 * 고치는 것이 아니라 **`capacitor.config.ts` 에 한 줄을 더하는 것**이다.
 * `androidScheme: 'http'` 한 줄이면 앱의 오리진이 `http://localhost` 로 바뀌고,
 * 그 순간 서버의 `CORS_ORIGIN` 과 문서 여섯 곳이 조용히 다시 틀린다. 증상은
 * "앱에서만 안 붙는다"인데 거절하는 것이 WebView 라 **서버 로그에는 아무것도
 * 안 남는다.** 사람이 알아채는 자리가 없으므로 자를 여기 댄다.
 */

/**
 * Capacitor 가 스킴도 호스트도 안 정했을 때 쓰는 값. 셋 다 실측이다:
 * `@capacitor/cli` 의 declarations.d.ts 가 `androidScheme` 기본값을 `https`,
 * `iosScheme` 기본값을 `capacitor` 로 적고, 안드로이드 네이티브의 CapConfig.java
 * 도 `androidScheme = CAPACITOR_HTTPS_SCHEME` · `hostname = "localhost"` 로
 * 시작한다. 즉 아래 오리진은 **아무것도 안 적었을 때** 나오는 것이다.
 */
const 안드로이드_기본_오리진 = 'https://localhost'

describe('안드로이드 WebView 의 오리진', () => {
  it('capacitor.config.ts 가 스킴도 호스트도 안 건드린다 — 그래서 https://localhost 다', () => {
    // `server` 절 자체가 없는 것이 지금 모습이다. 없는 것과 비어 있는 것을 같이
    // 재는 이유: 나중에 다른 이유로 `server: {}` 가 생겨도 오리진은 그대로다.
    expect(capacitorConfig.server?.androidScheme).toBeUndefined()
    expect(capacitorConfig.server?.hostname).toBeUndefined()
    // `url` 은 라이브 리로드용이라 배포에 실리면 안 되는 것이기도 하지만, 실리면
    // 오리진이 통째로 그 주소가 되어 이 파일이 재는 값이 뜻을 잃는다.
    expect(capacitorConfig.server?.url).toBeUndefined()
  })

  it('서버 `.env` 예시가 그 오리진을 허용한다 — 이 둘이 갈라지면 앱만 조용히 막힌다', () => {
    // 사슬의 반대쪽 끝이다. 위 검사는 "앱이 무엇을 보내는가"를 재고, 이 검사는
    // "서버에 무엇을 적으라고 시키는가"를 잰다. 둘이 어긋난 것이 이 태스크가
    // 존재하는 이유이므로, 한쪽만 재는 것으로는 같은 일이 다시 일어난다.
    const example = readFileSync(
      fileURLToPath(new URL('../../../server/.env.example', import.meta.url)),
      'utf8',
    )
    const 목록 = example
      .split(/\r?\n/)
      .find((line) => line.trimStart().startsWith('CORS_ORIGIN='))
    expect(목록, 'CORS_ORIGIN 줄 자체가 없다').toBeDefined()
    expect(목록).toContain(안드로이드_기본_오리진)
    // 값 칸에 iOS 스킴이 남아 있으면 안 된다 — 그 한 줄이 라벨을 다시 틀리게
    // 만든 자리다(주석에서 "그건 iOS 것"이라고 설명하는 것은 그대로 둔다).
    expect(목록).not.toContain('capacitor://')
  })
})
