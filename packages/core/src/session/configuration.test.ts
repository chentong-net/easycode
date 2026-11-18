import assert from "node:assert/strict"
import { test } from "node:test"

import { CompactionProfile, ModelConfig, type Session } from "@easycode/schema"
import { zeroUsage } from "@easycode/schema"

import type { CompactionProfileService } from "../compaction-profile/index.js"
import type { ModelConfigService } from "../model-config/index.js"
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

const compactionProfile = CompactionProfile.parse({
  schemaVersion: 1,
  id: "coding",
  revision: 1,
  builtIn: true,
  name: "Coding",
  agentSystemPrompt: "测试",
  systemPrompt: "压缩",
  includeTaskState: false,
  instructions: {
    initial: "初始",
    chunk: "分块",
    merge: "合并",
    correction: "纠正",
  },
  sectionTitles: {
    previousSummary: "已有摘要",
    taskState: "任务",
    transcript: "对话",
    instruction: "要求",
  },
  format: { type: "headings", headings: ["结果"] },
  createdAt: 0,
  updatedAt: 0,
})

const services = {
  modelConfigs: {
    get: async (id: string) => (id === modelConfig.id ? modelConfig : undefined),
  } as ModelConfigService,
  compactionProfiles: {
    get: async (id: string) =>
      id === compactionProfile.id ? compactionProfile : undefined,
  } as CompactionProfileService,
}

test("会话完整配置返回模型、压缩配置和思考强度", async () => {
  const result = await resolveSessionConfiguration(session({ reasoningEffort: "high" }), services)
  assert.equal(result.modelConfig.model, "test-model")
  assert.equal(result.compactionProfile.id, "coding")
  assert.equal(result.reasoningEffort, "high")
})

test("缺失运行配置返回请选择错误", async () => {
  await assert.rejects(
    resolveSessionConfiguration(session({ modelConfigID: undefined }), services),
    /请选择模型配置/,
  )
  await assert.rejects(
    resolveSessionConfiguration(session({ compactionProfileID: undefined }), services),
    /请选择压缩配置/,
  )
  await assert.rejects(
    resolveSessionConfiguration(session({ reasoningEffort: undefined }), services),
    /请选择思考强度/,
  )
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
  compactionProfileID: "coding",
  reasoningEffort: "low",
  model: "test-model",
  createdAt: 1,
  updatedAt: 1,
  usage: zeroUsage(),
  todos: [],
  ...override,
})
