/**
 * 预加载脚本注入信息的访问层。
 *
 * 界面里所有对 `window.easycode` 的直接访问都收在这里，好处有两个：
 * - 桥接对象是可选的（在浏览器里直接打开页面时不存在），集中处理一次即可，
 *   不必在每个用到的地方都写一遍可空判断
 * - 目录选择与图片选择这类「和宿主环境相关」的逻辑有了唯一的归属地
 */

const bridge = window.easycode

/** 是否运行在桌面端外壳里。为假时界面只能展示无法工作的提示。 */
export const hasHost = bridge !== undefined && bridge.serverUrl.length > 0

/** 运行平台，取值同 Node 的 process.platform */
export const platform = bridge?.platform ?? "unknown"

/**
 * 打开系统原生的目录选择框。
 *
 * 用户取消时返回 undefined。沙箱里的网页没有标准 API 唤起系统弹窗，
 * 也无法拿到用户选中的绝对路径。
 */
export const selectDirectory = async (defaultPath?: string): Promise<string | undefined> => {
  if (bridge === undefined) return undefined
  return bridge.selectDirectory(defaultPath === undefined ? {} : { defaultPath })
}

/** 打开系统原生的多图选择框，返回路径和主进程生成的小尺寸预览。 */
export const selectImages = async (
  defaultPath?: string,
): Promise<Array<{ path: string; preview?: string }>> => {
  if (bridge === undefined) return []
  return bridge.selectImages(defaultPath === undefined ? {} : { defaultPath })
}

/** 把粘贴的图片字节保存成临时文件，Renderer 不直接写本地文件。 */
export const saveClipboardImage = async (file: File): Promise<{ path: string; preview?: string }> => {
  if (bridge === undefined) throw new Error("当前环境不支持粘贴图片")
  return bridge.saveClipboardImage({
    mime: file.type,
    data: await file.arrayBuffer(),
  })
}

/** 重启桌面应用；浏览器预览模式下不支持。 */
export const restartApp = async (): Promise<void> => {
  if (bridge === undefined) return
  await bridge.restartApp()
}
