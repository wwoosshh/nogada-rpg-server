import { cpSync, createReadStream, existsSync, statSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, type Connect, type Plugin, type ViteDevServer } from 'vite'

/** 빌드가 .tmx 에서 만들어 내는 맵 JSON 이 놓이는 곳. 저장소에는 없는 생성물이다. */
const generatedMaps = fileURLToPath(
  new URL('../../packages/data/src/generated/maps', import.meta.url),
)
const distMaps = fileURLToPath(new URL('./dist/maps', import.meta.url))

/**
 * 맵 JSON 을 실행 중에 내려준다.
 *
 * **왜 `publicDir` 가 아닌가:** vite 의 publicDir 는 하나뿐이라, 생성 맵 폴더를
 * 거기로 지정하면 지금 쓰는 `public/`(타일셋·스프라이트·글꼴)을 통째로 잃는다.
 *
 * **왜 dev 에서 복사가 아니라 서빙인가:** 맵 JSON 은 빌드 생성물이라 저장소에
 * 없다. dev 에 복사 단계를 두면 맵을 고칠 때마다 그 단계를 다시 돌려야 하고,
 * 그 한 단계를 빠뜨리는 것이 정확히 .tmx→.json 수동 Export 에서 없애려던
 * 실패다. 프로덕션 빌드는 정적 파일만 남으므로 그때만 dist 로 복사한다.
 */
function serveGeneratedMaps(): Plugin {
  const handler: Connect.NextHandleFunction = (req, res, next) => {
    // 맵 id 가 한글이라 요청 URL 은 %-인코딩되어 온다 — 되돌리지 않으면
    // 파일 이름과 맞지 않아 그냥 404 가 된다.
    const name = decodeURIComponent((req.url ?? '').split('?')[0] ?? '').replace(/^\/+/, '')
    const file = resolve(generatedMaps, name)
    // 폴더 밖을 가리키는 요청(../)은 넘기지 않는다. dev 서버는 저장소 안에서
    // 돌므로 이 한 줄이 없으면 소스 전체가 읽힌다.
    if (!name || !file.startsWith(generatedMaps + sep)) return next()
    if (!existsSync(file) || !statSync(file).isFile()) return next()

    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    createReadStream(file).pipe(res)
  }

  return {
    name: 'serve-generated-maps',
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/maps', handler)
    },
    closeBundle() {
      // 빌드 생성물이라 없을 수 있다. 그대로 cpSync 에 맡기면 ENOENT 만 나와서
      // "무엇을 먼저 돌려야 하는가"를 말해 주지 않는다.
      if (!existsSync(generatedMaps)) {
        throw new Error(`맵 JSON 이 없다: ${generatedMaps} — 먼저 pnpm data:build 를 돌린다`)
      }
      cpSync(generatedMaps, distMaps, { recursive: true })
    },
  }
}

export default defineConfig({
  plugins: [react(), serveGeneratedMaps()],
  // Capacitor 는 file:// 로 로드하므로 상대 경로가 필요하다 (Task 6)
  base: './',
  build: { outDir: 'dist' },
  server: { host: true, port: 5173 },
})
