import { z } from "zod"

/**
 * 用户可以选择的图片处理平台。
 *
 * 平台选择由客户端随图片准备请求发送，Core 只负责把标识映射到具体实现。
 */
export const ImagePlatform = z.enum(["base64", "deepseek-files"])

export type ImagePlatform = z.infer<typeof ImagePlatform>

/** 可以写入 JSON、事件日志和 HTTP 报文的值。 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

/**
 * 严格 JSON 值。
 *
 * 这个 schema 不允许 undefined、函数、BigInt 等无法通过 JSON 无损往返的值。
 * 图片服务返回的 content 使用 JsonObject 约束，调用方不需要知道具体实现字段。
 */
export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(JsonValueSchema),
  ]),
)

export const JsonObjectSchema = z.record(JsonValueSchema)

export type JsonObject = Record<string, JsonValue>
