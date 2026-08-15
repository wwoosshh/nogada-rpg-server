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
  //
  // **이 두 줄에는 자동 검사가 없다.** parseListen 은 단위로 재지만 이 파일은
  // 아무도 import 하지 않는다(import 하는 순간 main 이 돈다). 즉 여기에 다시
  // `host: '0.0.0.0'` 을 박아 넣어도 관문 셋은 전부 초록이고, 터널 뒤의 3000 이
  // LAN·Tailscale 에 조용히 다시 열린다. 이 줄을 건드리는 사람은 손으로 확인해라:
  //   HOST=127.0.0.1 로 띄우고 → netstat -ano | findstr :3000 이 127.0.0.1 만
  //   보이는지, 그리고 LAN 주소로 보낸 요청이 거절되는지.
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
