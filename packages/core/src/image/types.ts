import type { JsonObject } from "@easycode/schema"

/** 图片只传本地路径，具体实现自行读取和校验。 */
export interface ImageInput {
  path: string
}

/** 图片准备策略：返回可直接加入模型 content 数组的 JSON。 */
export interface ImageService {
  readonly platform: string
  prepare(input: ImageInput, signal?: AbortSignal): Promise<JsonObject>
}

export interface ImagePrepareResult {
  adapter: string
  requestedPlatform?: string
  fallback: boolean
  content: JsonObject
}

/** 根据请求指定的平台选择具体实现。 */
export interface ImageServiceRegistry {
  prepare(
    platform: string | undefined,
    input: ImageInput,
    signal?: AbortSignal,
  ): Promise<ImagePrepareResult>
}

export type ImageServiceErrorKind = "bad_request" | "not_found" | "upstream"

export class ImageServiceError extends Error {
  constructor(
    readonly kind: ImageServiceErrorKind,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = "ImageServiceError"
  }
}
