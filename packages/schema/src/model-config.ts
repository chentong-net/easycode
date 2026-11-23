import { z } from "zod"

/** 后端支持的标准 reasoning effort。 */
export const REASONING_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const

export const ReasoningEffort = z.enum(REASONING_EFFORTS)

export type ReasoningEffort = z.infer<typeof ReasoningEffort>

const ModelConfigFields = z
  .object({
    name: z.string().trim().min(1, "配置名称不能为空").max(80, "配置名称不能超过 80 个字符"),
    baseUrl: z.string().trim().url("接口地址必须是合法 URL"),
    model: z.string().trim().min(1, "模型 ID 不能为空"),
    apiKey: z.string().max(20_000, "API Key 过长"),
    headers: z.record(z.string(), z.string()).default({}),
    contextWindow: z.number().int().positive("上下文窗口必须是正整数"),
    maxOutputTokens: z.number().int().positive("输出上限必须是正整数"),
    temperature: z.number().finite().optional(),
    /** 空数组表示不向 provider 发送 reasoning_effort。 */
    supportedReasoningEfforts: z.array(ReasoningEffort).max(REASONING_EFFORTS.length),
  })
  .strict()

/**
 * 一份完整模型配置。
 *
 * 文件保存在 `~/easycode/.easycode/config/<id>.toml`。API Key 只在本机文件和
 * Core 进程内使用，HTTP 展示层会转换成“是否已配置”。
 */
export const ModelConfig = ModelConfigFields.extend({
  schemaVersion: z.literal(1),
  id: z.string().trim().min(1),
  revision: z.number().int().positive(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
})
  .strict()
  .superRefine((value, context) => {
    const seen = new Set<ReasoningEffort>()
    for (const [index, effort] of value.supportedReasoningEfforts.entries()) {
      if (seen.has(effort)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["supportedReasoningEfforts", index],
          message: `Reasoning Level 重复：${effort}`,
        })
      }
      seen.add(effort)
    }
  })

export type ModelConfig = z.infer<typeof ModelConfig>
