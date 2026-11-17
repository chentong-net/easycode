import type { JsonObject } from "@easycode/schema"

import { inspectImage } from "./file.js"
import type { ImageInput, ImageService } from "./types.js"

const MAX_IMAGE_BYTES = 10 * 1024 * 1024

/** 将本地图片内联编码成 OpenAI Chat Completions 的 image_url 内容块。 */
export class Base64ImageService implements ImageService {
  readonly platform = "base64"

  async prepare(input: ImageInput): Promise<JsonObject> {
    const image = await inspectImage(input.path, MAX_IMAGE_BYTES)
    return {
      type: "image_url",
      image_url: {
        url: `data:${image.mime};base64,${image.data.toString("base64")}`,
      },
    }
  }
}
