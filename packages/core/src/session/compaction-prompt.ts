import type { CompactionProfile } from "@easycode/schema"

export interface CompactionUserPromptInput {
  previousSummary?: string
  taskMemory?: string
  transcript: string
  instruction: string
}

/** system prompt 由用户文案和配置中的必需标题共同组成。 */
export const renderCompactionSystemPrompt = (profile: CompactionProfile): string =>
  [
    profile.systemPrompt,
    "必须严格包含以下全部标题：",
    ...profile.format.headings.map((heading) => `## ${heading}`),
  ].join("\n\n")

/**
 * 按固定顺序组装摘要 user prompt。
 *
 * 配置只控制标题和文案，不能省略 transcript 或 instruction，也不能重排 section；
 * 这些约束由引擎保证，避免用户配置破坏摘要请求的基本结构。
 */
export const buildCompactionUserPrompt = (
  profile: CompactionProfile,
  input: CompactionUserPromptInput,
): string => {
  const sections: string[] = []
  if (input.previousSummary) {
    sections.push(section(profile.sectionTitles.previousSummary, input.previousSummary))
  }
  if (input.taskMemory) {
    sections.push(section(profile.sectionTitles.taskState, input.taskMemory))
  }
  sections.push(section(profile.sectionTitles.transcript, input.transcript))
  sections.push(section(profile.sectionTitles.instruction, input.instruction))
  return sections.join("\n\n")
}

/** 模型输出必须包含配置中的全部 Markdown 二级标题。 */
export const hasRequiredCompactionHeadings = (
  profile: CompactionProfile,
  text: string,
): boolean => profile.format.headings.every((heading) => text.includes(`## ${heading}`))

const section = (title: string, content: string): string => `# ${title}\n${content}`
