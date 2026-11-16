import { readFile, stat } from "node:fs/promises"
import { basename, resolve } from "node:path"

import { expandHome } from "../util/path.js"
import { ImageServiceError } from "./types.js"

export interface InspectedImage {
  path: string
  name: string
  mime: string
  data: Buffer
}

/** 读取图片并执行两个实现共用的文件级校验。 */
export const inspectImage = async (inputPath: string, maxBytes: number): Promise<InspectedImage> => {
  const path = resolve(expandHome(inputPath))
  let info
  try {
    info = await stat(path)
  } catch (error) {
    if (isNotFound(error)) throw new ImageServiceError("not_found", `图片文件不存在：${path}`, { cause: error })
    throw new ImageServiceError("bad_request", `无法读取图片文件：${path}`, { cause: error })
  }

  if (!info.isFile()) throw new ImageServiceError("bad_request", `图片路径不是普通文件：${path}`)
  if (info.size > maxBytes) {
    throw new ImageServiceError("bad_request", `图片大小为 ${formatBytes(info.size)}，超过 ${formatBytes(maxBytes)} 上限`)
  }

  let data: Buffer
  try {
    data = await readFile(path)
  } catch (error) {
    throw new ImageServiceError("bad_request", `无法读取图片文件：${path}`, { cause: error })
  }

  // 文件可能在 stat 之后被替换，读取后再以实际长度确认一次。
  if (data.byteLength > maxBytes) {
    throw new ImageServiceError(
      "bad_request",
      `图片大小为 ${formatBytes(data.byteLength)}，超过 ${formatBytes(maxBytes)} 上限`,
    )
  }

  const mime = detectImageMime(data)
  if (mime === undefined) {
    throw new ImageServiceError("bad_request", "仅支持 JPEG、PNG、GIF 和 WebP 图片")
  }

  return { path, name: basename(path), mime, data }
}

const detectImageMime = (data: Uint8Array): string | undefined => {
  if (
    data.length >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47 &&
    data[4] === 0x0d &&
    data[5] === 0x0a &&
    data[6] === 0x1a &&
    data[7] === 0x0a
  ) {
    return "image/png"
  }

  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg"

  if (
    data.length >= 6 &&
    data[0] === 0x47 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x38 &&
    (data[4] === 0x37 || data[4] === 0x39) &&
    data[5] === 0x61
  ) {
    return "image/gif"
  }

  if (
    data.length >= 12 &&
    ascii(data, 0, 4) === "RIFF" &&
    ascii(data, 8, 12) === "WEBP"
  ) {
    return "image/webp"
  }

  return undefined
}

const ascii = (data: Uint8Array, start: number, end: number): string =>
  String.fromCharCode(...data.subarray(start, end))

const isNotFound = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  const units = ["KiB", "MiB", "GiB"]
  let value = bytes / 1024
  let unit = units[0]
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024
    unit = units[index]
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`
}
