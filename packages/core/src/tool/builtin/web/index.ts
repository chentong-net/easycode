import { createLogger } from "../../../log.js"
import type { Tool } from "../../tool.js"
import { resolveWebToolConfig } from "./config.js"
import { createFetchService, createSearchService } from "./providers.js"
import type { CoreWebConfig } from "./types.js"
import { createWebFetchTool } from "./webfetch.js"
import { createWebSearchTool } from "./websearch.js"

/** 根据当前 TOML 配置中的联网设置返回可用工具。 */
export const createWebTools = (webConfig: CoreWebConfig): Tool<unknown>[] => {
  const config = resolveWebToolConfig(webConfig)
  if (!config) return []

  const logger = createLogger("tool.web")
  const tools: Tool<unknown>[] = []
  if (config.search) {
    tools.push(createWebSearchTool(createSearchService(config.search, config, logger)))
  }
  if (config.fetch) {
    tools.push(createWebFetchTool(createFetchService(config.fetch, config, logger)))
  }
  return tools
}
