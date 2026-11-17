import type { ImagePlatformInfo } from "@easycode/protocol"

const STORAGE_KEY = "easycode.image-platform"

export const base64Platform: ImagePlatformInfo = {
  platform: "base64",
  displayName: "Base64",
}

/** 图片平台选择只是前端偏好，能力列表始终以服务端注册表为准。 */
export const readImagePlatform = (): string | undefined => {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)?.trim()
    return value ? value : undefined
  } catch {
    return undefined
  }
}

export const saveImagePlatform = (platform: string): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, platform)
  } catch {
    // 本地存储不可用不应影响图片准备。
  }
}
