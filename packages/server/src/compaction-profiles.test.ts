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
  directory = await mkdtemp(join(tmpdir(), "easycode-profile-api-test-"))
  core = createCore({ config: testConfig(), logger })
  application = await createApplication({ core, token, logger })
})

after(async () => {
  await application.app.close()
  await core.shutdown()
  await rm(directory, { recursive: true, force: true })
})

test("压缩配置经过真实 HTTP 接口创建、热更新并绑定到会话", async () => {
  const createdResponse = await application.app.inject({
    method: "POST",
    url: "/api/compaction-profiles",
    headers: auth,
    payload: profileDraft("聊天"),
  })
  assert.equal(createdResponse.statusCode, 200)
  const created = createdResponse.json().data as { id: string; revision: number }
  assert.equal(created.revision, 1)

  const updatedResponse = await application.app.inject({
    method: "PUT",
    url: `/api/compaction-profiles/${created.id}`,
    headers: auth,
    payload: profileDraft("长期聊天"),
  })
  assert.equal(updatedResponse.statusCode, 200)
  const updated = updatedResponse.json().data as { name: string; revision: number }
  assert.equal(updated.name, "长期聊天")
  assert.equal(updated.revision, 2)

  const sessionResponse = await application.app.inject({
    method: "POST",
    url: "/api/sessions",
    headers: auth,
    payload: {
      directory,
      compactionProfileID: created.id,
    },
  })
  assert.equal(sessionResponse.statusCode, 200, sessionResponse.body)
  const session = sessionResponse.json().data as {
    id: string
    compactionProfileID: string
  }
  assert.equal(session.compactionProfileID, created.id)

  const deleted = await application.app.inject({
    method: "DELETE",
    url: `/api/compaction-profiles/${created.id}`,
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
    message: "当前会话使用的压缩配置已不存在，无法继续对话。",
  })
})

test("无效压缩配置返回明确业务错误", async () => {
  const response = await application.app.inject({
    method: "POST",
    url: "/api/compaction-profiles",
    headers: auth,
    payload: {
      ...profileDraft("重复标题"),
      format: { type: "headings", headings: ["目标", "目标"] },
    },
  })

  assert.equal(response.statusCode, 200)
  assert.equal(response.json().code, -1)
  assert.match(response.json().message, /摘要标题重复/)
})

const profileDraft = (name: string) => ({
  name,
  description: "测试用压缩配置",
  agentSystemPrompt: "你是一个聊天助手。",
  systemPrompt: "整理聊天记忆。",
  includeTaskState: false,
  instructions: {
    initial: "整理当前聊天。",
    chunk: "整理当前分块。",
    merge: "合并聊天记忆。",
    correction: "请按标题重新输出。",
  },
  sectionTitles: {
    previousSummary: "已有聊天记忆",
    taskState: "当前任务状态",
    transcript: "待压缩聊天",
    instruction: "压缩要求",
  },
  format: {
    type: "headings",
    headings: ["重要事实", "未完成话题"],
  },
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
