import { randomUUID } from "node:crypto"
import { chmod, mkdir, readFile, readdir, unlink } from "node:fs/promises"
import { join } from "node:path"

import {
  ModelConfig,
  type ReasoningEffort,
} from "@easycode/schema"

import type { LLMClientConfig } from "../llm/types.js"
import type { Logger } from "../log.js"
import { writeFileAtomic } from "../util/atomic.js"

export const MODEL_CONFIG_DIRECTORY = "config"
export const MODEL_CONFIG_MISSING_MESSAGE = "当前会话使用的模型配置已不存在，无法继续对话。"

export interface ModelConfigMutation {
  name: string
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
}

export interface ModelConfigSeed {
  baseUrl: string
  apiKey: string
  model: string
  contextWindow: number
  maxOutputTokens: number
  temperature?: number
  headers: Record<string, string>
}

export interface ModelConfigService {
  list(): Promise<ModelConfig[]>
  get(id: string): Promise<ModelConfig | undefined>
  require(id: string): Promise<ModelConfig>
  /** 新会话未指定模型时使用的第一项。 */
  first(): Promise<ModelConfig>
  create(input: ModelConfigMutation): Promise<ModelConfig>
  update(id: string, input: ModelConfigMutation): Promise<ModelConfig>
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
 * 首次使用时从现有 config.toml 的模型字段迁移一份配置。之后每次读取都直接
 * 访问当前文件，因此设置页保存后无需重启即可生效。
 */
export const createModelConfigService = (deps: ModelConfigServiceDeps): ModelConfigService => {
  const directory = join(deps.dataDir, MODEL_CONFIG_DIRECTORY)
  let initialized: Promise<void> | undefined

  const ensureInitialized = (): Promise<void> => {
    initialized ??= initialize()
    return initialized
  }

  const initialize = async (): Promise<void> => {
    await ensureDirectory()
    const existing = await readAll()
    if (existing.length > 0) return

    const now = Date.now()
    const config = ModelConfig.parse({
      schemaVersion: 1,
      id: randomUUID(),
      revision: 1,
      name: deps.seed.model.trim() || "默认模型",
      baseUrl: deps.seed.baseUrl,
      model: deps.seed.model,
      apiKey: deps.seed.apiKey,
      headers: deps.seed.headers,
      contextWindow: deps.seed.contextWindow,
      maxOutputTokens: deps.seed.maxOutputTokens,
      ...(deps.seed.temperature === undefined ? {} : { temperature: deps.seed.temperature }),
      supportedReasoningEfforts: [],
      createdAt: now,
      updatedAt: now,
    })
    await writeProfile(config)
    deps.logger?.info("已从运行配置迁移模型配置", { id: config.id, model: config.model })
  }

  const ensureDirectory = async (): Promise<void> => {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await chmod(directory, 0o700)
  }

  const fileFor = (id: string): string => join(directory, `${id}.json`)

  const readCustom = async (id: string): Promise<ModelConfig | undefined> => {
    if (!isSafeConfigID(id)) return undefined
    let raw: string
    try {
      raw = await readFile(fileFor(id), "utf8")
    } catch (error) {
      if (isNotFound(error)) return undefined
      throw error
    }

    try {
      const parsed = ModelConfig.safeParse(JSON.parse(raw))
      if (!parsed.success) {
        deps.logger?.warn("忽略结构无效的模型配置", { id, error: parsed.error.message })
        return undefined
      }
      if (parsed.data.id !== id) {
        deps.logger?.warn("忽略标识与文件名不一致的模型配置", { id })
        return undefined
      }
      return parsed.data
    } catch (error) {
      deps.logger?.warn("忽略无法解析的模型配置", { id, error })
      return undefined
    }
  }

  const readAll = async (): Promise<ModelConfig[]> => {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      if (isNotFound(error)) return []
      throw error
    }
    return (
      await Promise.all(
        entries
          .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
          .map((entry) => readCustom(entry.name.slice(0, -".json".length))),
      )
    ).filter((config): config is ModelConfig => config !== undefined)
  }

  const list = async (): Promise<ModelConfig[]> => {
    await ensureInitialized()
    return (await readAll()).sort((left, right) => {
      if (left.createdAt !== right.createdAt) return left.createdAt - right.createdAt
      return left.name.localeCompare(right.name, "zh-CN")
    })
  }

  const get = async (id: string): Promise<ModelConfig | undefined> => {
    return readCustom(id)
  }

  const require = async (id: string): Promise<ModelConfig> => {
    const config = await get(id)
    if (!config) throw new Error(MODEL_CONFIG_MISSING_MESSAGE)
    return config
  }

  const first = async (): Promise<ModelConfig> => {
    const config = (await list())[0]
    if (!config) throw new Error("没有可用的模型配置，请先在设置中创建")
    return config
  }

  const create = async (input: ModelConfigMutation): Promise<ModelConfig> => {
    await ensureInitialized()
    const now = Date.now()
    const config = ModelConfig.parse({
      schemaVersion: 1,
      id: randomUUID(),
      revision: 1,
      name: input.name,
      baseUrl: input.baseUrl,
      model: input.model,
      apiKey: input.apiKey ?? "",
      headers: input.headers ?? {},
      contextWindow: input.contextWindow,
      maxOutputTokens: input.maxOutputTokens,
      ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
      supportedReasoningEfforts: input.supportedReasoningEfforts,
      createdAt: now,
      updatedAt: now,
    })
    await writeProfile(config)
    deps.logger?.info("已创建模型配置", { id: config.id, model: config.model })
    return config
  }

  const update = async (id: string, input: ModelConfigMutation): Promise<ModelConfig> => {
    const current = await readCustom(id)
    if (!current) throw new Error(`模型配置不存在：${id}`)
    const config = ModelConfig.parse({
      schemaVersion: 1,
      id: current.id,
      revision: current.revision + 1,
      name: input.name,
      baseUrl: input.baseUrl,
      model: input.model,
      apiKey: input.apiKey === undefined ? current.apiKey : (input.apiKey ?? ""),
      headers: input.headers === undefined ? current.headers : (input.headers ?? {}),
      contextWindow: input.contextWindow,
      maxOutputTokens: input.maxOutputTokens,
      ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
      supportedReasoningEfforts: input.supportedReasoningEfforts,
      createdAt: current.createdAt,
      updatedAt: Date.now(),
    })
    await writeProfile(config)
    deps.logger?.info("已更新模型配置", { id: config.id, revision: config.revision })
    return config
  }

  const remove = async (id: string): Promise<void> => {
    if (!isSafeConfigID(id) || (await readCustom(id)) === undefined) {
      throw new Error(`模型配置不存在：${id}`)
    }
    await unlink(fileFor(id))
    deps.logger?.info("已删除模型配置", { id })
  }

  const writeProfile = async (config: ModelConfig): Promise<void> => {
    await ensureDirectory()
    const file = fileFor(config.id)
    await writeFileAtomic(file, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
    await chmod(file, 0o600)
  }

  return { list, get, require, first, create, update, delete: remove }
}

export const toModelLLMClientConfig = (config: ModelConfig): LLMClientConfig => ({
  baseUrl: config.baseUrl,
  apiKey: config.apiKey,
  ...(Object.keys(config.headers).length === 0 ? {} : { headers: config.headers }),
})

const isSafeConfigID = (value: string): boolean =>
  /^[a-zA-Z0-9_-]+$/.test(value) && value.length <= 100

const isNotFound = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
