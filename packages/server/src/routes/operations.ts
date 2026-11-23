import {
  LivenessResponse,
  ReadinessResponse,
} from "@easycode/protocol"
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"

import type { RouteContext } from "./shared.js"

export interface OperationsRoutesOptions extends RouteContext {}

/**
 * 容器与进程管理器使用的最小运维接口。
 *
 * 这里故意不返回模型、路径或错误详情：存活只表示进程能响应 HTTP，
 * 就绪只表示 Core 已经完成存储初始化并具备模型配置。
 */
export const operationsRoutes: FastifyPluginAsyncZod<OperationsRoutesOptions> = async (
  app,
  options,
) => {
  app.get(
    "/healthz",
    {
      schema: {
        response: { 200: LivenessResponse },
      },
    },
    async () => ({ status: "ok" as const }),
  )

  app.get(
    "/readyz",
    {
      schema: {
        response: {
          200: ReadinessResponse,
          503: ReadinessResponse,
        },
      },
    },
    async (_request, reply) => {
      const status = await options.core.status()
      const body = {
        status: status.ready ? "ready" as const : "not_ready" as const,
        checks: {
          storage: status.storageReady,
          model: status.modelConfigured,
        },
      }
      return reply.status(status.ready ? 200 : 503).send(body)
    },
  )
}
