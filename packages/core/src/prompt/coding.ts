import { PromptProfile } from "@easycode/schema"

import { BUILD_SYSTEM_PROMPT } from "../agent.js"

export const CODING_PROMPT_PROFILE_ID = "coding"

/** 内置编程场景提示词，随代码发布且不写入用户目录。 */
export const codingPromptProfile = PromptProfile.parse({
  id: CODING_PROMPT_PROFILE_ID,
  name: "编程",
  description: "默认编程与代码修改场景",
  systemPrompt: BUILD_SYSTEM_PROMPT,
  compactionSystemPrompt: `你是一个 Coding Agent 的工作记忆压缩器，负责把较早对话整理成可供后续继续工作的结构化 checkpoint（检查点）。

每次输出都是一份新的、完整的 checkpoint。
如果输入中包含上一轮摘要，只把它视为旧记忆；较新的对话信息优先，删除已经失效、解决或作废的内容。

要求：
- 只保留后续工作必需的信息，每条尽量使用单行短句。
- 保留原始目标、仍然有效的约束、已做出的决定、已完成和进行中的工作。
- 保留精确的文件路径、符号、命令和错误串。
- 记录已经排除的方案和失败指纹，避免后续重复尝试。
- 丢弃寒暄、重复读取、已经作废的过程和模型推理。
- 摘要会被直接当作已发生的事实使用，不要写「根据对话」这类元描述。
- 不要编造；缺失的信息写「无」。
- 不要继续任务，不要调用工具，不要输出摘要之外的说明。`,
  compactionHeadings: [
    "目标",
    "需求与限制",
    "决定",
    "已完成",
    "进行中",
    "阻塞",
    "下一步",
    "涉及的文件",
    "关键上下文",
  ],
  createdAt: 0,
  updatedAt: 0,
})
