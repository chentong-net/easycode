import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"

import { createCore, type CoreConfig, type Logger } from "@easycode/core"

import { createApplication } from "./app.js"

const token = "test-token"
const auth = {
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
  directory = await mkdtemp(join(tmpdir(), "easycode-prompt-profile-api-test-"))
  core = createCore({ config: testConfig(), logger })
  application = await createApplication({ core, token, logger })
})

after(async () => {
  await application.app.close()
  await core.shutdown()
  await rm(directory, { recursive: true, force: true })
})

test("提示配置经过真实 HTTP 接口创建、更新并绑定到会话", async () => {
  const createdResponse = await application.app.inject({
    method: "POST",
    url: "/api/prompt-profiles",
    headers: auth,
    payload: profileDraft("聊天"),
  })
  assert.equal(createdResponse.statusCode, 200, createdResponse.body)
  const created = createdResponse.json().data as {
    id: string
    createdAt: number
    updatedAt: number
  }
  assert.ok(created.id.length > 0)
  assert.equal(created.createdAt, created.updatedAt)
  assert.equal("revision" in created, false)
  assert.equal("builtIn" in created, false)

  const updatedResponse = await application.app.inject({
    method: "PUT",
    url: `/api/prompt-profiles/${created.id}`,
    headers: auth,
    payload: profileDraft("长期聊天"),
  })
  assert.equal(updatedResponse.statusCode, 200, updatedResponse.body)
  const updated = updatedResponse.json().data as {
    name: string
    systemPrompt: string
    compactionSystemPrompt: string
    compactionHeadings: string[]
  }
  assert.equal(updated.name, "长期聊天")
  assert.equal(updated.systemPrompt, "你是一个聊天助手。")
  assert.equal(updated.compactionSystemPrompt, "整理聊天记忆。")
  assert.deepEqual(updated.compactionHeadings, ["重要事实", "未完成话题"])

  const listResponse = await application.app.inject({
    method: "GET",
    url: "/api/prompt-profiles",
    headers: auth,
  })
  assert.equal(listResponse.statusCode, 200)
  const list = listResponse.json().data as Array<Record<string, unknown>>
  const summary = list.find((profile) => profile.id === created.id)
  assert.ok(summary)
  assert.equal("systemPrompt" in summary, false)
  assert.equal("compactionSystemPrompt" in summary, false)
  assert.equal("compactionHeadings" in summary, false)

  const sessionResponse = await application.app.inject({
    method: "POST",
    url: "/api/sessions",
    headers: auth,
    payload: {
      directory,
      promptProfileID: created.id,
    },
  })
  assert.equal(sessionResponse.statusCode, 200, sessionResponse.body)
  const session = sessionResponse.json().data as {
    id: string
    promptProfileID: string
  }
  assert.equal(session.promptProfileID, created.id)

  const deleted = await application.app.inject({
    method: "DELETE",
    url: `/api/prompt-profiles/${created.id}`,
    headers: { "x-easycode-token": token },
  })
  assert.equal(deleted.statusCode, 200)

  const promptResponse = await application.app.inject({
    method: "POST",
    url: `/api/sessions/${session.id}/prompt`,
    headers: auth,
    payload: { text: "继续聊" },
  })
  assert.equal(promptResponse.statusCode, 200)
  assert.deepEqual(promptResponse.json(), {
    code: -1,
    message: "当前会话使用的提示配置已不存在，无法继续对话。",
  })
})

test("内置编程配置可读取完整提示词", async () => {
  const response = await application.app.inject({
    method: "GET",
    url: "/api/prompt-profiles/coding",
    headers: auth,
  })

  assert.equal(response.statusCode, 200, response.body)
  const profile = response.json().data as {
    id: string
    name: string
    systemPrompt: string
    compactionSystemPrompt: string
    compactionHeadings: string[]
  }
  assert.equal(profile.id, "coding")
  assert.equal(profile.name, "编程")
  assert.ok(profile.systemPrompt.length > 0)
  assert.ok(profile.compactionSystemPrompt.length > 0)
  assert.ok(profile.compactionHeadings.length > 0)
})

test("重复摘要标题返回明确业务错误", async () => {
  const response = await application.app.inject({
    method: "POST",
    url: "/api/prompt-profiles",
    headers: auth,
    payload: {
      ...profileDraft("重复标题"),
      compactionHeadings: ["目标", "目标"],
    },
  })

  assert.equal(response.statusCode, 200)
  assert.equal(response.json().code, -1)
  assert.match(response.json().message, /摘要标题重复/)
})

const profileDraft = (name: string) => ({
  name,
  description: "测试用提示配置",
  systemPrompt: "你是一个聊天助手。",
  compactionSystemPrompt: "整理聊天记忆。",
  compactionHeadings: ["重要事实", "未完成话题"],
})

const testConfig = (): CoreConfig => ({
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
  configFile: join(directory, "config.toml"),
  dataDir: join(directory, "data"),
  modelConfigured: true,
})
