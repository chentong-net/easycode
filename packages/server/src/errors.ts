import { ApiErrorCode } from "@easycode/protocol"

/**
 * 业务失败。
 *
 * 请求已经进入业务处理，并成功形成了失败结果。按照项目约定，
 * 这类错误使用 HTTP 200，通过响应体中的 code/message 表达。
 */
export class BusinessError extends Error {
  readonly code: number

  constructor(message: string, code: number = ApiErrorCode.generic) {
    super(message)
    this.name = "BusinessError"
    this.code = code
  }
}

/** 路由、认证或基础设施层错误。 */
export class HttpError extends Error {
  readonly statusCode: number

  constructor(statusCode: number, message: string) {
    super(message)
    this.name = "HttpError"
    this.statusCode = statusCode
  }
}
