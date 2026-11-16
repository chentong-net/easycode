import type { ImagePlatform } from "@easycode/schema"

const STORAGE_KEY = "easycode.image-platform"

const isImagePlatform = (value: unknown): value is ImagePlatform =>
  value === "base64" || value === "deepseek-files"

/** 图片平台是纯前端偏好；旧配置或不可用的 localStorage 都回退到 Base64。 */
export const readImagePlatform = (): ImagePlatform => {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)
    return isImagePlatform(value) ? value : "base64"
  } catch {
    return "base64"
  }
}

export const saveImagePlatform = (platform: ImagePlatform): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, platform)
  } catch {
    // 本地存储不可用不应阻止模型配置保存，发送图片时会回退到 Base64。
  }
}
