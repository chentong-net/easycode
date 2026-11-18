import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs"
import { randomUUID } from "node:crypto"
import { join, resolve } from "node:path"

import { parse, stringify } from "smol-toml"
import { z } from "zod"

import { ModelConfig } from "@easycode/schema"

import type { LLMClientConfig } from "./llm/types.js"
import { createLogger, setLogLevel, type LogLevel } from "./log.js"
import { WEB_PROVIDER_IDS, type CoreWebConfig, type WebProviderID } from "./tool/builtin/web/types.js"
import { expandHome } from "./util/path.js"

const logger = createLogger("config")

/** 用户可见的固定 EasyCode 根目录，不再允许通过环境变量修改。 */
export const EASYCODE_HOME_DIR = resolve(expandHome("~/easycode"))
/** 应用内部状态目录：会话、工具输出、日志与配置文件都在这里。 */
export const EASYCODE_STATE_DIR = join(EASYCODE_HOME_DIR, ".easycode")
/** 多份完整运行配置所在的目录。 */
export const EASYCODE_CONFIG_DIR = join(EASYCODE_STATE_DIR, "config")
/** 旧版 TOML 配置，只用于一次性迁移。 */
export const LEGACY_EASYCODE_CONFIG_FILE = join(EASYCODE_STATE_DIR, "config.toml")
/** 中间错误版本生成的 JSON 运行配置，只用于迁移。 */
const LEGACY_JSON_CONFIG_FILE = join(EASYCODE_CONFIG_DIR, "runtime.json")

export const DEFAULT_BASE_URL = "https://api.openai.com/v1"
export const DEFAULT_CONTEXT_WINDOW = 128_000
export const DEFAULT_MAX_OUTPUT_TOKENS = 8_192
export const DEFAULT_WEB_TIMEOUT_MS = 30_000
export const DEFAULT_WEB_MAX_RESPONSE_BYTES = 8 * 1024 * 1024

export interface StoredRuntimeConfig {
  baseUrl: string
  apiKey: string
  model: string
  contextWindow: number
  maxOutputTokens: number
  temperature?: number
  headers: Record<string, string>
  configName: string
  supportedReasoningEfforts: string[]
  revision: number
  createdAt: number
  updatedAt: number
  web: CoreWebConfig
  logLevel: LogLevel
}

/** Core 的完整运行配置。除进程通信参数外，不允许环境变量参与配置。 */
export interface CoreConfig extends StoredRuntimeConfig {
  /** 固定配置文件路径。 */
  configFile: string
  /** 固定内部状态目录。 */
  dataDir: string
  /** 是否已经具备发起模型请求所需的最小配置。 */
  modelConfigured: boolean
}

const Provider = z.enum(WEB_PROVIDER_IDS)

const WebCapabilityFile = z
  .object({
    provider: Provider.optional(),
    api_key: z.string().default(""),
  })
  .default({})

const ConfigFile = z
  .object({
    model: z
      .object({
        base_url: z.string().url().default(DEFAULT_BASE_URL),
        api_key: z.string().default(""),
        name: z.string().default(""),
        context_window: z.number().int().positive().default(DEFAULT_CONTEXT_WINDOW),
        max_output_tokens: z.number().int().positive().default(DEFAULT_MAX_OUTPUT_TOKENS),
        temperature: z.number().finite().optional(),
        headers: z.record(z.string(), z.string()).default({}),
        config_name: z.string().default(""),
        supported_reasoning_efforts: z.array(z.string()).default([]),
      })
      .default({}),
    web: z
      .object({
        timeout_ms: z.number().int().positive().max(120_000).default(DEFAULT_WEB_TIMEOUT_MS),
        max_response_bytes: z
          .number()
          .int()
          .positive()
          .max(32 * 1024 * 1024)
          .default(DEFAULT_WEB_MAX_RESPONSE_BYTES),
        search: WebCapabilityFile,
        fetch: WebCapabilityFile,
      })
      .default({}),
    runtime: z
      .object({
        log_level: z.enum(["debug", "info", "warn", "error"]).default("info"),
      })
      .default({}),
    meta: z
      .object({
        revision: z.number().int().positive().default(1),
        created_at: z.number().int().nonnegative().default(0),
        updated_at: z.number().int().nonnegative().default(0),
      })
      .default({}),
  })
  .default({})

type ConfigFile = z.infer<typeof ConfigFile>

/**
 * 加载 config 目录下排序后的首份 TOML。
 *
 * 旧版 config.toml 或中间 JSON 会在首次启动时迁移为 `<ID>.toml`，并重命名
 * 为可恢复备份。
 */
export const loadCoreConfig = (): CoreConfig => {
  const configFile = ensureConfigFiles()
  const stored = readStoredRuntimeConfig(configFile)
  setLogLevel(stored.logLevel)

  const config: CoreConfig = {
    ...stored,
    configFile,
    dataDir: EASYCODE_STATE_DIR,
    modelConfigured: stored.model.length > 0,
  }

  logger.info("配置加载完成", {
    configFile: config.configFile,
    dataDir: config.dataDir,
    baseUrl: config.baseUrl,
    model: config.model,
    modelConfigured: config.modelConfigured,
    contextWindow: config.contextWindow,
    maxOutputTokens: config.maxOutputTokens,
    hasTemperature: config.temperature !== undefined,
    extraHeaderCount: Object.keys(config.headers).length,
    logLevel: config.logLevel,
    webSearchEnabled: webCapabilityEnabled(config.web.search),
    webFetchEnabled: webCapabilityEnabled(config.web.fetch),
  })

  return config
}

export const readStoredRuntimeConfig = (file: string): StoredRuntimeConfig => {
  let raw: unknown
  try {
    raw = parse(readFileSync(file, "utf8"))
  } catch (error) {
    throw new Error(`无法解析配置文件：${file}`, { cause: error })
  }

  const parsed = ConfigFile.safeParse(raw)
  if (!parsed.success) {
    throw new Error(`配置文件结构不符合预期：${file}\n${parsed.error.message}`)
  }
  return fromConfigFile(parsed.data)
}

export const renderStoredRuntimeConfig = (config: StoredRuntimeConfig): string => {
  const model: Record<string, unknown> = {
    base_url: config.baseUrl,
    api_key: config.apiKey,
    name: config.model,
    context_window: config.contextWindow,
    max_output_tokens: config.maxOutputTokens,
    config_name: config.configName,
    supported_reasoning_efforts: config.supportedReasoningEfforts,
  }
  if (config.temperature !== undefined) model.temperature = config.temperature
  if (Object.keys(config.headers).length > 0) model.headers = config.headers

  const web: Record<string, unknown> = {
    timeout_ms: config.web.timeoutMs,
    max_response_bytes: config.web.maxResponseBytes,
  }
  const search = capabilityToFile(config.web.search)
  const fetch = capabilityToFile(config.web.fetch)
  if (search !== undefined) web.search = search
  if (fetch !== undefined) web.fetch = fetch

  const content = stringify({
    model,
    web,
    runtime: { log_level: config.logLevel },
    meta: {
      revision: config.revision,
      created_at: config.createdAt,
      updated_at: config.updatedAt,
    },
  })

  return [
    "# EasyCode 模型配置",
    "# 每份 TOML 是独立完整配置；API Key 仅保存在本机。",
    "",
    content.trimEnd(),
    "",
  ].join("\n")
}

/** 从配置中取出 LLM 客户端需要的连接信息。 */
export const toLLMClientConfig = (config: CoreConfig): LLMClientConfig => ({
  baseUrl: config.baseUrl,
  apiKey: config.apiKey,
  ...(Object.keys(config.headers).length > 0 ? { headers: config.headers } : {}),
})

/** 判断内部状态目录是否已经存在。 */
export const dataDirExists = (config: CoreConfig): boolean => existsSync(config.dataDir)

export const ensureConfigFiles = (
  configDirectory = EASYCODE_CONFIG_DIR,
  legacyToml = LEGACY_EASYCODE_CONFIG_FILE,
  legacyJson = LEGACY_JSON_CONFIG_FILE,
): string => {
  mkdirSync(configDirectory, { recursive: true })
  const existing = tomlFiles(configDirectory)
  if (existing.length > 0) {
    const selected = join(configDirectory, existing[0] as string)
    chmodSync(selected, 0o600)
    return selected
  }

  let base = defaultStoredConfig()
  if (existsSync(legacyJson)) {
    base = readJsonStoredRuntimeConfig(legacyJson)
  } else if (existsSync(legacyToml)) {
    base = readLegacyStoredRuntimeConfig(legacyToml)
  }
  const legacyModels = readLegacyJsonModels(configDirectory)
  if (legacyModels.length === 0) {
    writeTomlFile(
      configDirectory,
      randomUUID(),
      base,
    )
  } else {
    for (const model of legacyModels) {
      writeTomlFile(configDirectory, model.id, {
        ...base,
        baseUrl: model.baseUrl,
        apiKey: model.apiKey,
        model: model.model,
        contextWindow: model.contextWindow,
        maxOutputTokens: model.maxOutputTokens,
        ...(model.temperature === undefined ? {} : { temperature: model.temperature }),
        headers: model.headers,
        configName: model.name,
        supportedReasoningEfforts: model.supportedReasoningEfforts,
        revision: model.revision,
        createdAt: model.createdAt,
        updatedAt: model.updatedAt,
      })
    }
  }

  const backupSuffix = `.migrated-${Date.now()}.bak`
  for (const legacy of [legacyJson, legacyToml]) {
    if (!existsSync(legacy)) continue
    try {
      renameSync(legacy, `${legacy}${backupSuffix}`)
    } catch (error) {
      logger.warn("旧配置已迁移，但无法重命名备份", { legacy, error })
    }
  }
  for (const name of legacyJsonModelFiles(configDirectory)) {
    const file = join(configDirectory, name)
    try {
      renameSync(file, `${file}${backupSuffix}`)
    } catch (error) {
      logger.warn("旧模型配置已迁移，但无法重命名备份", { file, error })
    }
  }
  const selected = join(configDirectory, tomlFiles(configDirectory)[0] as string)
  logger.info("已迁移模型配置为 TOML", { configFile: selected, count: tomlFiles(configDirectory).length })
  return selected
}

const readLegacyStoredRuntimeConfig = (file: string): StoredRuntimeConfig => {
  let raw: unknown
  try {
    raw = parse(readFileSync(file, "utf8"))
  } catch (error) {
    throw new Error(`无法解析旧版配置文件：${file}`, { cause: error })
  }
  const parsed = ConfigFile.safeParse(raw)
  if (!parsed.success) {
    throw new Error(`旧版配置文件结构不符合预期：${file}\n${parsed.error.message}`)
  }
  return fromConfigFile(parsed.data)
}

const readJsonStoredRuntimeConfig = (file: string): StoredRuntimeConfig => {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(file, "utf8"))
  } catch (error) {
    throw new Error(`无法解析旧版 JSON 运行配置：${file}`, { cause: error })
  }
  const parsed = ConfigFile.safeParse(raw)
  if (!parsed.success) {
    throw new Error(`旧版 JSON 运行配置结构不符合预期：${file}\n${parsed.error.message}`)
  }
  return fromConfigFile(parsed.data)
}

const tomlFiles = (directory: string): string[] =>
  readdirSync(directory)
    .filter((name) => name.endsWith(".toml"))
    .sort((left, right) => left.localeCompare(right))

const legacyJsonModelFiles = (directory: string): string[] =>
  readdirSync(directory)
    .filter((name) => name.endsWith(".json") && name !== "runtime.json")
    .sort((left, right) => left.localeCompare(right))

const readLegacyJsonModels = (directory: string): ModelConfig[] => {
  const models: ModelConfig[] = []
  for (const name of legacyJsonModelFiles(directory)) {
    try {
      const value: unknown = JSON.parse(readFileSync(join(directory, name), "utf8"))
      const parsed = ModelConfig.safeParse(value)
      if (parsed.success) models.push(parsed.data)
    } catch {
      // 无效的中间版本 JSON 不会阻止 TOML 迁移。
    }
  }
  return models
}

const writeTomlFile = (
  directory: string,
  id: string,
  stored: StoredRuntimeConfig,
): void => {
  const file = join(directory, `${id}.toml`)
  writeFileSync(file, renderStoredRuntimeConfig(stored), { encoding: "utf8", mode: 0o600 })
  chmodSync(file, 0o600)
}

const defaultStoredConfig = (): StoredRuntimeConfig => ({
  baseUrl: DEFAULT_BASE_URL,
  apiKey: "",
  model: "",
  contextWindow: DEFAULT_CONTEXT_WINDOW,
  maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
  headers: {},
  configName: "",
  supportedReasoningEfforts: [],
  revision: 1,
  createdAt: 0,
  updatedAt: 0,
  web: {
    timeoutMs: DEFAULT_WEB_TIMEOUT_MS,
    maxResponseBytes: DEFAULT_WEB_MAX_RESPONSE_BYTES,
    search: { apiKey: "" },
    fetch: { apiKey: "" },
  },
  logLevel: "info",
})

const fromConfigFile = (config: ConfigFile): StoredRuntimeConfig => ({
  baseUrl: config.model.base_url,
  apiKey: config.model.api_key,
  model: config.model.name,
  contextWindow: config.model.context_window,
  maxOutputTokens: config.model.max_output_tokens,
  ...(config.model.temperature === undefined ? {} : { temperature: config.model.temperature }),
  headers: config.model.headers,
  configName: config.model.config_name,
  supportedReasoningEfforts: config.model.supported_reasoning_efforts,
  revision: config.meta.revision,
  createdAt: config.meta.created_at,
  updatedAt: config.meta.updated_at,
  web: {
    timeoutMs: config.web.timeout_ms,
    maxResponseBytes: config.web.max_response_bytes,
    search: {
      ...(config.web.search.provider === undefined ? {} : { provider: config.web.search.provider }),
      apiKey: config.web.search.api_key,
    },
    fetch: {
      ...(config.web.fetch.provider === undefined ? {} : { provider: config.web.fetch.provider }),
      apiKey: config.web.fetch.api_key,
    },
  },
  logLevel: config.runtime.log_level,
})

const capabilityToFile = (
  capability: CoreWebConfig["search"],
): { provider?: WebProviderID; api_key: string } | undefined => {
  if (capability.provider === undefined && capability.apiKey.length === 0) return undefined
  return {
    ...(capability.provider === undefined ? {} : { provider: capability.provider }),
    api_key: capability.apiKey,
  }
}

const webCapabilityEnabled = (capability: CoreWebConfig["search"]): boolean =>
  capability.provider !== undefined && capability.apiKey.length > 0
