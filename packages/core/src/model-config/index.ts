import { randomUUID } from "node:crypto"
import { chmod, mkdir, readdir, unlink } from "node:fs/promises"
import { join } from "node:path"

import {
  ModelConfig,
  REASONING_EFFORTS,
  type ReasoningEffort,
} from "@easycode/schema"

import {
  ensureConfigFiles,
  readStoredRuntimeConfig,
  renderStoredRuntimeConfig,
  type StoredRuntimeConfig,
} from "../config.js"
import type { LLMClientConfig } from "../llm/types.js"
import type { Logger, LogLevel } from "../log.js"
import type { WebProviderID } from "../tool/builtin/web/types.js"
import { writeFileAtomic } from "../util/atomic.js"

export const MODEL_CONFIG_DIRECTORY = "config"
export const MODEL_CONFIG_REQUIRED_MESSAGE = "请选择模型配置。"
export const MODEL_CONFIG_MISSING_MESSAGE = "当前会话使用的模型配置已不存在，无法继续对话。"
export const REASONING_EFFORT_REQUIRED_MESSAGE = "请选择思考强度。"
export const REASONING_EFFORT_UNSUPPORTED_MESSAGE = "当前会话使用的思考强度不受模型配置支持。"

export interface ModelConfigMutation {
  configName: string
  baseUrl: string
  model: string
  contextWindow: number
  maxOutputTokens: number
  temperature?: number
  supportedReasoningEfforts: ReasoningEffort[]
  /** undefined 表示更新时保留旧值，null 表示清除。 */
  apiKey?: string | null
  /** undefined 表示更新时保留旧值，null 表示清除。 */
  headers?: Record<string, string> | null
  webSearchProvider: WebProviderID | ""
  webSearchApiKey?: string | null
  webFetchProvider: WebProviderID | ""
  webFetchApiKey?: string | null
  webTimeoutMs: number
  webMaxResponseBytes: number
  logLevel: LogLevel
}

export interface ModelConfigSeed {
  configName?: string
  baseUrl: string
  apiKey: string
  model: string
  contextWindow: number
  maxOutputTokens: number
  temperature?: number
  headers: Record<string, string>
  supportedReasoningEfforts?: ReasoningEffort[]
}

export interface ModelConfigRecord {
  config: ModelConfig
  runtime: StoredRuntimeConfig
}

export interface ModelConfigService {
  list(): Promise<ModelConfig[]>
  get(id: string): Promise<ModelConfig | undefined>
  getRecord(id: string): Promise<ModelConfigRecord | undefined>
  require(id: string): Promise<ModelConfig>
  requireRecord(id: string): Promise<ModelConfigRecord>
  first(): Promise<ModelConfig>
  create(input: ModelConfigMutation): Promise<ModelConfigRecord>
  update(id: string, input: ModelConfigMutation): Promise<ModelConfigRecord>
  delete(id: string): Promise<void>
}

export interface ModelConfigServiceDeps {
  dataDir: string
  seed: ModelConfigSeed
  logger?: Logger
}

/**
 * 文件型模型配置服务。
 *
 * `config/<ID>.toml` 是完整配置，结构延续旧 config.toml；ID 是文件名且不随
 * 模型名称变化。保存后直接读取新文件，无需重启。
 */
export const createModelConfigService = (deps: ModelConfigServiceDeps): ModelConfigService => {
  const directory = join(deps.dataDir, MODEL_CONFIG_DIRECTORY)
  let initialized: Promise<void> | undefined

  const ensureInitialized = (): Promise<void> => {
    initialized ??= initialize()
    return initialized
  }

  const initialize = async (): Promise<void> => {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await chmod(directory, 0o700)
    const firstFile = ensureConfigFiles(
      directory,
      join(deps.dataDir, "config.toml"),
      join(directory, "runtime.json"),
    )
    const stored = readStoredRuntimeConfig(firstFile)
    if (stored.model.length === 0 && deps.seed.model.length > 0) {
      await writeRuntime(idFromFile(firstFile), seedRuntime(deps.seed))
    }
  }

  const list = async (): Promise<ModelConfig[]> => {
    await ensureInitialized()
    return (await readAll())
      .map((record) => record.config)
      .sort((left, right) => {
        if (left.createdAt !== right.createdAt) return left.createdAt - right.createdAt
        return left.name.localeCompare(right.name, "zh-CN")
      })
  }

  const getRecord = async (id: string): Promise<ModelConfigRecord | undefined> => {
    if (!isSafeConfigID(id)) return undefined
    let stored: StoredRuntimeConfig
    try {
      stored = readStoredRuntimeConfig(fileFor(id))
    } catch (error) {
      if (isNotFound(error)) return undefined
      deps.logger?.warn("忽略结构无效的模型配置", { id, error })
      return undefined
    }
    try {
      const config = configFromStored(id, stored)
      return { config, runtime: stored }
    } catch (error) {
      deps.logger?.warn("忽略包含无效 reasoning level 的模型配置", { id, error })
      return undefined
    }
  }

  const get = async (id: string): Promise<ModelConfig | undefined> =>
    (await getRecord(id))?.config

  const require = async (id: string): Promise<ModelConfig> => {
    const config = await get(id)
    if (!config) throw new Error(MODEL_CONFIG_MISSING_MESSAGE)
    return config
  }

  const requireRecord = async (id: string): Promise<ModelConfigRecord> => {
    const record = await getRecord(id)
    if (!record) throw new Error(MODEL_CONFIG_MISSING_MESSAGE)
    return record
  }

  const first = async (): Promise<ModelConfig> => {
    const config = (await list())[0]
    if (!config) throw new Error("没有可用的模型配置，请先在设置中创建")
    return config
  }

  const create = async (input: ModelConfigMutation): Promise<ModelConfigRecord> => {
    await ensureInitialized()
    const now = Date.now()
    const id = randomUUID()
    const runtime = mutationRuntime(input, undefined, now)
    configFromStored(id, runtime)
    await writeRuntime(id, runtime)
    deps.logger?.info("已创建模型配置", { id, model: runtime.model })
    return requireRecord(id)
  }

  const update = async (id: string, input: ModelConfigMutation): Promise<ModelConfigRecord> => {
    const current = await requireRecord(id)
    const runtime = mutationRuntime(input, current.runtime, Date.now())
    configFromStored(id, runtime)
    await writeRuntime(id, runtime)
    deps.logger?.info("已更新模型配置", { id, revision: runtime.revision })
    return requireRecord(id)
  }

  const remove = async (id: string): Promise<void> => {
    if (!isSafeConfigID(id) || (await getRecord(id)) === undefined) {
      throw new Error(`模型配置不存在：${id}`)
    }
    await unlink(fileFor(id))
    deps.logger?.info("已删除模型配置", { id })
  }

  const readAll = async (): Promise<ModelConfigRecord[]> => {
    let names: string[]
    try {
      names = (await readdir(directory))
        .filter((name) => name.endsWith(".toml"))
        .sort((left, right) => left.localeCompare(right))
    } catch (error) {
      if (isNotFound(error)) return []
      throw error
    }
    return (
      await Promise.all(names.map((name) => getRecord(name.slice(0, -".toml".length))))
    ).filter((record): record is ModelConfigRecord => record !== undefined)
  }

  const writeRuntime = async (id: string, runtime: StoredRuntimeConfig): Promise<void> => {
    const file = fileFor(id)
    await writeFileAtomic(file, renderStoredRuntimeConfig(runtime), { mode: 0o600 })
    await chmod(file, 0o600)
  }

  const fileFor = (id: string): string => join(directory, `${id}.toml`)

  return {
    list,
    get,
    getRecord,
    require,
    requireRecord,
    first,
    create,
    update,
    delete: remove,
  }
}

export const toModelLLMClientConfig = (config: ModelConfig): LLMClientConfig => ({
  baseUrl: config.baseUrl,
  apiKey: config.apiKey,
  ...(Object.keys(config.headers).length === 0 ? {} : { headers: config.headers }),
})

const mutationRuntime = (
  input: ModelConfigMutation,
  current: StoredRuntimeConfig | undefined,
  now: number,
): StoredRuntimeConfig => ({
  baseUrl: input.baseUrl,
  apiKey: input.apiKey === undefined ? (current?.apiKey ?? "") : (input.apiKey ?? ""),
  model: input.model,
  contextWindow: input.contextWindow,
  maxOutputTokens: input.maxOutputTokens,
  ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
  headers: input.headers === undefined ? (current?.headers ?? {}) : (input.headers ?? {}),
  configName: input.configName,
  supportedReasoningEfforts: input.supportedReasoningEfforts,
  revision: (current?.revision ?? 0) + 1,
  createdAt: current?.createdAt ?? now,
  updatedAt: now,
  web: {
    timeoutMs: input.webTimeoutMs,
    maxResponseBytes: input.webMaxResponseBytes,
    search: {
      ...(input.webSearchProvider === "" ? {} : { provider: input.webSearchProvider }),
      apiKey:
        input.webSearchApiKey === undefined
          ? (current?.web.search.apiKey ?? "")
          : (input.webSearchApiKey ?? ""),
    },
    fetch: {
      ...(input.webFetchProvider === "" ? {} : { provider: input.webFetchProvider }),
      apiKey:
        input.webFetchApiKey === undefined
          ? (current?.web.fetch.apiKey ?? "")
          : (input.webFetchApiKey ?? ""),
    },
  },
  logLevel: input.logLevel,
})

const configFromStored = (id: string, stored: StoredRuntimeConfig): ModelConfig => {
  const supported = stored.supportedReasoningEfforts.filter(isReasoningEffort)
  if (supported.length !== stored.supportedReasoningEfforts.length) {
    throw new Error("模型配置包含未知 reasoning level")
  }
  return ModelConfig.parse({
    schemaVersion: 1,
    id,
    revision: stored.revision,
    name: stored.configName.trim() || stored.model,
    baseUrl: stored.baseUrl,
    model: stored.model,
    apiKey: stored.apiKey,
    headers: stored.headers,
    contextWindow: stored.contextWindow,
    maxOutputTokens: stored.maxOutputTokens,
    ...(stored.temperature === undefined ? {} : { temperature: stored.temperature }),
    supportedReasoningEfforts: supported,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
  })
}

const seedRuntime = (seed: ModelConfigSeed): StoredRuntimeConfig => ({
  baseUrl: seed.baseUrl,
  apiKey: seed.apiKey,
  model: seed.model,
  contextWindow: seed.contextWindow,
  maxOutputTokens: seed.maxOutputTokens,
  ...(seed.temperature === undefined ? {} : { temperature: seed.temperature }),
  headers: seed.headers,
  configName: seed.configName ?? seed.model,
  supportedReasoningEfforts: seed.supportedReasoningEfforts ?? [],
  revision: 1,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  web: {
    timeoutMs: 30_000,
    maxResponseBytes: 8 * 1024 * 1024,
    search: { apiKey: "" },
    fetch: { apiKey: "" },
  },
  logLevel: "info",
})

const idFromFile = (file: string): string =>
  file.replace(/\\/g, "/").split("/").at(-1)?.replace(/\.toml$/, "") ?? randomUUID()

const isReasoningEffort = (value: string): value is ReasoningEffort =>
  REASONING_EFFORTS.includes(value as ReasoningEffort)

const isSafeConfigID = (value: string): boolean =>
  /^[a-zA-Z0-9_-]+$/.test(value) && value.length <= 100

const isNotFound = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (("code" in error && error.code === "ENOENT") ||
    ("cause" in error &&
      typeof error.cause === "object" &&
      error.cause !== null &&
      "code" in error.cause &&
      error.cause.code === "ENOENT"))
