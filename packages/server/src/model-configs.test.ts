import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"

import { createCore, type CoreConfig, type Logger } from "@easycode/core"
import { REASONING_EFFORTS } from "@easycode/schema"

import { createApplication } from "./app.js"

const token = "test-token"
const jsonHeaders = {
  "x-easycode-token": token,
  "content-type": "application/json",
}
const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => logger,
}

let directory: string
let core: ReturnType<typeof createCore>
let application: Awaited<ReturnType<typeof createApplication>>

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "easycode-model-api-test-"))
  core = createCore({ config: testConfig(), logger })
  application = await createApplication({ core, token, logger })
})

after(async () => {
  await application.app.close()
  await core.shutdown()
  await rm(directory, { recursive: true, force: true })
})

test("模型配置接口迁移默认项并返回后端 level 来源", async () => {
  const response = await application.app.inject({
    method: "GET",
    url: "/api/model-configs",
    headers: { "x-easycode-token": token },
  })
  assert.equal(response.statusCode, 200)
  const data = response.json().data as {
    availableReasoningEfforts: string[]
    configs: Array<{ id: string; supportedReasoningEfforts: string[] }>
  }
  assert.deepEqual(data.availableReasoningEfforts, [...REASONING_EFFORTS])
  assert.equal(data.configs.length, 1)
  assert.deepEqual(data.configs[0]?.supportedReasoningEfforts, [])
})

test("模型配置可创建、热更新并隐藏密钥", async () => {
  const createdResponse = await application.app.inject({
    method: "POST",
    url: "/api/model-configs",
    headers: jsonHeaders,
    payload: {
      name: "高推理模型",
      baseUrl: "https://example.com/v1",
      model: "reasoning-model",
      contextWindow: 64_000,
      maxOutputTokens: 4_096,
      supportedReasoningEfforts: ["none", "low", "high"],
      apiKey: "secret",
      extraHeaders: "x-test: yes",
    },
  })
  assert.equal(createdResponse.statusCode, 200)
  const created = createdResponse.json().data as {
    id: string
    revision: number
    hasApiKey: boolean
    hasExtraHeaders: boolean
    apiKey?: string
  }
  assert.equal(created.hasApiKey, true)
  assert.equal(created.hasExtraHeaders, true)
  assert.equal("apiKey" in created, false)

  const updatedResponse = await application.app.inject({
    method: "PUT",
    url: `/api/model-configs/${created.id}`,
    headers: jsonHeaders,
    payload: {
      name: "高推理模型",
      baseUrl: "https://example.com/v1",
      model: "reasoning-model",
      contextWindow: 128_000,
      maxOutputTokens: 8_192,
      supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
      apiKey: null,
      extraHeaders: null,
    },
  })
  assert.equal(updatedResponse.statusCode, 200)
  const updated = updatedResponse.json().data as {
    revision: number
    hasApiKey: boolean
    hasExtraHeaders: boolean
    supportedReasoningEfforts: string[]
  }
  assert.equal(updated.revision, 2)
  assert.equal(updated.hasApiKey, false)
  assert.equal(updated.hasExtraHeaders, false)
  assert.deepEqual(updated.supportedReasoningEfforts, ["low", "medium", "high", "xhigh"])

  const deleted = await application.app.inject({
    method: "DELETE",
    url: `/api/model-configs/${created.id}`,
    headers: { "x-easycode-token": token },
  })
  assert.equal(deleted.statusCode, 200)
})

test("旧会话可补齐并重新选择思考强度", async () => {
  const modelResponse = await application.app.inject({
    method: "POST",
    url: "/api/model-configs",
    headers: jsonHeaders,
    payload: {
      name: "分级模型",
      baseUrl: "https://example.com/v1",
      model: "reasoning-model",
      contextWindow: 64_000,
      maxOutputTokens: 4_096,
      supportedReasoningEfforts: ["none", "low", "high"],
      apiKey: "secret",
    },
  })
  assert.equal(modelResponse.statusCode, 200)
  const modelConfigID = (modelResponse.json().data as { id: string }).id

  const sessionResponse = await application.app.inject({
    method: "POST",
    url: "/api/sessions",
    headers: jsonHeaders,
    payload: {
      directory,
      modelConfigID,
      compactionProfileID: "coding",
    },
  })
  assert.equal(sessionResponse.statusCode, 200)
  const session = sessionResponse.json().data as { id: string; reasoningEffort?: string }
  assert.equal(session.reasoningEffort, undefined)

  const configuredResponse = await application.app.inject({
    method: "PUT",
    url: `/api/sessions/${session.id}/configuration`,
    headers: jsonHeaders,
    payload: { reasoningEffort: "high" },
  })
  assert.equal(configuredResponse.statusCode, 200)
  assert.equal(configuredResponse.json().data.reasoningEffort, "high")

  const changedResponse = await application.app.inject({
    method: "PUT",
    url: `/api/sessions/${session.id}/configuration`,
    headers: jsonHeaders,
    payload: { reasoningEffort: "low" },
  })
  assert.equal(changedResponse.statusCode, 200)
  assert.equal(changedResponse.json().data.reasoningEffort, "low")
})

const testConfig = (): CoreConfig => ({
  baseUrl: "https://seed.example.com/v1",
  apiKey: "seed-key",
  model: "seed-model",
  contextWindow: 32_000,
  maxOutputTokens: 2_048,
  headers: {},
  web: {
    timeoutMs: 30_000,
    maxResponseBytes: 1024,
    search: { apiKey: "" },
    fetch: { apiKey: "" },
  },
  logLevel: "error",
  configFile: join(directory, "config.toml"),
  dataDir: join(directory, "data"),
  modelConfigured: true,
})
