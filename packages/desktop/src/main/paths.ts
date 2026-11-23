import { app } from "electron"
import { join } from "node:path"

/**
 * 主进程运行时用到的各个路径。
 *
 * 这里只解析应用自身需要的代码、日志和握手路径。
 * Core 的 workspace 与 dataDir 不在这里计算，它们由 Core 通过 Server 接口对外提供。
 * 打包后主进程的工作目录可能是任意位置（用户从 Finder 双击启动时甚至是根目录）；
 * startSidecar 会显式设置子进程 cwd。
 */

export interface MainPaths {
  /** sidecar 入口脚本的绝对路径 */
  sidecarEntry: string
  /** 预加载脚本的绝对路径 */
  preloadEntry: string
  /** 渲染层构建产物目录，由 app:// 协议映射出去 */
  rendererDir: string
  /** sidecar 启动目录，仅用于避免相对路径落进应用包。 */
  workingDirectory: string
  /** 日志文件位置 */
  logFile: string
  /** sidecar 就绪后写入的握手文件 */
  readyFile: string
}

export const resolveMainPaths = (): MainPaths => {
  // dist/main/index.cjs → 同级目录下找 preload 与 sidecar，上一级找 renderer
  const distDir = join(__dirname, "..")

  return {
    // 打包后 sidecar 被解包到 asar 之外：Node 无法直接执行 asar 归档里的脚本
    sidecarEntry: app.isPackaged
      ? join(process.resourcesPath, "app.asar.unpacked", "dist", "sidecar", "index.cjs")
      : join(distDir, "sidecar", "index.cjs"),
    preloadEntry: join(distDir, "preload", "index.cjs"),
    rendererDir: join(distDir, "renderer"),

    workingDirectory: app.getPath("home"),
    logFile: join(app.getPath("userData"), "logs", "easycode.log"),
    readyFile: join(app.getPath("temp"), `easycode-ready-${process.pid}.json`),
  }
}
