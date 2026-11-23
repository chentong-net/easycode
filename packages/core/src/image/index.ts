import type { Logger } from "../log.js"
import { Base64ImageService } from "./base64.js"
import { DeepSeekFilesImageService } from "./deepseek-files.js"
import {
  ImageServiceError,
  type ImageInput,
  type ImagePrepareResult,
  type ImagePlatformList,
  type ImageRuntimeConfig,
  type ImageService,
  type ImageServiceRegistry,
} from "./types.js"

export { Base64ImageService } from "./base64.js"
export { DeepSeekFilesImageService } from "./deepseek-files.js"
export * from "./types.js"

export interface CreateImageServiceRegistryOptions {
  logger: Logger
  /** 可选的额外 Adapter，用于不改公共协议地扩展图片实现。 */
  adapters?: ImageService[]
}

export const createImageServiceRegistry = (
  options: CreateImageServiceRegistryOptions,
): ImageServiceRegistry => {
  const services = new Map<string, ImageService>()
  const deepSeekPlatform = {
    platform: "deepseek-files",
    displayName: "DeepSeek Files API",
  } as const
  const register = (service: ImageService): void => {
    if (services.has(service.platform)) {
      throw new Error(`重复的图片 Adapter：${service.platform}`)
    }
    services.set(service.platform, service)
  }

  register(new Base64ImageService())
  for (const adapter of options.adapters ?? []) register(adapter)
  if (services.has(deepSeekPlatform.platform)) {
    throw new Error(`重复的图片 Adapter：${deepSeekPlatform.platform}`)
  }

  if (!services.has("base64")) {
    throw new Error("缺少 Base64 图片兜底 Adapter")
  }

  return {
    platforms: (): ImagePlatformList => ({
      defaultPlatform: "base64",
      platforms: [
        ...[...services.values()].map((service) => ({
          platform: service.platform,
          displayName: service.displayName,
        })),
        deepSeekPlatform,
      ],
    }),
    prepare: async (
      platform: string | undefined,
      input: ImageInput,
      runtime?: ImageRuntimeConfig,
      signal?: AbortSignal,
    ): Promise<ImagePrepareResult> => {
      const startedAt = Date.now()
      const requestedPlatform = platform?.trim() || undefined
      let service: ImageService | undefined
      if (requestedPlatform === deepSeekPlatform.platform) {
        if (runtime === undefined) {
          throw new ImageServiceError("bad_request", "请选择 DeepSeek 模型配置")
        }
        service = new DeepSeekFilesImageService({ ...runtime, logger: options.logger })
      } else {
        service =
          (requestedPlatform === undefined ? undefined : services.get(requestedPlatform)) ??
          services.get("base64")
      }

      if (service === undefined) {
        throw new ImageServiceError("bad_request", "没有可用的图片 Adapter")
      }

      const fallback = requestedPlatform !== service.platform
      try {
        const content = await service.prepare(input, signal)
        const result: ImagePrepareResult = {
          adapter: service.platform,
          ...(requestedPlatform === undefined ? {} : { requestedPlatform }),
          fallback,
          content,
        }
        options.logger.info("图片准备完成", {
          requestedPlatform,
          adapter: service.platform,
          fallback,
          durationMs: Date.now() - startedAt,
        })
        return result
      } catch (error) {
        options.logger.error("图片准备失败", {
          requestedPlatform,
          adapter: service.platform,
          fallback,
          durationMs: Date.now() - startedAt,
          error,
        })
        throw error
      }
    },
  }
}
