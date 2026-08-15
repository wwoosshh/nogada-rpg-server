import { buildApp } from './app.js'
import { parseListen } from './config.js'

async function main(): Promise<void> {
  const app = await buildApp()

  // SIGTERM 에 저장소를 드레인한다. close() 가 onClose 훅을 부르고, 그 안에서
  // 풀이 닫힌다 — 컨테이너가 멈출 때 쓰다 만 연결을 남기지 않는다.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      app.close().then(
        () => process.exit(0),
        (err: unknown) => {
          console.error(err)
          process.exit(1)
        },
      )
    })
  }

  // 어느 문에 설지는 환경이 정한다(config.ts 의 parseListen) — 터널 뒤에서는
  // 127.0.0.1 만 열고, 그 밖에서는 지금까지처럼 0.0.0.0 이다.
  const { host, port } = parseListen(process.env.HOST, process.env.PORT)
  await app.listen({ port, host })
  // 주소는 사람이 두드릴 수 있는 것을 적는다. 0.0.0.0 은 "듣는 대역"이지
  // 붙는 주소가 아니라, 그대로 찍으면 브라우저에 붙여 넣었을 때 안 열린다.
  console.log(`server listening on http://localhost:${port} (host=${host})`)
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
