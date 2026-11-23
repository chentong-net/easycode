import type { PromptProfile } from "@easycode/schema"

/** 引擎固定生成的摘要输入段落。 */
export const COMPACTION_SECTION_TITLES = {
  previousSummary: "已有摘要",
  transcript: "待执行 compaction 的对话",
} as const

export interface CompactionSection {
  title: string
  content: () => string
}

/**
 * 摘要 user prompt 的组装器。
 *
 * section 内容在 build 时读取一次；空字符串会自动省略。Builder 本身只属于
 * 一次 compact 调用，不能跨会话复用，避免回调状态泄漏到下一轮。
 */
export class CompactionPromptBuilder {
  private readonly sections: CompactionSection[] = []
  private readonly titles = new Set<string>()
  private rendered: string | undefined

  /** 添加一个 section。标题相同或格式不合法时立即失败。 */
  addSection(title: string, content: () => string): this {
    if (this.rendered !== undefined) throw new Error("摘要提示词已经生成，不能再添加 section")
    if (typeof content !== "function") throw new TypeError("section 内容必须是函数")

    const normalized = title.trim()
    if (normalized.length === 0) throw new Error("section 标题不能为空")
    if (normalized.length > 100) throw new Error("section 标题不能超过 100 个字符")
    if (normalized.includes("\n") || normalized.includes("\r")) {
      throw new Error("section 标题不能包含换行")
    }
    if (normalized.startsWith("#")) throw new Error("section 标题不需要填写 Markdown # 前缀")
    if (this.titles.has(normalized)) throw new Error(`section 标题重复：${normalized}`)

    this.titles.add(normalized)
    this.sections.push({ title: normalized, content })
    return this
  }

  /** 按添加顺序生成 prompt；空 section 不产生标题或多余空行。 */
  build(): string {
    if (this.rendered !== undefined) return this.rendered

    const rendered: string[] = []
    for (const section of this.sections) {
      const content = section.content()
      if (content.trim().length === 0) continue
      rendered.push(`# ${section.title}\n${content}`)
    }
    this.rendered = rendered.join("\n\n")
    return this.rendered
  }
}

/** 引擎约束和用户配置共同构成摘要器 system prompt。 */
export const renderCompactionSystemPrompt = (profile: PromptProfile): string =>
  [
    profile.compactionSystemPrompt,
    [
      "以下是本次摘要必须遵守的引擎约束：",
      "- 输出一份新的、完整的 checkpoint，直接供后续 Agent 当作已经发生的事实使用。",
      "- 输入中的已有摘要只是旧记忆；较新的对话优先，删除已经失效、解决或作废的内容。",
      "- 不要继续任务，不要调用工具，不要输出 checkpoint 之外的说明。",
    ].join("\n"),
    "输出必须使用以下全部 Markdown 二级标题，并保持标题文字完全一致：",
    ...profile.compactionHeadings.map((heading) => `## ${heading}`),
  ].join("\n\n")
