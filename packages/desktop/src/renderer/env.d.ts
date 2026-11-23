/**
 * 预加载脚本注入到 window 上的桥接对象。
 *
 * 这里只声明类型，不做任何运行时代码：真正的注入发生在 preload 里。
 * 除了系统文件和目录选择之外，渲染层与 Core 的交互
 * 全部通过 HTTP 接口完成。
 */
export interface EasyCodeBridge {
  /** Core 服务基础地址，例如 http://127.0.0.1:53421 */
  serverUrl: string
  /** 访问令牌 */
  serverToken: string
  /** 运行平台，取值同 Node 的 process.platform */
  platform: string
  /** 打开系统原生的目录选择框；用户取消时返回 undefined */
  selectDirectory(request?: { defaultPath?: string }): Promise<string | undefined>
  /** 打开系统原生的多图选择框；用户取消时返回空数组 */
  selectImages(request?: { defaultPath?: string }): Promise<Array<{ path: string; preview?: string }>>
  /** 将剪贴板图片保存到临时文件，保持 Core 侧仍只接收路径 */
  saveClipboardImage(request: {
    mime: string
    data: ArrayBuffer
  }): Promise<{ path: string; preview?: string }>
  /** 重启桌面应用，让保存后的运行配置重新加载 */
  restartApp(): Promise<void>
}

declare global {
  interface Window {
    /**
     * 由预加载脚本注入。
     *
     * 声明为可选：在浏览器里直接打开渲染层页面时它不存在，
     * 界面需要能识别这种情况并给出提示，而不是抛出一个类型上不可能出现的错误。
     */
    easycode?: EasyCodeBridge
  }
}
