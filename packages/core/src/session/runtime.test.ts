import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"

import { createAgentRegistry } from "../agent.js"
import {
  COMPACTION_PROFILE_MISSING_MESSAGE,
  createCompactionProfileService,
} from "../compaction-profile/index.js"
import type { CoreConfig } from "../config.js"
import { createEventHub } from "../events.js"
import type { Logger } from "../log.js"
import { createModelConfigService } from "../model-config/index.js"
import { createSessionManager } from "./runtime.js"
import { createSessionStore } from "./store.js"

const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => logger,
}

let directory: string

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "easycode-session-runtime-test-"))
})

after(async () => {
  await rm(directory, { recursive: true, force: true })
})

test("会话持久化压缩配置，配置删除后拒绝继续对话", async () => {
  const config = testConfig()
  const store = createSessionStore(config)
  const compactionProfiles = createCompactionProfileService({
    dataDir: config.dataDir,
    logger,
  })
  const modelConfigs = createModelConfigService({
    dataDir: config.dataDir,
    seed: {
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model,
      contextWindow: config.contextWindow,
      maxOutputTokens: config.maxOutputTokens,
      headers: config.headers,
    },
    logger,
  })
  const sessions = createSessionManager({
    config,
    store,
    hub: createEventHub(logger),
    agents: createAgentRegistry(),
    compactionProfiles,
    modelConfigs,
    logger,
  })
  const custom = await compactionProfiles.create({
    name: "聊天",
    agentSystemPrompt: "你是一个聊天助手。",
    systemPrompt: "整理聊天记忆。",
    includeTaskState: false,
    instructions: {
      initial: "整理",
      chunk: "分块整理",
      merge: "合并",
      correction: "重新整理",
    },
    sectionTitles: {
      previousSummary: "已有聊天记忆",
      taskState: "当前任务状态",
      transcript: "待压缩聊天",
      instruction: "整理要求",
    },
    format: {
      type: "headings",
      headings: ["重要事实", "未完成话题"],
    },
  })

  const session = await sessions.create({
    directory,
    compactionProfileID: custom.id,
  })
  assert.equal(session.compactionProfileID, custom.id)
  assert.equal((await sessions.get(session.id))?.compactionProfileID, custom.id)

  await compactionProfiles.delete(custom.id)
  await assert.rejects(
    sessions.prompt(session.id, { text: "继续聊" }),
    (error: unknown) =>
      error instanceof Error && error.message === COMPACTION_PROFILE_MISSING_MESSAGE,
  )
})

test("未指定时新会话使用内置 coding", async () => {
  const config = testConfig("default")
  const compactionProfiles = createCompactionProfileService({
    dataDir: config.dataDir,
    logger,
  })
  const modelConfigs = createModelConfigService({
    dataDir: config.dataDir,
    seed: {
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model,
      contextWindow: config.contextWindow,
      maxOutputTokens: config.maxOutputTokens,
      headers: config.headers,
    },
    logger,
  })
  const sessions = createSessionManager({
    config,
    store: createSessionStore(config),
    hub: createEventHub(logger),
    agents: createAgentRegistry(),
    compactionProfiles,
    modelConfigs,
    logger,
  })

  const session = await sessions.create({ directory })
  assert.equal(session.compactionProfileID, "coding")
})

test("旧式缺失思考强度会提示选择，并且可以重新选择更新", async () => {
  const config = testConfig("levels")
  const compactionProfiles = createCompactionProfileService({
    dataDir: config.dataDir,
    logger,
  })
  const modelConfigs = createModelConfigService({
    dataDir: config.dataDir,
    seed: {
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model,
      contextWindow: config.contextWindow,
      maxOutputTokens: config.maxOutputTokens,
      headers: config.headers,
    },
    logger,
  })
  const levelsRecord = await modelConfigs.create({
    configName: "分级模型",
    baseUrl: config.baseUrl,
    model: "level-model",
    contextWindow: 32_000,
    maxOutputTokens: 2_048,
    supportedReasoningEfforts: ["none", "low", "high"],
    apiKey: config.apiKey,
    headers: {},
    webSearchProvider: "",
    webSearchApiKey: "",
    webFetchProvider: "",
    webFetchApiKey: "",
    webTimeoutMs: 30_000,
    webMaxResponseBytes: 1024,
    logLevel: "info",
  })
  const levels = levelsRecord.config
  const sessions = createSessionManager({
    config,
    store: createSessionStore(config),
    hub: createEventHub(logger),
    agents: createAgentRegistry(),
    compactionProfiles,
    modelConfigs,
    logger,
  })

  const session = await sessions.create({
    directory,
    modelConfigID: levels.id,
  })
  assert.equal(session.reasoningEffort, undefined)
  await assert.rejects(
    sessions.prompt(session.id, { text: "继续" }),
    (error: unknown) => error instanceof Error && error.message === "请选择思考强度。",
  )

  const configured = await sessions.configure(session.id, { reasoningEffort: "high" })
  assert.equal(configured.reasoningEffort, "high")
  assert.equal((await sessions.get(session.id))?.reasoningEffort, "high")
  const changed = await sessions.configure(session.id, { reasoningEffort: "low" })
  assert.equal(changed.reasoningEffort, "low")
  assert.equal((await sessions.get(session.id))?.reasoningEffort, "low")

  const replacementRecord = await modelConfigs.create({
    configName: "替换模型",
    baseUrl: config.baseUrl,
    model: "replacement-model",
    contextWindow: 16_000,
    maxOutputTokens: 1_024,
    supportedReasoningEfforts: [],
    apiKey: config.apiKey,
    headers: {},
    webSearchProvider: "",
    webSearchApiKey: "",
    webFetchProvider: "",
    webFetchApiKey: "",
    webTimeoutMs: 30_000,
    webMaxResponseBytes: 1024,
    logLevel: "info",
  })
  const replacement = replacementRecord.config
  await modelConfigs.delete(levels.id)
  const reselected = await sessions.configure(session.id, {
    modelConfigID: replacement.id,
    reasoningEffort: null,
  })
  assert.equal(reselected.modelConfigID, replacement.id)
  assert.equal(reselected.reasoningEffort, undefined)
  assert.equal(reselected.model, "replacement-model")
})

const testConfig = (suffix = "custom"): CoreConfig => ({
  baseUrl: "https://example.com/v1",
  apiKey: "test",
  model: "test-model",
  contextWindow: 128_000,
  maxOutputTokens: 8_192,
  headers: {},
  configName: "测试配置",
  supportedReasoningEfforts: [],
  revision: 1,
  createdAt: 1,
  updatedAt: 1,
  web: {
    timeoutMs: 30_000,
    maxResponseBytes: 1024,
    search: { apiKey: "" },
    fetch: { apiKey: "" },
  },
  logLevel: "error",
  configFile: join(directory, `${suffix}.toml`),
  dataDir: join(directory, suffix),
  modelConfigured: true,
})
