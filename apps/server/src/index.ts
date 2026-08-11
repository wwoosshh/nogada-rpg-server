import { buildApp } from './app.js'

const port = Number(process.env.PORT ?? 3000)

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

  await app.listen({ port, host: '0.0.0.0' })
  console.log(`server listening on http://localhost:${port}`)
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
