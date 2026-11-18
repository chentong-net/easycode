import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"

import type { Logger } from "../log.js"
import { createModelConfigService } from "./index.js"

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

test("首次使用从运行配置迁移模型且默认不发送 reasoning_effort", async () => {
  const service = createModelConfigService({
    dataDir: directory,
    seed: seedConfig(),
    logger,
  })

  const configs = await service.list()
  assert.equal(configs.length, 1)
  assert.equal(configs[0]?.model, "seed-model")
  assert.deepEqual(configs[0]?.supportedReasoningEfforts, [])
  assert.equal((await service.first()).id, configs[0]?.id)
})

test("模型配置支持创建、更新、保留或清除密钥以及删除", async () => {
  const service = createModelConfigService({
    dataDir: directory,
    seed: seedConfig(),
    logger,
  })
  const created = await service.create({
    name: "推理模型",
    baseUrl: "https://example.com/v1",
    model: "reasoning-model",
    contextWindow: 64_000,
    maxOutputTokens: 4_096,
    temperature: 0.4,
    supportedReasoningEfforts: ["none", "low", "high"],
    apiKey: "secret",
    headers: { "x-test": "yes" },
  })
  assert.equal(created.revision, 1)

  const updated = await service.update(created.id, {
    name: "推理模型",
    baseUrl: "https://example.com/v1",
    model: "reasoning-model",
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
  })
  assert.equal(updated.revision, 2)
  assert.equal(updated.apiKey, "secret")
  assert.deepEqual(updated.headers, { "x-test": "yes" })
  assert.deepEqual(updated.supportedReasoningEfforts, ["low", "medium", "high", "xhigh"])

  const cleared = await service.update(created.id, {
    name: "推理模型",
    baseUrl: "https://example.com/v1",
    model: "reasoning-model",
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    supportedReasoningEfforts: [],
    apiKey: null,
    headers: null,
  })
  assert.equal(cleared.apiKey, "")
  assert.deepEqual(cleared.headers, {})
  assert.deepEqual(cleared.supportedReasoningEfforts, [])

  await service.delete(created.id)
  assert.equal(await service.get(created.id), undefined)
})

test("重复 reasoning level 被拒绝", async () => {
  const service = createModelConfigService({
    dataDir: directory,
    seed: seedConfig(),
    logger,
  })
  await assert.rejects(
    service.create({
      name: "重复等级",
      baseUrl: "https://example.com/v1",
      model: "dup",
      contextWindow: 32_000,
      maxOutputTokens: 2_048,
      supportedReasoningEfforts: ["low", "low"],
      apiKey: "secret",
    }),
    /Reasoning Level 重复/,
  )
})

const seedConfig = () => ({
  baseUrl: "https://seed.example.com/v1",
  apiKey: "seed-key",
  model: "seed-model",
  contextWindow: 32_000,
  maxOutputTokens: 2_048,
  headers: { "x-seed": "yes" },
})
