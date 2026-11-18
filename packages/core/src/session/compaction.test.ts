import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"

import {
  CompactionProfile,
  type DurableEvent,
  type Message,
  type Session,
} from "@easycode/schema"
import { zeroUsage } from "@easycode/schema"

import type { CoreConfig } from "../config.js"
import type { LLMClient, LLMRequest } from "../llm/types.js"
import type { Logger } from "../log.js"
import { createCompactionManager } from "./compaction.js"
import { createProjectedState, applyEvent } from "./projector.js"
import type { SessionHandle } from "./runtime.js"
import { createTaskState } from "./task.js"

const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => logger,
}

let directory: string

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "easycode-compaction-test-"))
})

after(async () => {
  await rm(directory, { recursive: true, force: true })
})

const profile = CompactionProfile.parse({
  schemaVersion: 1,
  id: "novel",
  revision: 3,
  builtIn: false,
  name: "小说创作",
  systemPrompt: "整理小说创作记忆。",
  includeTaskState: false,
  instructions: {
    initial: "整理新内容。",
    chunk: "整理当前分块。",
    merge: "合并已有内容。",
    correction: "请重新输出。",
  },
  sectionTitles: {
    previousSummary: "已有创作记忆",
    taskState: "当前任务状态",
    transcript: "待压缩创作历史",
    instruction: "压缩要求",
  },
  format: {
    type: "headings",
    headings: ["人物状态", "当前情节"],
  },
  createdAt: 0,
  updatedAt: 0,
})

test("摘要请求使用会话配置并用配置标题校验结果", async () => {
  const requests: LLMRequest[] = []
  const llm: LLMClient = {
    async *stream(request) {
      requests.push(request)
      yield {
        type: "text.delta",
        text: "## 人物状态\n主角仍在旧城。\n\n## 当前情节\n正在寻找导师。",
      }
      yield { type: "finish", reason: "stop" }
    },
  }
  const { handle, state } = createHandle("novel")
  const manager = createCompactionManager({
    config: testConfig("configured"),
    llm,
    logger,
  })

  const result = await manager.compactAfterOverflow({
    handle,
    profile,
    baselineSeq: 0,
    system: ["main-system"],
    messages: [],
    tools: [],
  })

  assert.equal(result.status, "completed")
  assert.equal(requests.length, 1)
  assert.match(requests[0]!.system.join("\n"), /整理小说创作记忆/)
  assert.match(requests[0]!.system.join("\n"), /## 人物状态/)
  const user = String((requests[0]!.messages[0] as { content: Array<{ text?: string }> }).content[0]?.text)
  assert.match(user, /# 已有创作记忆/)
  assert.match(user, /# 待压缩创作历史/)
  assert.equal(user.includes("# 当前任务状态"), false)

  const ended = state.messages.at(-1)
  assert.equal(ended?.role, "compaction")
  assert.match(ended?.text ?? "", /## 当前情节/)
  const events = state.messages
  assert.equal(events.at(-1)?.role, "compaction")
  assert.equal(state.activeCompactionID, undefined)
})

test("模型摘要失败时由引擎生成降级 checkpoint", async () => {
  const llm: LLMClient = {
    async *stream() {
      throw new Error("summary unavailable")
    },
  }
  const { handle, state } = createHandle("novel")
  const manager = createCompactionManager({
    config: testConfig("fallback"),
    llm,
    logger,
  })

  const result = await manager.compactAfterOverflow({
    handle,
    profile,
    baselineSeq: 0,
    system: ["main-system"],
    messages: [],
    tools: [],
  })

  assert.equal(result.status, "completed")
  assert.equal(result.usedFallback, true)
  const ended = state.messages.at(-1)
  assert.equal(ended?.role, "compaction")
  assert.match(ended?.role === "compaction" ? ended.text : "", /引擎降级检查点/)
})

const createHandle = (compactionProfileID: string): { handle: SessionHandle; state: ReturnType<typeof createProjectedState> } => {
  const session: Session = {
    id: "session_test",
    title: "测试会话",
    directory,
    agent: "build",
    compactionProfileID,
    model: "test-model",
    createdAt: 1,
    updatedAt: 1,
    usage: zeroUsage(),
    todos: [{ content: "继续创作", status: "in_progress" }],
  }
  const state = createProjectedState(session)
  const messages: Message[] = [
    {
      id: "checkpoint",
      role: "compaction",
      createdAt: 0,
      text: "## 人物状态\n主角刚抵达旧城。\n\n## 当前情节\n故事尚未开始。",
      recentMessageIDs: [],
    },
    userMessage("m1", "开始写一个旧城故事"),
    assistantMessage("m2", "主角进入旧城。"),
    userMessage("m3", "让他在钟楼遇到守卫"),
    assistantMessage("m4", "守卫认出了主角的徽章。"),
  ]
  state.messages = messages
  for (const [index, message] of messages.entries()) {
    state.messageIndex.set(message.id, message)
    state.messageSeq.set(message.id, index + 1)
  }
  state.task = createTaskState("继续创作小说", 1)
  state.lastSeq = messages.length

  const handle: SessionHandle = {
    id: session.id,
    state,
    async append(event) {
      const stored = { ...event, seq: ++state.lastSeq } as DurableEvent
      applyEvent(state, stored)
      return stored
    },
    async readContext() {
      return undefined
    },
    async saveContext() {
      return undefined
    },
  }
  return { handle, state }
}

const userMessage = (id: string, text: string): Message => ({
  id,
  role: "user",
  createdAt: 1,
  content: [{ type: "text", text }],
})

const assistantMessage = (id: string, text: string): Message => ({
  id,
  role: "assistant",
  createdAt: 1,
  model: "test-model",
  parts: [{ type: "text", text }],
})

const testConfig = (name: string): CoreConfig => ({
  baseUrl: "https://example.com/v1",
  apiKey: "test",
  model: "test-model",
  contextWindow: 128_000,
  maxOutputTokens: 8_192,
  headers: {},
  web: {
    timeoutMs: 30_000,
    maxResponseBytes: 1024,
    search: { apiKey: "" },
    fetch: { apiKey: "" },
  },
  logLevel: "error",
  configFile: join(directory, `${name}.toml`),
  dataDir: join(directory, name),
  modelConfigured: true,
})
