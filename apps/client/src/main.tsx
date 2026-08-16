import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './ui/App.js'
import { OrientationNotice } from './ui/OrientationNotice.js'
import './styles/global.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root 를 찾을 수 없다')

/**
 * 글꼴이 도착한 뒤에 그리기 시작한다.
 *
 * Phaser 는 글자를 별도 캔버스에 그려 텍스처로 굽고 그 뒤로는 다시 그리지 않는다.
 * 폰트가 아직 없는 상태에서 씬이 시작되면 대체 글꼴로 구워진 텍스처가 그대로 남아
 * 새로고침하기 전까지 다른 글꼴로 보인다.
 *
 * 실패해도 진행한다 — 글꼴 하나 때문에 게임이 아예 안 열리는 편이 더 나쁘다.
 * 그 경우 tokens.css 의 대체 글꼴로 떨어진다.
 */
async function waitForFont(): Promise<void> {
  if (!('fonts' in document)) return
  try {
    // 한글을 함께 넘긴다. 라틴만 확인하고 넘어가면 첫 프레임의 한글이 대체 글꼴로 굳는다.
    await document.fonts.load('16px "NeoDunggeunmo Pro"', '가나다ABC0123')
  } catch (err) {
    console.error(err)
  }
}

void waitForFont().then(() => {
  createRoot(root).render(
    <StrictMode>
      <App />
      {/*
        세로로 든 화면을 덮는 안내. App 밖에 두는 이유는 둘이다: App.tsx 가
        불가침 파일이고, 이 안내가 게임의 어느 국면에도 속하지 않는다(연결 전에도
        플레이 중에도 똑같이 뜬다). 보일지 말지는 전적으로 ui.css 의 미디어
        쿼리가 정하므로 여기서는 조건 없이 늘 그린다 — 세로가 아니면
        `display: none` 이라 자리를 한 픽셀도 안 먹는다.

        **App 뒤에 둔다.** 위치 지정된 형제끼리는 DOM 순서로도 겨루므로, 앞에
        두면 z-index 를 고쳐 쓰는 날 App 의 패널들에 덮인다.
      */}
      <OrientationNotice />
    </StrictMode>,
  )
})
