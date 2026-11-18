import cors from "@fastify/cors"
import type { Core, Logger } from "@easycode/core"
import {
  ApiEnvelope,
  ApiErrorCode,
  AUTH_HEADER,
} from "@easycode/protocol"
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyRequest,
} from "fastify"
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod"

import { BusinessError, HttpError } from "./errors.js"
import { failure } from "./response.js"
import { compactionProfileRoutes } from "./routes/compaction-profiles.js"
import { configRoutes } from "./routes/config.js"
import { imageRoutes } from "./routes/images.js"
import { modelConfigRoutes } from "./routes/model-configs.js"
import { sessionRoutes } from "./routes/sessions.js"
import { systemRoutes } from "./routes/system.js"
import { workspaceRoutes } from "./routes/workspaces.js"

export interface CreateApplicationOptions {
  core: Core
  token?: string
  logger: Logger
}

export interface EasyCodeApplication {
  app: FastifyInstance
  routes(): string
}

/**
 * 创建 Fastify 应用。
 *
 * 路由、鉴权、Schema 校验和错误信封在这里统一装配；业务 Handler 只调用 Core
 * 并返回 data。SSE 端点在 Handler 内接管原始响应，但事件帧仍保持标准格式。
 */
export const createApplication = async (
  options: CreateApplicationOptions,
): Promise<EasyCodeApplication> => {
  const app = Fastify({
    logger: false,
    bodyLimit: 1024 * 1024,
    requestTimeout: 0,
    exposeHeadRoutes: false,
    forceCloseConnections: true,
  }).withTypeProvider<ZodTypeProvider>()

  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  await app.register(cors, {
    origin: "*",
    allowedHeaders: ["content-type", AUTH_HEADER],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  })

  app.addHook("onRequest", async (request) => {
    if (request.method === "OPTIONS") return
    if (!isAuthorized(options.token, request)) {
      throw new HttpError(401, "缺少或错误的访问令牌")
    }
  })

  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("cache-control", "no-store")
    return payload
  })

  app.setNotFoundHandler(async (request, reply) => {
    options.logger.warn("HTTP 路由不存在", {
      requestID: request.id,
      method: request.method,
      url: request.url,
    })
    return reply
      .status(404)
      .send(failure(`未知接口：${request.method} ${request.url}`))
  })

  app.setErrorHandler(async (error: FastifyError | Error, request, reply) => {
    const status = statusForError(error)
    const message = messageForError(error, status)

    if (status >= 500) {
      options.logger.error("HTTP 请求处理失败", {
        requestID: request.id,
        method: request.method,
        url: request.url,
        error,
      })
    } else if (status === 200) {
      options.logger.warn("业务请求失败", {
        requestID: request.id,
        method: request.method,
        url: request.url,
        message,
      })
    } else {
      options.logger.warn("HTTP 请求被拒绝", {
        requestID: request.id,
        method: request.method,
        url: request.url,
        status,
        message,
      })
    }

    return reply.status(status).send(
      failure(
        message,
        error instanceof BusinessError
          ? error.code
          : ApiErrorCode.generic,
      ),
    )
  })

  const routeContext = { core: options.core, logger: options.logger }
  await app.register(systemRoutes, { prefix: "/api", ...routeContext })
  await app.register(modelConfigRoutes, { prefix: "/api/model-configs", ...routeContext })
  await app.register(compactionProfileRoutes, {
    prefix: "/api/compaction-profiles",
    ...routeContext,
  })
  await app.register(configRoutes, { prefix: "/api/config", ...routeContext })
  await app.register(imageRoutes, { prefix: "/api/images", ...routeContext })
  await app.register(workspaceRoutes, { prefix: "/api/workspaces", ...routeContext })
  await app.register(sessionRoutes, { prefix: "/api/sessions", ...routeContext })

  return {
    app,
    routes: () => app.printRoutes({ commonPrefix: false }).trim(),
  }
}

const isAuthorized = (
  expected: string | undefined,
  request: FastifyRequest,
): boolean => {
  if (expected === undefined || expected.length === 0) return true
  return request.headers[AUTH_HEADER] === expected
}

const statusForError = (error: FastifyError | Error): number => {
  if (error instanceof BusinessError) return 200
  if (isValidationError(error)) return 200
  if (error instanceof HttpError) return error.statusCode

  const statusCode = "statusCode" in error ? error.statusCode : undefined
  return typeof statusCode === "number" ? statusCode : 500
}

const messageForError = (error: FastifyError | Error, status: number): string => {
  if (status >= 500 && !(error instanceof HttpError)) {
    return "服务端内部错误"
  }
  return error.message
}

const isValidationError = (error: FastifyError | Error): boolean =>
  "validation" in error && Array.isArray(error.validation)

/** 供路由定义复用的成功响应 Schema。 */
export const responseEnvelope = ApiEnvelope
