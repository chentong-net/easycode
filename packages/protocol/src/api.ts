import { z, type ZodTypeAny } from "zod"

/** 所有已成功处理的接口响应都使用相同的外层结构。 */
export const API_SUCCESS_CODE = 0
export const API_SUCCESS_MESSAGE = "SUCCESS"

/**
 * 初版业务错误码。
 *
 * 这些错误码与 HTTP 状态码无关。后续新增错误时在这里集中登记，
 * 调用方不需要依赖自然语言 message 做分支判断。
 */
export const ApiErrorCode = {
  generic: -1,
} as const

export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode]

export const ApiErrorResponse = z.object({
  code: z
    .number()
    .int()
    .refine((value) => value !== API_SUCCESS_CODE, "业务错误码不能为 0"),
  message: z.string(),
})

export type ApiErrorResponse = z.infer<typeof ApiErrorResponse>

export const ApiSuccessResponse = <T extends ZodTypeAny>(data: T) =>
  z.object({
    code: z.literal(API_SUCCESS_CODE),
    message: z.literal(API_SUCCESS_MESSAGE),
    data,
  })

export type ApiSuccessResponse<T> = {
  code: typeof API_SUCCESS_CODE
  message: typeof API_SUCCESS_MESSAGE
  data: T
}

/** 每个接口使用自己的 data schema 校验成功响应。 */
export const ApiResponse = <T extends ZodTypeAny>(data: T) =>
  z.union([ApiSuccessResponse(data), ApiErrorResponse])

/** 服务端响应序列化和客户端基础解析共用的信封 schema。 */
export const ApiEnvelope = z.object({
  code: z.number().int(),
  message: z.string(),
  data: z.unknown().optional(),
})

export type ApiEnvelope = z.infer<typeof ApiEnvelope>

/** HTTP 200 响应体的业务失败。 */
export class ApiCallError extends Error {
  readonly code: number
  readonly path: string

  constructor(code: number, message: string, path: string) {
    super(message)
    this.name = "ApiCallError"
    this.code = code
    this.path = path
  }
}
