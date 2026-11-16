import type { JsonObject, JsonValue } from "@easycode/schema"

const DATABASE_NAME = "easycode-image-previews"
const STORE_NAME = "previews"
const DATABASE_VERSION = 1
const HASH_PREFIX = "sha256:"

let databasePromise: Promise<IDBDatabase | undefined> | undefined

/**
 * 图片 content 的缩略图属于纯界面元数据。
 *
 * 缓存键是规范化 content JSON 的 SHA-256，不解析 image_url、file_id 等
 * provider 字段。provider content 本身保持原样，不写入任何缓存字段。
 */
export const cacheImagePreview = async (content: JsonObject, preview: string | undefined): Promise<void> => {
  if (preview === undefined) return
  try {
    const [key, database] = await Promise.all([imageContentHash(content), getDatabase()])
    if (database === undefined) return

    const transaction = database.transaction(STORE_NAME, "readwrite")
    transaction.objectStore(STORE_NAME).put(preview, key)
    await transactionDone(transaction)
  } catch {
    // 缩略图缓存失败不应影响图片准备或消息发送。
  }
}

export const cachedImagePreview = async (content: JsonObject): Promise<string | undefined> => {
  try {
    const [key, database] = await Promise.all([imageContentHash(content), getDatabase()])
    if (database === undefined) return undefined

    const transaction = database.transaction(STORE_NAME, "readonly")
    const request = transaction.objectStore(STORE_NAME).get(key)
    const done = transactionDone(transaction)
    const value: unknown = await requestResult(request)
    await done
    return typeof value === "string" ? value : undefined
  } catch {
    return undefined
  }
}

/** 对图片 content 做稳定 JSON 序列化后再计算 SHA-256。 */
export const imageContentHash = async (content: JsonObject): Promise<string> => {
  const canonical = canonicalJSON(content)
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical))
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
  return `${HASH_PREFIX}${hex}`
}

const canonicalJSON = (value: JsonValue): string => {
  if (value === null) return "null"
  if (typeof value === "string") return JSON.stringify(value)
  if (typeof value === "number") return String(value)
  if (typeof value === "boolean") return value ? "true" : "false"
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJSON(value[key] as JsonValue)}`)
    .join(",")}}`
}

const getDatabase = (): Promise<IDBDatabase | undefined> => {
  if (typeof indexedDB === "undefined") return Promise.resolve(undefined)
  if (databasePromise !== undefined) return databasePromise

  databasePromise = new Promise<IDBDatabase | undefined>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("无法打开图片预览缓存"))
    request.onblocked = () => reject(new Error("图片预览缓存被其他窗口占用"))
  }).catch(() => {
    databasePromise = undefined
    return undefined
  })
  return databasePromise
}

const requestResult = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("图片预览缓存读取失败"))
  })

const transactionDone = (transaction: IDBTransaction): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error("图片预览缓存事务失败"))
    transaction.onabort = () => reject(transaction.error ?? new Error("图片预览缓存事务被取消"))
  })
