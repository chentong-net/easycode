import type { Core } from "@easycode/core"
import { createLogger, type Logger } from "@easycode/core"

import { createApplication } from "./app.js"

/**
 * 本地 HTTP 服务。
 *
 * 它是 Core 与界面之间唯一的通道，因此承担三件事：
 * 1. 默认只监听回环地址；调用方可以显式覆盖 `host`
 * 2. 配置 token 时进行鉴权；空 token 仅用于本地调试
 * 3. 端口默认由系统分配（port: 0），避免固定端口在用户机器上被占用而启动失败
 *
 * 这里不实现 TLS。CLI 与桌面端使用默认回环地址；如果调用方显式覆盖 host，
 * 需要自行保证网络边界与传输安全。
 */

export interface ListenOptions {
  core: Core
  /** 监听端口。0 表示由系统分配一个空闲端口，这是桌面端的默认策略。 */
  port?: number
  /** 监听地址，默认 127.0.0.1；调用方可以显式覆盖 */
  host?: string
  /**
   * 访问令牌。桌面端会生成一个随机值并注入渲染进程；
   * 传空字符串表示不校验，仅用于本地 CLI 调试。
   */
  token?: string
  logger?: Logger
}

export interface RunningServer {
  /** 完整的基础地址，例如 http://127.0.0.1:53421 */
  url: string
  port: number
  token?: string
  /** 实际监听的地址 */
  host: string
  close(): Promise<void>
}

export const listen = async (options: ListenOptions): Promise<RunningServer> => {
  const logger = options.logger ?? createLogger("server")
  const host = options.host ?? "127.0.0.1"
  const port = options.port ?? 0

  const application = await createApplication({
    core: options.core,
    ...(options.token === undefined ? {} : { token: options.token }),
    logger,
  })

  await application.app.listen({ port, host })

  const address = application.app.server.address()
  if (address === null || typeof address === "string") {
    await application.app.close()
    throw new Error("服务启动失败：无法确定监听端口")
  }

  const url = `http://${host}:${address.port}`
  logger.info("HTTP 服务已启动", { url, authEnabled: options.token !== undefined && options.token.length > 0 })
  logger.debug("已注册路由", { routes: application.routes() })

  return {
    url,
    port: address.port,
    host,
    ...(options.token === undefined ? {} : { token: options.token }),
    close: async () => {
      await application.app.close()
      logger.info("HTTP 服务已关闭")
    },
  }
}

export { createApplication } from "./app.js"
export * from "./sse.js"
