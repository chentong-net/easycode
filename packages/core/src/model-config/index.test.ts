import assert from "node:assert/strict"
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"

import type { Logger } from "../log.js"
import {
  createModelConfigService,
  type ModelConfigMutation,
} from "./index.js"

const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => logger,
}

let directory: string

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "easycode-model-config-test-"))
})

after(async () => {
  await rm(directory, { recursive: true, force: true })
})

test("首次使用创建 ID.toml，完整内容包括 API Key 且不发送默认 reasoning_effort", async () => {
  const service = createModelConfigService({
    dataDir: directory,
    seed: seedConfig(),
    logger,
  })

  const configs = await service.list()
  assert.equal(configs.length, 1)
  assert.equal(configs[0]?.model, "seed-model")
  assert.deepEqual(configs[0]?.supportedReasoningEfforts, [])
  const files = await readdir(join(directory, "config"))
  assert.equal(files.filter((name) => name.endsWith(".toml")).length, 1)
  assert.equal(files.includes("runtime.json"), false)
  const raw = await readFile(join(directory, "config", files[0] as string), "utf8")
  assert.match(raw, /api_key = "seed-key"/)
})

test("TOML 模型配置支持创建、更新、保留或清除密钥以及删除", async () => {
  const service = createModelConfigService({
    dataDir: directory,
    seed: seedConfig(),
    logger,
  })
  const created = await service.create(
    modelMutation({
      configName: "推理模型",
      model: "reasoning-model",
      contextWindow: 64_000,
      maxOutputTokens: 4_096,
      temperature: 0.4,
      supportedReasoningEfforts: ["none", "low", "high"],
      apiKey: "secret",
      headers: { "x-test": "yes" },
    }),
  )
  assert.equal(created.config.revision, 1)
  assert.equal(created.runtime.web.search.apiKey, "")
  assert.equal(created.runtime.web.fetch.apiKey, "")
  assert.match(
    await readFile(join(directory, "config", `${created.config.id}.toml`), "utf8"),
    /api_key = "secret"/,
  )

  const updated = await service.update(
    created.config.id,
    modelMutation({
      configName: "推理模型",
      model: "reasoning-model",
      contextWindow: 128_000,
      maxOutputTokens: 8_192,
      supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
      headers: undefined,
    }),
  )
  assert.equal(updated.config.revision, 2)
  assert.equal(updated.runtime.apiKey, "secret")
  assert.deepEqual(updated.runtime.headers, { "x-test": "yes" })
  assert.deepEqual(updated.config.supportedReasoningEfforts, [
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
  ])

  const cleared = await service.update(
    created.config.id,
    modelMutation({
      configName: "推理模型",
      model: "reasoning-model",
      contextWindow: 128_000,
      maxOutputTokens: 8_192,
      supportedReasoningEfforts: [],
      apiKey: null,
      headers: null,
    }),
  )
  assert.equal(cleared.runtime.apiKey, "")
  assert.deepEqual(cleared.runtime.headers, {})
  assert.deepEqual(cleared.config.supportedReasoningEfforts, [])

  await service.delete(created.config.id)
  assert.equal(await service.get(created.config.id), undefined)
})

test("重复 reasoning level 在校验阶段被拒绝", async () => {
  const service = createModelConfigService({
    dataDir: directory,
    seed: seedConfig(),
    logger,
  })
  await assert.rejects(
    service.create(
      modelMutation({
        configName: "重复等级",
        model: "dup",
        supportedReasoningEfforts: ["low", "low"],
      }),
    ),
    /Reasoning Level 重复/,
  )
})

const modelMutation = (override: Partial<ModelConfigMutation> = {}): ModelConfigMutation => ({
  configName: "模型配置",
  baseUrl: "https://example.com/v1",
  model: "model",
  contextWindow: 32_000,
  maxOutputTokens: 2_048,
  supportedReasoningEfforts: [],
  apiKey: "secret",
  headers: {},
  webSearchProvider: "" as const,
  webSearchApiKey: "",
  webFetchProvider: "" as const,
  webFetchApiKey: "",
  webTimeoutMs: 30_000,
  webMaxResponseBytes: 1024,
  logLevel: "info" as const,
  ...override,
})

const seedConfig = () => ({
  baseUrl: "https://seed.example.com/v1",
  apiKey: "seed-key",
  model: "seed-model",
  contextWindow: 32_000,
  maxOutputTokens: 2_048,
  headers: { "x-seed": "yes" },
})
