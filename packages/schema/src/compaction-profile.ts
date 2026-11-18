import { z } from "zod"

const Label = z
  .string()
  .trim()
  .min(1, "标题不能为空")
  .max(100, "标题不能超过 100 个字符")
  .refine((value) => !value.includes("\n"), "标题不能包含换行")
  .refine((value) => !value.startsWith("#"), "标题不需要填写 Markdown # 前缀")

const Prompt = z
  .string()
  .trim()
  .min(1, "提示词不能为空")
  .max(100_000, "单个提示词不能超过 100000 个字符")

const Instructions = z
  .object({
    /** 没有旧 checkpoint，且全部输入可以一次摘要时使用。 */
    initial: Prompt,
    /** 输入过大、需要按消息分块摘要时使用。 */
    chunk: Prompt,
    /** 已有 checkpoint，或需要合并分块结果时使用。 */
    merge: Prompt,
    /** 模型输出缺少必需标题时，追加到原 user prompt 后使用。 */
    correction: Prompt,
  })
  .strict()

const SectionTitles = z
  .object({
    previousSummary: Label,
    taskState: Label,
    transcript: Label,
    instruction: Label,
  })
  .strict()

const SummaryFormat = z
  .object({
    type: z.literal("headings"),
    /** 填写纯标题，由引擎统一渲染成 Markdown 二级标题。 */
    headings: z.array(Label).min(1, "至少需要一个摘要标题").max(64, "摘要标题不能超过 64 个"),
  })
  .strict()

/** 用户在表单中可编辑的压缩配置字段。 */
const CompactionProfileFields = z
  .object({
    name: z.string().trim().min(1, "名称不能为空").max(80, "名称不能超过 80 个字符"),
    description: z.string().trim().max(500, "描述不能超过 500 个字符").optional(),
    /** 主对话模型使用的系统提示词，等价于场景的 BUILD_SYSTEM_PROMPT。 */
    agentSystemPrompt: Prompt,
    /** 压缩摘要器自身使用的系统提示词。 */
    systemPrompt: Prompt,
    includeTaskState: z.boolean(),
    instructions: Instructions,
    sectionTitles: SectionTitles,
    format: SummaryFormat,
  })
  .strict()

const requireUniqueHeadings = (
  value: { format: { headings: string[] } },
  context: z.RefinementCtx,
): void => {
  const seen = new Set<string>()
  for (const [index, heading] of value.format.headings.entries()) {
    if (seen.has(heading)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["format", "headings", index],
        message: `摘要标题重复：${heading}`,
      })
    }
    seen.add(heading)
  }
}

export const CompactionProfileDraft = CompactionProfileFields.superRefine(requireUniqueHeadings)

export type CompactionProfileDraft = z.infer<typeof CompactionProfileDraft>

/**
 * 一份完整的压缩配置。
 *
 * 用户配置保存为 `<id>.json`；内置 Coding 配置直接写进代码并同样通过此 Schema
 * 校验。`id` 在创建后不可变，编辑只能增加 `revision`。
 */
export const CompactionProfile = CompactionProfileFields.extend({
  schemaVersion: z.literal(1),
  id: z.string().trim().min(1).max(100),
  revision: z.number().int().positive(),
  builtIn: z.boolean(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
})
  .strict()
  .superRefine(requireUniqueHeadings)

export type CompactionProfile = z.infer<typeof CompactionProfile>
