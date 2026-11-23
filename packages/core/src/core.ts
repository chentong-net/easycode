import { createAgentRegistry, type AgentRegistry } from "./agent.js"
import {
  createPromptProfileService,
  type PromptProfileService,
} from "./prompt/index.js"
import { EASYCODE_HOME_DIR, loadCoreConfig, type CoreConfig } from "./config.js"
import { createConfigurationService, type ConfigurationService } from "./configuration.js"
import { createEventHub, type EventHub } from "./events.js"
import {
  createImageServiceRegistry,
  type ImageServiceRegistry,
} from "./image/index.js"
import { createLogger, setLogLevel, type Logger } from "./log.js"
import {
  createModelConfigService,
  type ModelConfigService,
} from "./model-config/index.js"
import { createPermissionService, type PermissionService } from "./permission/service.js"
import { createQuestionService, type QuestionService } from "./question/service.js"
import { createRunner } from "./runner/index.js"
import { createSystemContextManager } from "./session/context.js"
import { createSessionManager, type SessionManager } from "./session/runtime.js"
import { createSessionStore, type SessionStore } from "./session/store.js"
import { createBuiltinTools } from "./tool/builtin/index.js"
import { createToolRegistry, type ToolRegistry } from "./tool/registry.js"
import { createWorkspaceManager, type WorkspaceManager } from "./workspace/manager.js"
import { randomUUID } from "node:crypto"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

/**
 * Core 的组装入口。
 *
 * 整个运行时的依赖图在这里一次性接好，外部（server / CLI / 未来的测试）只面对
 * 一个 `Core` 对象，不需要知道内部有哪些零件、谁依赖谁。
 * 这样做的直接好处是：想验证 Core 是否真的与 UI 无关，
 * 只要看这个文件有没有出现 HTTP 或 UI 相关的东西就够了。
 *
 * 装配顺序不是随意的：runner 需要会话管理器，而会话管理器又需要
 * runner 来实现「唤醒」——两者是双向的。这里用 `setRunDriver` 打破循环：
 * 先建好会话管理器，再建 runner，最后把它注册回去。
 */

/** 一个装配完成、可以直接使用的运行时。 */
export interface Core {
  config: CoreConfig
  store: SessionStore
  hub: EventHub
  agents: AgentRegistry
  promptProfiles: PromptProfileService
  modelConfigs: ModelConfigService
  configuration: ConfigurationService
  images: ImageServiceRegistry
  sessions: SessionManager
  workspaces: WorkspaceManager
  permissions: PermissionService
  questions: QuestionService
  tools: ToolRegistry
  logger: Logger
  /** 返回 Core 负责维护的默认 workspace 与状态目录。 */
  runtimeInfo(): RuntimeInfo
  /** 初始化 Core 的持久化目录。重复调用会复用同一次初始化。 */
  initialize(): Promise<void>
  /** 读取当前运行时状态。模型未配置时 Core 可以初始化，但不会 ready。 */
  status(): Promise<CoreStatus>
  /** 关闭运行时：中止所有运行中的回合，不再接受新的执行 */
  shutdown(): Promise<void>
}

export interface RuntimeInfo {
  /** 默认工作区的绝对路径。 */
  workspaceDirectory: string
  /** Core 内部状态目录的绝对路径。 */
  dataDir: string
}

export interface CoreStatus {
  initialized: boolean
  storageReady: boolean
  modelConfigured: boolean
  ready: boolean
}

export interface CreateCoreOptions {
  /**
   * 直接传入已加载好的配置。
   *
   * 桌面端与 CLI 都会提前加载配置（需要据此决定数据目录、日志文件位置），
   * 再传进来可以避免重复解析 TOML 配置与重复打印「配置加载完成」日志。
   */
  config?: CoreConfig
  logger?: Logger
}

export const createCore = (options: CreateCoreOptions = {}): Core => {
  const logger = options.logger ?? createLogger("core")
  const config = options.config ?? loadCoreConfig()
  setLogLevel(config.logLevel)
  let initialized = false
  let storageReady = false
  let initializePromise: Promise<void> | undefined
  let shutdownPromise: Promise<void> | undefined

  const agents = createAgentRegistry()
  const promptProfiles = createPromptProfileService({
    dataDir: config.dataDir,
    logger: logger.child("prompt"),
  })
  const modelConfigs = createModelConfigService({
    dataDir: config.dataDir,
    seed: {
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model,
      contextWindow: config.contextWindow,
      maxOutputTokens: config.maxOutputTokens,
      ...(config.temperature === undefined ? {} : { temperature: config.temperature }),
      headers: config.headers,
    },
    logger: logger.child("model-config"),
  })
  const configuration = createConfigurationService({ config })
  const images = createImageServiceRegistry({
    logger: logger.child("image"),
  })
  const store = createSessionStore(config)
  const hub = createEventHub(logger)
  const permissions = createPermissionService({ config, logger: logger.child("permission") })
  const questions = createQuestionService()
  const context = createSystemContextManager()
  const tools = createToolRegistry({
    tools: createBuiltinTools(),
    saveToolOutput: (content) => store.saveToolOutput(content),
    logger: logger.child("tool"),
  })

  const sessions = createSessionManager({
    config,
    store,
    hub,
    agents,
    promptProfiles,
    modelConfigs,
    logger: logger.child("session"),
  })
  const workspaces = createWorkspaceManager({
    dataDir: config.dataDir,
    defaultDirectory: EASYCODE_HOME_DIR,
    listSessions: () => sessions.list(),
    deleteSessionsByDirectory: async (directory) => {
      const matches = (await sessions.list()).filter((session) => session.directory === directory)
      for (const session of matches) await sessions.delete(session.id)
      return matches.length
    },
    logger: logger.child("workspace"),
  })

  const runner = createRunner({
    config,
    sessions,
    agents,
    tools,
    permissions,
    questions,
    modelConfigs,
    promptProfiles,
    context,
    hub,
    logger: logger.child("runner"),
  })

  // 双向依赖的收口点：会话管理器从此可以通过驱动唤醒回合
  sessions.setRunDriver(runner)

  const runtimeInfo = (): RuntimeInfo => ({
    workspaceDirectory: EASYCODE_HOME_DIR,
    dataDir: config.dataDir,
  })

  const initialize = (): Promise<void> => {
    initializePromise ??= initializeStorage().then(
      () => {
        initialized = true
        storageReady = true
        logger.info("Core 初始化完成", runtimeInfo())
      },
      (error: unknown) => {
        initializePromise = undefined
        initialized = false
        storageReady = false
        throw error
      },
    )
    return initializePromise
  }

  const initializeStorage = async (): Promise<void> => {
    await mkdir(config.dataDir, { recursive: true, mode: 0o700 })
    const probe = join(config.dataDir, `.ready-${randomUUID()}`)
    try {
      await writeFile(probe, "", { encoding: "utf8", mode: 0o600 })
    } finally {
      await rm(probe, { force: true }).catch(() => undefined)
    }
    await Promise.all([
      mkdir(join(config.dataDir, "sessions"), { recursive: true, mode: 0o700 }),
      mkdir(join(config.dataDir, "tool-output"), { recursive: true, mode: 0o700 }),
      modelConfigs.list(),
    ])
  }

  const status = async (): Promise<CoreStatus> => {
    let modelConfigured = false
    if (initialized && storageReady) {
      try {
        modelConfigured = (await modelConfigs.list()).length > 0
      } catch (error) {
        logger.warn("读取模型配置状态失败", { error })
      }
    }
    return {
      initialized,
      storageReady,
      modelConfigured,
      ready: initialized && storageReady && modelConfigured,
    }
  }

  const shutdown = (): Promise<void> => {
    shutdownPromise ??= (async () => {
      logger.info("正在关闭 Core")
      await sessions.shutdown()
      initialized = false
      storageReady = false
    })()
    return shutdownPromise
  }

  logger.info("Core 已装配", {
    model: config.model,
    dataDir: config.dataDir,
    workspaceDirectory: EASYCODE_HOME_DIR,
    baseToolCount: tools.definitions().length,
    agentCount: agents.all().length,
  })

  return {
    config,
    store,
    hub,
    agents,
    promptProfiles,
    modelConfigs,
    configuration,
    images,
    sessions,
    workspaces,
    permissions,
    questions,
    tools,
    logger,
    runtimeInfo,
    initialize,
    status,
    shutdown,
  }
}
