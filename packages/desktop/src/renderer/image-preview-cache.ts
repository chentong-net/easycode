import type { JsonObject } from "@easycode/schema"

const STORAGE_KEY = "easycode.image-previews.v1"
const MAX_PREVIEWS = 200

type PreviewCache = Record<string, string>

/**
 * DeepSeek Files content 只带 file_id，消息本身无法恢复缩略图。
 * 缩略图属于纯界面数据，按 file_id 缓存在本机，不写入 provider content。
 */
export const cacheImagePreview = (content: JsonObject, preview: string | undefined): void => {
  const key = imagePreviewKey(content)
  if (key === undefined || preview === undefined) return

  try {
    const cache = readCache()
    delete cache[key]
    cache[key] = preview
    trimCache(cache)
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
  } catch {
    // 缓存不可用只影响历史缩略图，不影响图片发送。
  }
}

export const cachedImagePreview = (content: JsonObject): string | undefined => {
  const key = imagePreviewKey(content)
  if (key === undefined) return undefined
  return readCache()[key]
}

const imagePreviewKey = (content: JsonObject): string | undefined => {
  if (content.type !== "file" || typeof content.file_id !== "string") return undefined
  return `deepseek:${content.file_id}`
}

const readCache = (): PreviewCache => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === null) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    )
  } catch {
    return {}
  }
}

const trimCache = (cache: PreviewCache): void => {
  const keys = Object.keys(cache)
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_PREVIEWS))) delete cache[key]
}
