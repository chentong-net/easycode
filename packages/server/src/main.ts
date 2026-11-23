import { createCore } from "@easycode/core"

import { listen, type RunningServer } from "./index.js"

/**
 * 独立 Server 进程入口。
 *
 * 本轮仍使用 Core 写死的默认路径和 listen 的默认回环地址、随机端口。
 * 该入口只负责 Core 生命周期和进程退出，不读取部署配置。
 */
const main = async (): Promise<void> => {
  const core = createCore()
  let server: RunningServer | undefined
  let stopping = false
  let requestStop: (signal: string) => void = () => undefined
  const stopRequested = new Promise<string>((resolve) => {
    requestStop = resolve
  })

  const stop = (signal: string): void => {
    if (stopping) return
    stopping = true
    core.logger.info("收到退出信号", { signal })
    requestStop(signal)
  }

  const onSigint = (): void => stop("SIGINT")
  const onSigterm = (): void => stop("SIGTERM")
  process.once("SIGINT", onSigint)
  process.once("SIGTERM", onSigterm)

  try {
    await core.initialize()
    server = await listen({
      core,
      logger: core.logger,
    })
    core.logger.info("独立 Server 正在运行", {
      url: server.url,
      workspaceDirectory: core.runtimeInfo().workspaceDirectory,
      dataDir: core.runtimeInfo().dataDir,
    })
    await stopRequested
  } finally {
    process.off("SIGINT", onSigint)
    process.off("SIGTERM", onSigterm)
    try {
      await server?.close()
    } finally {
      await core.shutdown()
    }
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  process.stderr.write(`[server] 启动失败：${message}\n`)
  process.exitCode = 1
})
