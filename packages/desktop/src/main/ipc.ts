import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"

import { app, dialog, ipcMain, nativeImage, type NativeImage } from "electron"

import {
  IPC_RESTART_APP,
  IPC_SELECT_DIRECTORY,
  IPC_SELECT_IMAGES,
  IPC_SAVE_CLIPBOARD_IMAGE,
  type ImageSelection,
  type SaveClipboardImageRequest,
  type SelectDirectoryRequest,
  type SelectImagesRequest,
} from "../shared/ipc"
import { log } from "./log"

/**
 * 主进程侧唯一的一处 IPC。
 *
 * 提供只能在宿主侧完成的能力：目录/图片选择、剪贴板图片落盘和应用重启。
 *
 * 通道只注册一次，且在 app ready 之后调用。
 */
export const registerIpcHandlers = (): void => {
  ipcMain.handle(IPC_SELECT_DIRECTORY, async (_event, request?: SelectDirectoryRequest): Promise<string | undefined> => {
    const defaultPath = resolveDefaultPath(request?.defaultPath)
    log.debug("打开目录选择弹窗", { defaultPath })

    const result = await dialog.showOpenDialog({
      title: "选择工作目录",
      buttonLabel: "选择",
      // createDirectory 让用户可以直接在弹窗里新建目录，
      // 否则第一次使用时会因为目标目录还不存在而无从下手
      properties: ["openDirectory", "createDirectory"],
      ...(defaultPath === undefined ? {} : { defaultPath }),
    })

    if (result.canceled || result.filePaths.length === 0) {
      log.debug("用户取消了目录选择")
      return undefined
    }

    const selected = result.filePaths[0]
    log.info("用户选择了工作目录", { directory: selected })
    return selected
  })

  ipcMain.handle(IPC_SELECT_IMAGES, async (_event, request?: SelectImagesRequest): Promise<ImageSelection[]> => {
    const defaultPath = resolveDefaultPath(request?.defaultPath)
    log.debug("打开图片选择弹窗", { defaultPath })

    const result = await dialog.showOpenDialog({
      title: "选择图片",
      buttonLabel: "选择",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "图片", extensions: ["jpg", "jpeg", "png", "gif", "webp"] }],
      ...(defaultPath === undefined ? {} : { defaultPath }),
    })

    if (result.canceled || result.filePaths.length === 0) {
      log.debug("用户取消了图片选择")
      return []
    }

    const selected = result.filePaths.map((path) => toImageSelection(path))
    log.info("用户选择了图片", { count: selected.length, files: selected.map((item) => item.path) })
    return selected
  })

  ipcMain.handle(
    IPC_SAVE_CLIPBOARD_IMAGE,
    async (_event, request: SaveClipboardImageRequest): Promise<ImageSelection> => {
      const extension = clipboardImageExtension(request.mime)
      if (extension === undefined) throw new Error(`不支持粘贴的图片格式：${request.mime}`)

      const data = Buffer.from(request.data)
      if (data.byteLength > MAX_CLIPBOARD_IMAGE_BYTES) {
        throw new Error("粘贴的图片超过 64 MiB 上限")
      }

      const directory = join(app.getPath("temp"), "easycode", "clipboard")
      await mkdir(directory, { recursive: true, mode: 0o700 })
      const path = join(directory, `${randomUUID()}.${extension}`)
      await writeFile(path, data, { mode: 0o600 })
      log.info("剪贴板图片已保存", { file: path, bytes: data.byteLength, mime: request.mime })
      const preview = previewDataURL(nativeImage.createFromBuffer(data))
      return { path, ...(preview === undefined ? {} : { preview }) }
    },
  )

  ipcMain.handle(IPC_RESTART_APP, async (): Promise<void> => {
    log.info("用户请求重启应用以应用配置")
    setImmediate(() => {
      app.relaunch()
      app.quit()
    })
  })
}

const MAX_CLIPBOARD_IMAGE_BYTES = 64 * 1024 * 1024

const clipboardImageExtension = (mime: string): string | undefined => {
  switch (mime) {
    case "image/jpeg":
      return "jpg"
    case "image/png":
      return "png"
    case "image/gif":
      return "gif"
    case "image/webp":
      return "webp"
    default:
      return undefined
  }
}

const toImageSelection = (path: string): ImageSelection => {
  const preview = previewDataURL(nativeImage.createFromPath(path))
  return { path, ...(preview === undefined ? {} : { preview }) }
}

const previewDataURL = (image: NativeImage): string | undefined => {
  if (image.isEmpty()) return undefined
  const size = image.getSize()
  if (size.width <= 0 || size.height <= 0) return undefined
  const scale = Math.min(160 / size.width, 160 / size.height)
  const resized = image.resize({
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
    quality: "good",
  })
  return resized.toDataURL()
}

/** 展开 `~` 并回退到最近的已存在目录：起始目录不存在时弹窗会打开在奇怪的位置。 */
const resolveDefaultPath = (value: string | undefined): string | undefined => {
  if (value === undefined || value.length === 0) return undefined

  const expanded = value === "~" ? homedir() : value.startsWith("~/") ? resolve(homedir(), value.slice(2)) : value

  let current = expanded
  while (!existsSync(current)) {
    const parent = dirname(current)
    // 已经到根目录还是不存在，只能交给系统决定打开位置
    if (parent === current) return undefined
    current = parent
  }
  return current
}
