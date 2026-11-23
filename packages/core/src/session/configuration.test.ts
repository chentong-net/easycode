import assert from "node:assert/strict"
import { test } from "node:test"

import { PromptProfile, ModelConfig, type Session } from "@easycode/schema"
import { zeroUsage } from "@easycode/schema"

import type { PromptProfileService } from "../prompt/index.js"
import type { ModelConfigService } from "../model-config/index.js"
import type { StoredRuntimeConfig } from "../config.js"
import { resolveSessionConfiguration } from "./configuration.js"

const modelConfig = ModelConfig.parse({
  schemaVersion: 1,
  id: "model",
  revision: 1,
  name: "分级模型",
  baseUrl: "https://example.com/v1",
  model: "test-model",
  apiKey: "test",
  headers: {},
  contextWindow: 32_000,
  maxOutputTokens: 2_048,
  supportedReasoningEfforts: ["none", "low", "high"],
  createdAt: 1,
  updatedAt: 1,
})

const promptProfile = PromptProfile.parse({
  id: "coding",
  name: "Coding",
  systemPrompt: "测试",
  compactionSystemPrompt: "压缩",
  compactionHeadings: ["结果"],
  createdAt: 0,
  updatedAt: 0,
})

const modelRuntime: StoredRuntimeConfig = {
  baseUrl: modelConfig.baseUrl,
  apiKey: modelConfig.apiKey,
  model: modelConfig.model,
  contextWindow: modelConfig.contextWindow,
  maxOutputTokens: modelConfig.maxOutputTokens,
  headers: modelConfig.headers,
  configName: modelConfig.name,
  supportedReasoningEfforts: modelConfig.supportedReasoningEfforts,
  revision: modelConfig.revision,
  createdAt: modelConfig.createdAt,
  updatedAt: modelConfig.updatedAt,
  web: {
    timeoutMs: 30_000,
    maxResponseBytes: 1024,
    search: { provider: "deepseek", apiKey: "search-key" },
    fetch: { provider: "deepseek", apiKey: "fetch-key" },
  },
  logLevel: "info",
}

const services = {
  modelConfigs: {
    get: async (id: string) => (id === modelConfig.id ? modelConfig : undefined),
    getRecord: async (id: string) =>
      id === modelConfig.id
        ? { config: modelConfig, runtime: modelRuntime, configFile: "/tmp/model.toml" }
        : undefined,
  } as ModelConfigService,
  promptProfiles: {
    get: async (id: string) =>
      id === promptProfile.id ? promptProfile : undefined,
  } as PromptProfileService,
}

test("会话完整配置返回模型、提示配置和思考强度", async () => {
  const result = await resolveSessionConfiguration(session({ reasoningEffort: "high" }), services)
  assert.equal(result.modelConfig.model, "test-model")
  assert.equal(result.modelConfigRuntime.web.search.provider, "deepseek")
  assert.equal(result.promptProfile.id, "coding")
  assert.equal(result.reasoningEffort, "high")
})

test("缺失运行配置返回请选择错误", async () => {
  await assert.rejects(
    resolveSessionConfiguration(session({ modelConfigID: undefined }), services),
    /请选择模型配置/,
  )
  await assert.rejects(
    resolveSessionConfiguration(session({ promptProfileID: undefined }), services),
    /请选择提示配置/,
  )
})

test("配置了思考强度但未选择时使用模型默认行为", async () => {
  const result = await resolveSessionConfiguration(
    session({ reasoningEffort: undefined }),
    services,
  )
  assert.equal(result.reasoningEffort, undefined)
})

test("不支持的思考强度被拒绝", async () => {
  await assert.rejects(
    resolveSessionConfiguration(session({ reasoningEffort: "xhigh" }), services),
    /不受模型配置支持/,
  )
})

const session = (override: Partial<Session>): Session => ({
  id: "session",
  title: "测试",
  directory: "/tmp",
  agent: "build",
  modelConfigID: "model",
  promptProfileID: "coding",
  reasoningEffort: "low",
  model: "test-model",
  createdAt: 1,
  updatedAt: 1,
  usage: zeroUsage(),
  todos: [],
  ...override,
})
