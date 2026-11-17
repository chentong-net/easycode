import type { JsonObject } from "@easycode/schema"
import { z } from "zod"

import { describeError } from "../llm/error.js"
import type { Logger } from "../log.js"
import { inspectImage } from "./file.js"
import { ImageServiceError, type ImageInput, type ImageService } from "./types.js"

const MAX_IMAGE_BYTES = 64 * 1024 * 1024

interface DeepSeekFilesImageServiceOptions {
  baseUrl: string
  apiKey: string
  model: string
  headers: Record<string, string>
  logger: Logger
}

const FileResponse = z.object({
  id: z.string().min(1),
})

/** 上传本地图片到 DeepSeek Files API，并返回 file 内容块。 */
export class DeepSeekFilesImageService implements ImageService {
  readonly platform = "deepseek-files"

  constructor(private readonly options: DeepSeekFilesImageServiceOptions) {}

  async prepare(input: ImageInput, signal?: AbortSignal): Promise<JsonObject> {
    const endpoint = this.endpoint()
    const image = await inspectImage(input.path, MAX_IMAGE_BYTES)
    const form = new FormData()
    form.append("purpose", "user_data")
    form.append("file", new Blob([Uint8Array.from(image.data)], { type: image.mime }), image.name)

    let response: Response
    try {
      const headers = Object.fromEntries(
        Object.entries(this.options.headers).filter(
          ([name]) => !["authorization", "content-type", "content-length"].includes(name.toLowerCase()),
        ),
      )
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          ...headers,
          authorization: `Bearer ${this.options.apiKey}`,
        },
        body: form,
        ...(signal === undefined ? {} : { signal }),
      })
    } catch (error) {
      if (signal?.aborted) throw new ImageServiceError("upstream", "DeepSeek 图片上传已取消", { cause: error })
      this.options.logger.error("无法连接 DeepSeek Files API", { endpoint, error: describeError(error) })
      throw new ImageServiceError("upstream", `无法连接 DeepSeek Files API：${describeError(error)}`, {
        cause: error,
      })
    }

    const raw = await readJSONResponse(response)
    if (!response.ok) {
      const message = responseMessage(raw) ?? `DeepSeek Files API 返回 HTTP ${response.status}`
      this.options.logger.error("DeepSeek 图片上传失败", { endpoint, status: response.status, message })
      throw new ImageServiceError("upstream", message)
    }

    const parsed = FileResponse.safeParse(raw)
    if (!parsed.success) {
      throw new ImageServiceError("upstream", "DeepSeek Files API 返回格式不合法")
    }

    this.options.logger.info("DeepSeek 图片上传完成", {
      fileID: parsed.data.id,
      bytes: image.data.byteLength,
      mime: image.mime,
    })
    return {
      type: "file",
      file_id: parsed.data.id,
    }
  }

  private endpoint(): string {
    if (this.options.apiKey.trim().length === 0) {
      throw new ImageServiceError("bad_request", "DeepSeek API Key 尚未配置")
    }
    if (this.options.model !== "deepseek-flash") {
      throw new ImageServiceError("bad_request", "DeepSeek 图片输入仅支持 deepseek-flash 模型")
    }

    let base: URL
    try {
      base = new URL(this.options.baseUrl)
    } catch {
      throw new ImageServiceError("bad_request", "DeepSeek 接口地址不合法")
    }
    if (base.protocol !== "https:" || base.hostname !== "api.deepseek.com") {
      throw new ImageServiceError("bad_request", "DeepSeek Files 仅支持 https://api.deepseek.com 接口地址")
    }
    return `${base.origin}/files`
  }
}

const readJSONResponse = async (response: Response): Promise<unknown> => {
  const text = await response.text()
  if (text.trim().length === 0) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

const responseMessage = (value: unknown): string | undefined => {
  if (typeof value !== "object" || value === null) return undefined
  if ("error" in value && typeof value.error === "object" && value.error !== null && "message" in value.error) {
    return typeof value.error.message === "string" ? value.error.message : undefined
  }
  if ("message" in value && typeof value.message === "string") return value.message
  return undefined
}
