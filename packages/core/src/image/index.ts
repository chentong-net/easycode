import type { ImagePlatform, JsonObject } from "@easycode/schema"

import type { Logger } from "../log.js"
import { Base64ImageService } from "./base64.js"
import { DeepSeekFilesImageService } from "./deepseek-files.js"
import { ImageServiceError, type ImageInput, type ImageService, type ImageServiceRegistry } from "./types.js"

export { Base64ImageService } from "./base64.js"
export { DeepSeekFilesImageService } from "./deepseek-files.js"
export * from "./types.js"

export interface CreateImageServiceRegistryOptions {
  baseUrl: string
  apiKey: string
  model: string
  headers: Record<string, string>
  logger: Logger
}

export const createImageServiceRegistry = (
  options: CreateImageServiceRegistryOptions,
): ImageServiceRegistry => {
  const services: Record<ImagePlatform, ImageService> = {
    base64: new Base64ImageService(),
    "deepseek-files": new DeepSeekFilesImageService(options),
  }

  return {
    prepare: async (platform: ImagePlatform, input: ImageInput, signal?: AbortSignal): Promise<JsonObject> => {
      const service = services[platform]
      if (service === undefined) {
        throw new ImageServiceError("bad_request", `不支持的图片平台：${platform}`)
      }
      return service.prepare(input, signal)
    },
  }
}
