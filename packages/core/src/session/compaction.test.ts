import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"

import {
  PromptProfile,
  type DurableEvent,
  type Message,
  type ModelConfig,
  type Session,
} from "@easycode/schema"
import { zeroUsage } from "@easycode/schema"

import { LLMError } from "../llm/error.js"
import type { LLMClient, LLMRequest } from "../llm/types.js"
import type { Logger } from "../log.js"
import {
  calculateCompactionBudget,
  Compaction,
  type CompactInput,
} from "./compaction.js"
import { buildLLMMessages } from "./history.js"
import { applyEvent, createProjectedState } from "./projector.js"
import type { SessionHandle } from "./runtime.js"

const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => logger,
}

const profile = PromptProfile.parse({
  id: "novel",
  name: "小说创作",
  systemPrompt: "你是一个小说创作助手。",
  compactionSystemPrompt: "整理小说创作记忆。",
  compactionHeadings: ["人物状态", "当前情节"],
  createdAt: 0,
  updatedAt: 0,
})

let directory: string

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "easycode-compaction-test-"))
})

after(async () => {
  await rm(directory, { recursive: true, force: true })
})

test("32K 窗口为摘要保留 4K 输出预算", () => {
  const budget = calculateCompactionBudget({
    contextWindow: 32_000,
    maxOutputTokens: 8_192,
  })
  assert.equal(budget.summaryOutputTokens, 4_000)
  assert.ok(budget.summaryInputTokens > budget.triggerTokens)
})

test("compact 只调用一次摘要模型并写入新 checkpoint", async () => {
  const requests: LLMRequest[] = []
  const llm = summaryLLM(requests, summaryText())
  const { handle, state } = createHandle([previousCheckpoint(), ...history()])
  const compaction = new Compaction({ handle, dataDir: testDataDir("success"), logger })

  const result = await compaction.compact(
    input(llm, handle, {
      additionalSections: [{ title: "额外场景", content: () => "沿用当前世界观。" }],
    }),
  )

  assert.equal(result.status, "completed", JSON.stringify(result))
  assert.equal(requests.length, 1)
  assert.equal(requests[0]?.reasoningEffort, undefined)
  assert.equal(requests[0]?.tools.length, 0)
  assert.equal(requests[0]?.maxOutputTokens, 4_000)
  const system = requests[0]?.system.join("\n") ?? ""
  assert.match(system, /整理小说创作记忆/)
  assert.match(system, /## 人物状态/)
  const user = requestText(requests[0])
  assert.ok(user.indexOf("# 已有摘要") < user.indexOf("# 额外场景"))
  assert.ok(user.indexOf("# 额外场景") < user.indexOf("# 待执行 compaction 的对话"))
  assert.doesNotMatch(user, /请创建|请将上述|新信息优先/)
  assert.equal(state.messages.at(-1)?.role, "compaction")
  assert.equal(state.activeCompactionID, undefined)
  if (result.status === "completed") {
    assert.equal(
      state.messages.at(-1)?.id,
      result.checkpointMessageID,
    )
  }
})

test("摘要失败只返回 provider_error，不生成 fallback checkpoint", async () => {
  const requests: LLMRequest[] = []
  const llm: LLMClient = {
    async *stream(request) {
      requests.push(request)
      throw new LLMError("server", "上游不可用", { status: 503 })
    },
  }
  const messages = history()
  const { handle, state } = createHandle(messages)
  const count = state.messages.length
  const compaction = new Compaction({ handle, dataDir: testDataDir("provider-error"), logger })

  const result = await compaction.compact(input(llm, handle))

  assert.equal(result.status, "failed")
  assert.equal(result.status === "failed" ? result.failure.kind : "", "provider_error")
  assert.equal(requests.length, 1)
  assert.equal(state.messages.length, count)
  assert.equal(state.messages.some((message) => message.role === "compaction"), false)
  assert.equal(state.activeCompactionID, undefined)
})

test("provider 拒绝摘要上下文时归类为 summary_input_too_large", async () => {
  const llm: LLMClient = {
    async *stream() {
      throw new LLMError("context_overflow", "摘要请求超过上下文窗口", {
        status: 400,
      })
    },
  }
  const { handle } = createHandle(history())
  const compaction = new Compaction({
    handle,
    dataDir: testDataDir("provider-overflow"),
    logger,
  })

  const result = await compaction.compact(input(llm, handle))

  assert.equal(result.status, "failed")
  assert.equal(
    result.status === "failed" ? result.failure.kind : "",
    "summary_input_too_large",
  )
})

test("缺失标题返回 summary_invalid，不在 Compaction 内纠正或重试", async () => {
  const requests: LLMRequest[] = []
  const llm = summaryLLM(
    requests,
    "## 人物状态\n只有一部分\n\n```\n## 当前情节\n```",
  )
  const { handle } = createHandle(history())
  const compaction = new Compaction({ handle, dataDir: testDataDir("invalid"), logger })

  const result = await compaction.compact(input(llm, handle))

  assert.equal(result.status, "failed")
  assert.equal(result.status === "failed" ? result.failure.kind : "", "summary_invalid")
  assert.deepEqual(
    result.status === "failed" && result.failure.kind === "summary_invalid"
      ? result.failure.missingHeadings
      : undefined,
    ["当前情节"],
  )
  assert.equal(requests.length, 1)
})

test("长度耗尽返回 summary_truncated 且不写入 checkpoint", async () => {
  const llm: LLMClient = {
    async *stream() {
      yield { type: "text.delta", text: summaryText() }
      yield { type: "finish", reason: "length" }
    },
  }
  const { handle, state } = createHandle(history())
  const compaction = new Compaction({ handle, dataDir: testDataDir("truncated"), logger })

  const result = await compaction.compact(input(llm, handle))

  assert.equal(result.status, "failed")
  assert.equal(result.status === "failed" ? result.failure.kind : "", "summary_truncated")
  assert.equal(state.messages.some((message) => message.role === "compaction"), false)
})

test("摘要输入超过预算时不发起模型调用", async () => {
  const requests: LLMRequest[] = []
  const llm = summaryLLM(requests, summaryText())
  const { handle } = createHandle([
    userMessage("long", "长对话".repeat(4_000)),
    assistantMessage("tail", "短结果"),
  ])
  const compaction = new Compaction({ handle, dataDir: testDataDir("too-large"), logger })

  const result = await compaction.compact({
    ...input(llm, handle),
    runtime: {
      llm,
      modelConfig: modelConfig(2_048, 512),
      promptProfile: profile,
    },
  })

  assert.equal(result.status, "failed")
  assert.equal(result.status === "failed" ? result.failure.kind : "", "summary_input_too_large")
  assert.equal(requests.length, 0)
})

test("历史不足时返回 nothing_to_compact", async () => {
  const requests: LLMRequest[] = []
  const llm = summaryLLM(requests, summaryText())
  const { handle, state } = createHandle([userMessage("only", "只有一条消息")])
  const compaction = new Compaction({ handle, dataDir: testDataDir("nothing"), logger })

  const result = await compaction.compact(input(llm, handle))

  assert.equal(result.status, "failed")
  assert.equal(result.status === "failed" ? result.failure.kind : "", "nothing_to_compact")
  assert.equal(requests.length, 0)
  assert.equal(
    state.activeCompactionID,
    undefined,
  )
})

test("同一会话并发 compact 时返回 busy", async () => {
  let release: (() => void) | undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let firstStarted: (() => void) | undefined
  const started = new Promise<void>((resolve) => {
    firstStarted = resolve
  })
  const llm: LLMClient = {
    async *stream() {
      firstStarted?.()
      await gate
      yield { type: "text.delta", text: summaryText() }
      yield { type: "finish", reason: "stop" }
    },
  }
  const { handle } = createHandle(history())
  const compaction = new Compaction({ handle, dataDir: testDataDir("busy"), logger })

  const first = compaction.compact(input(llm, handle))
  await started
  const second = await compaction.compact(input(llm, handle))
  release?.()

  assert.equal(second.status, "failed")
  assert.equal(second.status === "failed" ? second.failure.kind : "", "busy")
  const firstResult = await first
  assert.equal(firstResult.status, "completed", JSON.stringify(firstResult))
})

test("summary_not_smaller 会拒绝没有缩小请求的摘要", async () => {
  const hugeSummary = [
    "## 人物状态",
    "人物状态".repeat(20_000),
    "## 当前情节",
    "当前情节".repeat(20_000),
  ].join("\n")
  const llm = summaryLLM([], hugeSummary)
  const { handle, state } = createHandle(history())
  const compaction = new Compaction({ handle, dataDir: testDataDir("not-smaller"), logger })

  const result = await compaction.compact(input(llm, handle))

  assert.equal(result.status, "failed")
  assert.equal(result.status === "failed" ? result.failure.kind : "", "summary_not_smaller")
  assert.equal(state.messages.some((message) => message.role === "compaction"), false)
})

const input = (
  llm: LLMClient,
  handle: SessionHandle,
  overrides: Partial<CompactInput> = {},
): CompactInput => ({
  runtime: {
    llm,
    modelConfig: modelConfig(32_000, 8_192),
    promptProfile: profile,
  },
  reason: "manual",
  baselineSeq: 0,
  system: ["main-system"],
  messages: buildLLMMessages(handle.state, { baselineSeq: 0 }),
  tools: [],
  ...overrides,
})

const summaryLLM = (requests: LLMRequest[], summary: string): LLMClient => ({
  async *stream(request) {
    requests.push(request)
    yield { type: "text.delta", text: summary }
    yield { type: "finish", reason: "stop" }
  },
})

const summaryText = (): string =>
  "## 人物状态\n主角仍在旧城。\n\n## 当前情节\n正在寻找导师。"

const previousCheckpoint = (): Message => ({
  id: "checkpoint",
  role: "compaction",
  createdAt: 0,
  text: "## 人物状态\n主角刚抵达旧城。\n\n## 当前情节\n故事尚未开始。",
  recentMessageIDs: [],
})

const history = (): Message[] => [
  userMessage("u1", "旧目标：完成第一章。".repeat(120)),
  assistantMessage("a1", "已经确认旧城地图和人物关系。".repeat(120)),
  userMessage("u2", "继续调查钟楼守卫。".repeat(100)),
  assistantMessage("a2", "发现守卫佩戴主角家族的徽章。".repeat(100)),
]

const createHandle = (
  messages: Message[],
): {
  handle: SessionHandle
  state: ReturnType<typeof createProjectedState>
} => {
  const session: Session = {
    id: "session_test",
    title: "测试会话",
    directory,
    agent: "build",
    promptProfileID: profile.id,
    modelConfigID: "test-config",
    model: "test-model",
    createdAt: 1,
    updatedAt: 1,
    usage: zeroUsage(),
    todos: [],
  }
  const state = createProjectedState(session)
  state.messages = [...messages]
  state.messageIndex = new Map(messages.map((message) => [message.id, message]))
  state.messageSeq = new Map(messages.map((message, index) => [message.id, index + 1]))
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

const requestText = (request: LLMRequest | undefined): string =>
  String(
    (
      request?.messages[0] as
        | { content: Array<{ text?: string }> }
        | undefined
    )?.content[0]?.text ?? "",
  )

const modelConfig = (contextWindow: number, maxOutputTokens: number): ModelConfig => ({
  schemaVersion: 1,
  id: "test-config",
  revision: 1,
  name: "测试模型",
  baseUrl: "https://example.com/v1",
  apiKey: "test",
  model: "test-model",
  headers: {},
  contextWindow,
  maxOutputTokens,
  supportedReasoningEfforts: [],
  createdAt: 1,
  updatedAt: 1,
})

const testDataDir = (name: string): string => join(directory, name)
