import type { JsonObject } from "@easycode/schema"

/** 图片只传本地路径，具体实现自行读取和校验。 */
export interface ImageInput {
  path: string
}

/** 当前请求所选模型配置中与图片上传有关的运行参数。 */
export interface ImageRuntimeConfig {
  baseUrl: string
  apiKey: string
  model: string
  headers: Record<string, string>
}

/** 图片准备策略：返回可直接加入模型 content 数组的 JSON。 */
export interface ImageService {
  readonly platform: string
  readonly displayName: string
  prepare(input: ImageInput, signal?: AbortSignal): Promise<JsonObject>
}

export interface ImagePlatformInfo {
  platform: string
  displayName: string
}

export interface ImagePlatformList {
  defaultPlatform: string
  platforms: ImagePlatformInfo[]
}

export interface ImagePrepareResult {
  adapter: string
  requestedPlatform?: string
  fallback: boolean
  content: JsonObject
}

/** 根据请求指定的平台选择具体实现。 */
export interface ImageServiceRegistry {
  platforms(): ImagePlatformList
  prepare(
    platform: string | undefined,
    input: ImageInput,
    runtime?: ImageRuntimeConfig,
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
