import type {
  Message,
  ModelConfig,
  Part,
  PromptProfile,
  ToolDefinition,
} from "@easycode/schema"
import { addUsage } from "@easycode/schema"

import { newMessageID } from "../id.js"
import { describeError, LLMError } from "../llm/error.js"
import type { LLMClient, LLMMessage, LLMRequest } from "../llm/types.js"
import { createLogger, type Logger } from "../log.js"
import {
  estimateTextTokens,
  MESSAGE_OVERHEAD_TOKENS,
} from "../util/token.js"
import {
  createCompactionBackupStore,
  type CompactionBackup,
} from "./compaction-backup.js"
import {
  COMPACTION_SECTION_TITLES,
  CompactionPromptBuilder,
  renderCompactionSystemPrompt,
  type CompactionSection,
} from "./compaction-prompt.js"
import {
  buildLLMMessages,
  estimateRequestTokens,
  estimateUserContentTokens,
  selectHistoryMessages,
} from "./history.js"
import type { SessionHandle } from "./runtime.js"

export type { CompactionSection } from "./compaction-prompt.js"

export type CompactionReason = "automatic" | "overflow" | "manual"

export interface CompactionBudget {
  contextWindow: number
  /** 主请求为模型输出预留的 token。 */
  outputTokens: number
  safetyMargin: number
  hardInputTokens: number
  triggerTokens: number
  targetTokens: number
  keepTokens: number
  summaryInputTokens: number
  summaryOutputTokens: number
}

export type CompactionFailure =
  | { kind: "nothing_to_compact" }
  | { kind: "summary_input_too_large" }
  | { kind: "summary_empty" }
  | { kind: "summary_truncated" }
  | { kind: "summary_invalid"; missingHeadings?: string[] }
  | { kind: "summary_not_smaller" }
  | {
      kind: "provider_error"
      message: string
      providerCode?: string
      status?: number
    }
  | { kind: "configuration_error"; message: string }
  | { kind: "aborted" }
  | { kind: "busy" }

export type CompactionResult =
  | {
      status: "completed"
      beforeTokens: number
      afterTokens: number
      summarizedMessages: number
      keptMessages: number
      checkpointMessageID: string
      backupID?: string
    }
  | {
      status: "failed"
      failure: CompactionFailure
      beforeTokens?: number
    }

export interface CompactionRuntime {
  llm: LLMClient
  modelConfig: ModelConfig
  promptProfile: PromptProfile
}

export interface CompactInput {
  runtime: CompactionRuntime
  reason: CompactionReason
  baselineSeq: number
  /** 当前主请求的 system 数组，用于计算压缩前后真实请求体积。 */
  system: string[]
  messages: LLMMessage[]
  tools: ToolDefinition[]
  /** 追加到 transcript 前的自定义 section。回调在一次 compact 中只执行一次。 */
  additionalSections?: readonly CompactionSection[]
  toolChoice?: "auto" | "none"
  signal?: AbortSignal
}

export interface CompactionOptions {
  handle: SessionHandle
  dataDir: string
  logger?: Logger
}

interface CompactionFailureContext {
  beforeTokens?: number
}

const TRANSCRIPT_TOOL_OUTPUT_LIMIT = 2_000

/**
 * 一个会话持有的上下文压缩器。
 *
 * compact() 只执行一次摘要模型调用。它不重试、不分块、不合并，也不生成
 * 引擎 fallback checkpoint；失败时旧历史和旧 checkpoint 保持不变，由上层
 * 根据结构化 CompactionFailure 决定是否再次调用。
 */
export class Compaction {
  private readonly backups
  private readonly logger: Logger
  private busy = false

  constructor(private readonly options: CompactionOptions) {
    this.logger = options.logger ?? createLogger("session.compaction")
    this.backups = createCompactionBackupStore(options.dataDir, this.logger)
  }

  async compact(input: CompactInput): Promise<CompactionResult> {
    if (this.busy) {
      return { status: "failed", failure: { kind: "busy" } }
    }

    this.busy = true
    const { handle } = this.options
    let beforeTokens: number | undefined
    let backup: CompactionBackup | undefined
    let compactionID: string | undefined

    const fail = async (
      failure: CompactionFailure,
      context: CompactionFailureContext = {},
    ): Promise<CompactionResult> => {
      if (compactionID !== undefined) {
        await handle
          .append({
            type: "compaction.failed",
            sessionID: handle.id,
            timestamp: Date.now(),
            compactionID,
            reason: failure.kind,
            ...(failureMessage(failure) === undefined
              ? {}
              : { message: failureMessage(failure) }),
          })
          .catch((error: unknown) => {
            this.logger.warn("无法写入 compaction 失败事件", {
              sessionID: handle.id,
              error: describeError(error),
            })
          })
      }
      await this.backups.finalize(backup, {
        status: "failed",
        failure,
        beforeTokens: context.beforeTokens,
      })
      return {
        status: "failed",
        failure,
        ...(context.beforeTokens === undefined
          ? {}
          : { beforeTokens: context.beforeTokens }),
      }
    }

    try {
      beforeTokens = estimateRequestTokens(input.system, input.messages, input.tools)
      const budget = calculateCompactionBudget(input.runtime.modelConfig)
      const history = selectHistoryMessages(handle.state, input.baselineSeq)
      const previous = [...history]
        .reverse()
        .find(
          (message): message is Extract<Message, { role: "compaction" }> =>
            message.role === "compaction",
        )
      const candidates = history.filter((message) => message.role !== "compaction")
      const targetTokens =
        input.reason === "overflow"
          ? Math.max(512, Math.min(budget.targetTokens, Math.floor(beforeTokens * 0.7)))
          : budget.targetTokens
      const keepTokens = Math.max(
        256,
        Math.min(budget.keepTokens, Math.floor(targetTokens * 0.25)),
      )
      const { head: subject, tail } = splitHistory(candidates, keepTokens)

      if (subject.length === 0 || tail.length === 0) {
        return fail({ kind: "nothing_to_compact" }, { beforeTokens })
      }

      compactionID = newMessageID()
      await handle.append({
        type: "compaction.started",
        sessionID: handle.id,
        timestamp: Date.now(),
        compactionID,
        reason: input.reason,
        beforeTokens,
        promptProfileID: input.runtime.promptProfile.id,
      })
      backup = await this.backups.prepare({
        id: compactionID,
        sessionID: handle.id,
        reason: input.reason,
        model: input.runtime.modelConfig.model,
        promptProfileID: input.runtime.promptProfile.id,
        baselineSeq: input.baselineSeq,
        system: input.system,
        messages: input.messages,
        tools: input.tools,
        task: handle.state.task,
        beforeTokens,
        budget: { ...budget },
        ...(input.toolChoice === undefined ? {} : { toolChoice: input.toolChoice }),
      })

      const systemPrompt = renderCompactionSystemPrompt(input.runtime.promptProfile)
      const prompt = buildSummaryPrompt({
        previousSummary: previous?.text,
        transcript: renderTranscript(subject),
        additionalSections: input.additionalSections,
      })
      const summaryRequestTokens =
        estimateTextTokens(systemPrompt) +
        estimateTextTokens(prompt) +
        MESSAGE_OVERHEAD_TOKENS
      if (summaryRequestTokens > budget.summaryInputTokens) {
        this.logger.warn("摘要输入超过压缩请求预算", {
          sessionID: handle.id,
          summaryRequestTokens,
          summaryInputTokens: budget.summaryInputTokens,
        })
        return fail({ kind: "summary_input_too_large" }, { beforeTokens })
      }

      if (input.signal?.aborted) {
        return fail({ kind: "aborted" }, { beforeTokens })
      }

      const request: LLMRequest = {
        model: input.runtime.modelConfig.model,
        system: [systemPrompt],
        messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
        tools: [],
        maxOutputTokens: budget.summaryOutputTokens,
        sessionID: handle.id,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      }

      let text = ""
      let finish = ""
      let usage: Parameters<typeof addUsage>[0] | undefined
      try {
        for await (const event of input.runtime.llm.stream(request)) {
          if (event.type === "text.delta") text += event.text
          else if (event.type === "usage") usage = event.usage
          else if (event.type === "finish") finish = event.reason
        }
      } catch (error) {
        const failure = providerFailure(error, input.signal)
        await this.backups.recordSummary(backup, {
          purpose: "summary",
          request,
          response: {
            text,
            finish,
            ...(usage === undefined ? {} : { usage }),
            validTemplate: false,
            error: describeError(error),
            keepText: true,
          },
        })
        return fail(failure, { beforeTokens })
      }

      if (usage !== undefined) {
        await handle.append({
          type: "session.updated",
          sessionID: handle.id,
          timestamp: Date.now(),
          usage: addUsage(handle.state.session.usage, usage),
        })
      }

      const validation = validateSummary(
        text,
        finish,
        input.runtime.promptProfile.compactionHeadings,
      )
      await this.backups.recordSummary(backup, {
        purpose: "summary",
        request,
        response: {
          text,
          finish,
          ...(usage === undefined ? {} : { usage }),
          validTemplate: validation === undefined,
          ...(validation === undefined ? {} : { error: failureMessage(validation) }),
          keepText: validation !== undefined,
        },
      })
      if (validation !== undefined) return fail(validation, { beforeTokens })

      const summary = text.trim()
      if (estimateTextTokens(summary) >= estimateMessagesTokens(subject)) {
        return fail({ kind: "summary_not_smaller" }, { beforeTokens })
      }

      const messageID = newMessageID()
      const recentMessageIDs = tail.map((message) => message.id)
      const checkpoint: Extract<Message, { role: "compaction" }> = {
        id: messageID,
        role: "compaction",
        createdAt: Date.now(),
        text: summary,
        recentMessageIDs,
      }
      const afterMessages = buildLLMMessages(
        {
          ...handle.state,
          messages: [...handle.state.messages, checkpoint],
        },
        { baselineSeq: input.baselineSeq },
      )
      const afterTokens = estimateRequestTokens(input.system, afterMessages, input.tools)
      if (afterTokens >= beforeTokens || afterTokens > budget.hardInputTokens) {
        this.logger.warn("摘要没有把最终请求缩小到安全范围，拒绝写入 checkpoint", {
          sessionID: handle.id,
          beforeTokens,
          afterTokens,
          hardInputTokens: budget.hardInputTokens,
          summaryTokens: estimateTextTokens(summary),
        })
        return fail({ kind: "summary_not_smaller" }, { beforeTokens })
      }

      await handle.append({
        type: "compaction.ended",
        sessionID: handle.id,
        timestamp: checkpoint.createdAt,
        messageID,
        text: summary,
        recentMessageIDs,
        reason: input.reason,
        beforeTokens,
        afterTokens,
        promptProfileID: input.runtime.promptProfile.id,
      })

      await this.backups.finalize(backup, {
        status: "completed",
        summarizedMessages: subject.length,
        keptMessages: tail.length,
        keptTokens: estimateMessagesTokens(tail),
        summaryTokens: estimateTextTokens(summary),
        beforeTokens,
        estimatedAfterTokens: afterTokens,
        checkpointMessageID: messageID,
      })
      await this.backups.recordAfter(
        backup?.id,
        {
          model: input.runtime.modelConfig.model,
          system: input.system,
          messages: afterMessages,
          tools: input.tools,
          maxOutputTokens: budget.outputTokens,
          ...(input.toolChoice === undefined ? {} : { toolChoice: input.toolChoice }),
          sessionID: handle.id,
        },
        afterTokens,
      )

      this.logger.info("compaction 完成", {
        sessionID: handle.id,
        summarizedMessages: subject.length,
        keptMessages: tail.length,
        beforeTokens,
        afterTokens,
        summaryTokens: estimateTextTokens(summary),
        summaryOutputTokens: budget.summaryOutputTokens,
        triggerTokens: budget.triggerTokens,
      })

      return {
        status: "completed",
        beforeTokens,
        afterTokens,
        summarizedMessages: subject.length,
        keptMessages: tail.length,
        checkpointMessageID: messageID,
        ...(backup === undefined ? {} : { backupID: backup.id }),
      }
    } catch (error) {
      this.logger.warn("compaction 执行失败", {
        sessionID: handle.id,
        error: describeError(error),
      })
      return fail(
        {
          kind: "configuration_error",
          message: describeError(error),
        },
        beforeTokens === undefined ? {} : { beforeTokens },
      )
    } finally {
      this.busy = false
    }
  }
}

/** 从模型窗口推导压缩预算。32K 窗口也会给摘要留下接近 4K 的输出空间。 */
export const calculateCompactionBudget = (
  config: Pick<ModelConfig, "contextWindow" | "maxOutputTokens">,
): CompactionBudget => {
  const contextWindow = Math.max(2_048, config.contextWindow)
  const maxOutputTokens = Math.max(1, config.maxOutputTokens)
  const outputTokens = Math.max(
    1,
    Math.min(maxOutputTokens, Math.floor(contextWindow * 0.25)),
  )
  const safetyMargin = Math.min(
    4_096,
    Math.max(256, Math.floor(contextWindow * 0.05)),
  )
  const hardInputTokens = Math.max(
    1_024,
    contextWindow - outputTokens - safetyMargin,
  )
  const triggerTokens = Math.max(768, Math.floor(hardInputTokens * 0.85))
  const targetTokens = Math.max(512, Math.floor(hardInputTokens * 0.65))
  const keepTokens = Math.max(
    256,
    Math.min(8_000, Math.floor(targetTokens * 0.25)),
  )
  const summaryOutputTokens = Math.min(
    maxOutputTokens,
    Math.max(256, Math.min(4_096, Math.floor(contextWindow * 0.125))),
  )
  const summaryInputTokens = Math.max(
    512,
    contextWindow - summaryOutputTokens - safetyMargin,
  )

  return {
    contextWindow,
    outputTokens,
    safetyMargin,
    hardInputTokens,
    triggerTokens,
    targetTokens,
    keepTokens,
    summaryInputTokens,
    summaryOutputTokens,
  }
}

interface SummaryPromptInput {
  previousSummary?: string
  transcript: string
  additionalSections?: readonly CompactionSection[]
}

const buildSummaryPrompt = (input: SummaryPromptInput): string => {
  const builder = new CompactionPromptBuilder()
  builder.addSection(
    COMPACTION_SECTION_TITLES.previousSummary,
    () => input.previousSummary ?? "",
  )
  for (const section of input.additionalSections ?? []) {
    builder.addSection(section.title, section.content)
  }
  builder.addSection(
    COMPACTION_SECTION_TITLES.transcript,
    () => input.transcript,
  )
  return builder.build()
}

const validateSummary = (
  text: string,
  finish: string,
  headings: readonly string[],
): CompactionFailure | undefined => {
  if (finish === "length" || finish === "max_tokens") {
    return { kind: "summary_truncated" }
  }
  if (text.trim().length === 0) return { kind: "summary_empty" }

  const present = new Set<string>()
  let fenced = false
  for (const line of text.split(/\r?\n/)) {
    if (line.trimStart().startsWith("```")) {
      fenced = !fenced
      continue
    }
    if (fenced) continue
    const match = /^##[ \t]+(.+?)[ \t]*$/.exec(line)
    if (match?.[1] !== undefined) present.add(match[1])
  }
  const missingHeadings = headings.filter((heading) => !present.has(heading))
  return missingHeadings.length === 0
    ? undefined
    : { kind: "summary_invalid", missingHeadings }
}

const providerFailure = (
  error: unknown,
  signal: AbortSignal | undefined,
): CompactionFailure => {
  if (signal?.aborted === true || (error instanceof Error && error.name === "AbortError")) {
    return { kind: "aborted" }
  }
  if (error instanceof LLMError) {
    if (error.kind === "aborted") return { kind: "aborted" }
    if (error.kind === "context_overflow") {
      return { kind: "summary_input_too_large" }
    }
    return {
      kind: "provider_error",
      message: error.message,
      providerCode: error.kind,
      ...(error.status === undefined ? {} : { status: error.status }),
    }
  }
  return { kind: "provider_error", message: describeError(error) }
}

const failureMessage = (failure: CompactionFailure): string | undefined => {
  switch (failure.kind) {
    case "summary_invalid": {
      const missing = failure.missingHeadings ?? []
      return missing.length === 0
        ? "摘要缺少必需的 Markdown 二级标题"
        : `摘要缺少必需标题：${missing.join("、")}`
    }
    case "provider_error":
      return failure.message
    case "configuration_error":
      return failure.message
    default:
      return undefined
  }
}

const splitHistory = (
  history: Message[],
  keepTokens: number,
): { head: Message[]; tail: Message[] } => {
  if (history.length === 0) return { head: [], tail: [] }

  let accumulated = 0
  let splitIndex = history.length
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index]
    if (!message) break
    const tokens = estimateMessageTokens(message)
    if (accumulated + tokens > keepTokens && accumulated > 0) break
    accumulated += tokens
    splitIndex = index
  }

  if (splitIndex > 0 && splitIndex < history.length) {
    for (let index = splitIndex; index >= 0; index -= 1) {
      if (history[index]?.role === "user") {
        if (estimateMessagesTokens(history.slice(index)) <= keepTokens) splitIndex = index
        break
      }
    }
  }

  splitIndex = Math.min(splitIndex, history.length - 1)
  if (splitIndex === 0 && history.length > 1) splitIndex = 1
  return {
    head: history.slice(0, splitIndex),
    tail: history.slice(splitIndex),
  }
}

const estimateMessagesTokens = (messages: Message[]): number =>
  messages.reduce((total, message) => total + estimateMessageTokens(message), 0)

const estimateMessageTokens = (message: Message): number => {
  switch (message.role) {
    case "user":
      return estimateUserContentTokens(message.content)
    case "assistant":
      return message.parts.reduce(
        (sum, part) => sum + estimateTextTokens(textOfPart(part)),
        0,
      )
    case "system":
      return estimateTextTokens(message.text)
    case "compaction":
      return estimateTextTokens(message.text)
  }
}

const textOfPart = (part: Part): string => {
  switch (part.type) {
    case "text":
      return part.text
    case "reasoning":
      return ""
    case "tool":
      return `${part.name} ${JSON.stringify(part.input ?? {})} ${toolOutputText(part)}`
    case "file":
      return `[附件 ${part.name ?? part.mime}]`
  }
}

const toolOutputText = (part: Extract<Part, { type: "tool" }>): string => {
  if (part.state.status === "success") {
    return part.state.content
      .map((content) => (content.type === "text" ? content.text : ""))
      .join("")
  }
  if (part.state.status === "error") return part.state.error
  return "（尚未完成）"
}

const renderTranscript = (messages: Message[]): string =>
  messages
    .map((message) => {
      switch (message.role) {
        case "user":
          return `[用户]\n${message.content.map(textOfUserContent).join("\n")}`
        case "assistant": {
          const parts = message.parts.map((part) => {
            if (part.type === "tool") {
              return [
                `[工具调用 ${part.name}]`,
                `入参：${JSON.stringify(part.input ?? {})}`,
                `结果：${truncate(toolOutputText(part), TRANSCRIPT_TOOL_OUTPUT_LIMIT)}`,
              ].join("\n")
            }
            if (part.type === "reasoning") return ""
            return textOfPart(part)
          })
          return `[助手]\n${parts.filter(Boolean).join("\n")}`
        }
        case "system":
          return `[系统提示]\n${message.text}`
        case "compaction":
          return `[已有摘要]\n${message.text}`
      }
    })
    .join("\n\n")

const textOfUserContent = (
  part: Extract<Message, { role: "user" }>["content"][number],
): string =>
  part.type === "text" && typeof part.text === "string" ? part.text : "[图片]"

const truncate = (text: string, limit: number): string => {
  if (text.length <= limit) return text
  const head = Math.floor(limit * 0.65)
  const tail = Math.max(limit - head, 0)
  return `${text.slice(0, head)}\n...（中间已截断，原长 ${text.length} 字符）...\n${text.slice(-tail)}`
}
