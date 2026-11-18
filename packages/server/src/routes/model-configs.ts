import type { ModelConfig } from "@easycode/schema"
import { REASONING_EFFORTS } from "@easycode/schema"
import {
  ApiResponse,
  ModelConfigListResponse,
  ModelConfigResponse,
  ModelConfigUpdateRequest,
} from "@easycode/protocol"
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { z } from "zod"

import { BusinessError } from "../errors.js"
import { success } from "../response.js"

import type { RouteContext } from "./shared.js"

const ConfigParams = z.object({
  configID: z.string().trim().min(1),
})

const NullData = z.null()
const MAX_MODEL_CONFIG_BODY_BYTES = 2 * 1024 * 1024

export interface ModelConfigRoutesOptions extends RouteContext {}

export const modelConfigRoutes: FastifyPluginAsyncZod<ModelConfigRoutesOptions> =
  async (app, options) => {
    const { core } = options

    app.get(
      "/",
      {
        schema: {
          response: { 200: ApiResponse(ModelConfigListResponse) },
        },
      },
      async () => {
        const configs = await core.modelConfigs.list()
        return success({
          availableReasoningEfforts: [...REASONING_EFFORTS],
          configs: configs.map(summary),
        })
      },
    )

    app.get(
      "/:configID",
      {
        schema: {
          params: ConfigParams,
          response: { 200: ApiResponse(ModelConfigResponse) },
        },
      },
      async (request) => {
        try {
          return success(view(await core.modelConfigs.require(request.params.configID)))
        } catch (error) {
          throw businessFailure(error)
        }
      },
    )

    app.post(
      "/",
      {
        bodyLimit: MAX_MODEL_CONFIG_BODY_BYTES,
        schema: {
          body: ModelConfigUpdateRequest,
          response: { 200: ApiResponse(ModelConfigResponse) },
        },
      },
      async (request) => {
        try {
          return success(view(await core.modelConfigs.create(toMutation(request.body))))
        } catch (error) {
          throw businessFailure(error)
        }
      },
    )

    app.put(
      "/:configID",
      {
        bodyLimit: MAX_MODEL_CONFIG_BODY_BYTES,
        schema: {
          params: ConfigParams,
          body: ModelConfigUpdateRequest,
          response: { 200: ApiResponse(ModelConfigResponse) },
        },
      },
      async (request) => {
        try {
          const config = await core.modelConfigs.update(
            request.params.configID,
            toMutation(request.body),
          )
          return success(view(config))
        } catch (error) {
          throw businessFailure(error)
        }
      },
    )

    app.delete(
      "/:configID",
      {
        schema: {
          params: ConfigParams,
          response: { 200: ApiResponse(NullData) },
        },
      },
      async (request) => {
        try {
          await core.modelConfigs.delete(request.params.configID)
          return success(null)
        } catch (error) {
          throw businessFailure(error)
        }
      },
    )
  }

const summary = (config: ModelConfig) => ({
  id: config.id,
  revision: config.revision,
  name: config.name,
  model: config.model,
  contextWindow: config.contextWindow,
  maxOutputTokens: config.maxOutputTokens,
  supportedReasoningEfforts: config.supportedReasoningEfforts,
  hasApiKey: config.apiKey.length > 0,
  hasExtraHeaders: Object.keys(config.headers).length > 0,
  createdAt: config.createdAt,
  updatedAt: config.updatedAt,
})

const view = (config: ModelConfig) => ({
  ...summary(config),
  baseUrl: config.baseUrl,
  ...(config.temperature === undefined ? {} : { temperature: config.temperature }),
})

const toMutation = (input: ModelConfigUpdateRequest) => ({
  name: input.name,
  baseUrl: input.baseUrl,
  model: input.model,
  contextWindow: input.contextWindow,
  maxOutputTokens: input.maxOutputTokens,
  ...(input.temperature === null ? {} : input.temperature === undefined ? {} : { temperature: input.temperature }),
  supportedReasoningEfforts: input.supportedReasoningEfforts,
  apiKey:
    input.apiKey === undefined
      ? undefined
      : input.apiKey === null
        ? null
        : input.apiKey,
  headers:
    input.extraHeaders === undefined
      ? undefined
      : input.extraHeaders === null
        ? null
        : parseHeaders(input.extraHeaders),
})

const parseHeaders = (text: string): Record<string, string> => {
  const headers: Record<string, string> = {}
  for (const rawLine of text.split(/[;\n]/)) {
    const line = rawLine.trim()
    if (line.length === 0) continue
    const separator = line.indexOf(":")
    if (separator <= 0) throw new Error(`附加请求头格式不正确：${line}。请使用 Name: Value`)
    const name = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim()
    if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)) {
      throw new Error(`附加请求头名称不合法：${name}`)
    }
    headers[name] = value
  }
  return headers
}

const businessFailure = (error: unknown): BusinessError =>
  error instanceof BusinessError
    ? error
    : new BusinessError(error instanceof Error ? error.message : String(error))
