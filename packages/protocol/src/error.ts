import { z } from "zod"

/**
 * 传输层错误。
 *
 * 用固定的标签而不是自由文本分类，是为了让客户端能做可靠的分支判断：
 * 「会话不存在」和「参数非法」在界面上应该有不同的表现，
 * 靠匹配错误消息文本迟早会因为文案微调而失效。
 */

export const ErrorTag = z.enum([
  /** 请求格式不合法，或框架层无法解析请求 */
  "bad_request",
  /** 未认证 */
  "unauthorized",
  /** 已认证但无权限 */
  "forbidden",
  /** 目标资源不存在，例如会话 id 无效 */
  "not_found",
  /** 路径存在，但不支持当前 HTTP Method */
  "method_not_allowed",
  /** 请求与当前资源状态冲突 */
  "conflict",
  /** 请求体过大 */
  "payload_too_large",
  /** 请求被限流 */
  "rate_limited",
  /** 上游服务错误 */
  "bad_gateway",
  /** 服务暂时不可用 */
  "unavailable",
  /** 服务端内部错误；当前服务端会把异常的 message 写入响应体，同时记录日志 */
  "internal",
])

export type ErrorTag = z.infer<typeof ErrorTag>

/** 把 HTTP 状态映射为传输层错误分类。 */
export const tagForStatus = (status: number): ErrorTag => {
  if (status === 400) return "bad_request"
  if (status === 401) return "unauthorized"
  if (status === 403) return "forbidden"
  if (status === 404) return "not_found"
  if (status === 405) return "method_not_allowed"
  if (status === 409) return "conflict"
  if (status === 413) return "payload_too_large"
  if (status === 429) return "rate_limited"
  if (status === 502) return "bad_gateway"
  if (status === 503) return "unavailable"
  return "internal"
}

/**
 * 客户端抛出的传输层异常。
 *
 * 它同时携带标签与 HTTP 状态码：标签用于程序判断，状态码用于日志与排查。
 * 两条信息都保留是因为它们并不总是一一对应（例如网关返回的 502
 * 会被归类成 internal，但状态码仍然值得记下来）。
 */
export class ProtocolError extends Error {
  readonly tag: ErrorTag
  readonly status: number

  constructor(tag: ErrorTag, message: string, status = 500) {
    super(message)
    this.name = "ProtocolError"
    this.tag = tag
    this.status = status
  }
}
