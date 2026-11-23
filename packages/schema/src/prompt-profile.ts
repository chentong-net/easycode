import { z } from "zod"

const Heading = z
  .string()
  .trim()
  .min(1, "摘要标题不能为空")
  .max(100, "摘要标题不能超过 100 个字符")
  .refine(
    (value) => !value.includes("\n") && !value.includes("\r"),
    "摘要标题不能包含换行",
  )
  .refine((value) => !value.startsWith("#"), "摘要标题不需要填写 Markdown # 前缀")

const Prompt = z
  .string()
  .trim()
  .min(1, "提示词不能为空")
  .max(100_000, "单个提示词不能超过 100000 个字符")

const requireUniqueHeadings = (
  value: { compactionHeadings: string[] },
  context: z.RefinementCtx,
): void => {
  const seen = new Set<string>()
  for (const [index, heading] of value.compactionHeadings.entries()) {
    if (seen.has(heading)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["compactionHeadings", index],
        message: `摘要标题重复：${heading}`,
      })
    }
    seen.add(heading)
  }
}

const PromptProfileFields = z
  .object({
    name: z.string().trim().min(1, "名称不能为空").max(80, "名称不能超过 80 个字符"),
    description: z.string().trim().max(500, "描述不能超过 500 个字符").optional(),
    /** 主对话 Agent 的系统提示词。 */
    systemPrompt: Prompt,
    /** compaction 摘要器专用的系统提示词。 */
    compactionSystemPrompt: Prompt,
    /** 最终 checkpoint 必须包含的 Markdown 二级标题。 */
    compactionHeadings: z
      .array(Heading)
      .min(1, "至少需要一个摘要标题")
      .max(12, "摘要标题不能超过 12 个"),
  })
  .strict()

/** 用户可编辑的场景提示词配置。 */
export const PromptProfileDraft = PromptProfileFields
  .superRefine(requireUniqueHeadings)

export type PromptProfileDraft = z.infer<typeof PromptProfileDraft>

/** 一份完整的 PromptProfile。id 创建后不可变。 */
export const PromptProfile = PromptProfileFields.extend({
  id: z.string().trim().min(1).max(100),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
}).superRefine(requireUniqueHeadings)

export type PromptProfile = z.infer<typeof PromptProfile>
