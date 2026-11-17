import type { ImagePlatformInfo } from "@easycode/protocol"

const STORAGE_KEY = "easycode.image-platform.selection.v1"
const LEGACY_STORAGE_KEY = "easycode.image-platform"

export const base64Platform: ImagePlatformInfo = {
  platform: "base64",
  displayName: "Base64",
}

/** 图片平台选择只是前端偏好，能力列表始终以服务端注册表为准。 */
export const readImagePlatform = (): string | undefined => {
  try {
    // 旧版曾在没有能力列表时保存过平台值，无法判断其是否仍符合当前服务端能力。
    // 新版本使用独立键，旧值只清理不迁移，首次打开默认使用 Base64。
    window.localStorage.removeItem(LEGACY_STORAGE_KEY)
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
