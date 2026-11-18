import { CompactionProfile } from "@easycode/schema"

import { BUILD_SYSTEM_PROMPT } from "../agent.js"

export const CODING_COMPACTION_PROFILE_ID = "coding"

/** 内置编程压缩配置。它直接随代码发布，不依赖用户目录中的文件。 */
export const codingCompactionProfile = CompactionProfile.parse({
  schemaVersion: 1,
  id: CODING_COMPACTION_PROFILE_ID,
  revision: 1,
  builtIn: true,
  name: "Coding",
  description: "默认编程压缩配置",
  agentSystemPrompt: BUILD_SYSTEM_PROMPT,
  systemPrompt: `你是一个 Coding Agent 的工作记忆压缩器，负责把较早对话整理成可供后续继续工作的结构化 checkpoint（检查点）。

要求：
- 只保留后续工作必需的信息，每条尽量使用单行短句。
- 保留原始目标、仍然有效的约束、已做出的决定、已完成和进行中的工作。
- 保留精确的文件路径、符号、命令和错误串。
- 记录已经排除的方案和失败指纹，避免后续重复尝试。
- 丢弃寒暄、重复读取、已经作废的过程和模型推理。
- 摘要会被直接当作已发生的事实使用，不要写「根据对话」这类元描述。
- 不要编造；缺失的信息写「无」。`,
  includeTaskState: true,
  instructions: {
    initial: "把「待执行 compaction 的对话」整理成工作记忆摘要。",
    chunk: "先把这一段待执行 compaction 的对话整理成分块工作记忆摘要，保留最终合并所需的信息。",
    merge:
      "把「已有摘要」与「待执行 compaction 的对话」合并成一份新摘要。新信息优先；已解决问题移出阻塞和进行中；保留未解决问题与仍然有效的决定。",
    correction:
      "你刚才的输出没有使用规定的模板。请重新输出完整摘要，必须使用上面的所有 ## 标题，不要解释，不要调用工具。",
  },
  sectionTitles: {
    previousSummary: "已有摘要",
    taskState: "当前任务状态",
    transcript: "待执行 compaction 的对话",
    instruction: "任务",
  },
  format: {
    type: "headings",
    headings: ["目标", "需求与限制", "决定", "已完成", "进行中", "阻塞", "下一步", "涉及的文件", "关键上下文"],
  },
  createdAt: 0,
  updatedAt: 0,
})
