import assert from "node:assert/strict"
import { test } from "node:test"

import type { Logger } from "../log.js"
import { createBuiltinTools } from "./builtin/index.js"
import { createToolRegistry } from "./registry.js"

const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => logger,
}

test("联网工具按当前模型配置动态加入工具定义", () => {
  const registry = createToolRegistry({
    tools: createBuiltinTools(),
    saveToolOutput: async () => "/tmp/tool-output",
    logger,
  })

  assert.equal(registry.has("websearch"), false)
  assert.equal(registry.has("webfetch"), false)

  const withWeb = registry.withWebConfig({
    timeoutMs: 30_000,
    maxResponseBytes: 1024,
    search: { provider: "deepseek", apiKey: "search-key" },
    fetch: { provider: "deepseek", apiKey: "fetch-key" },
  })
  const names = withWeb.definitions().map((definition) => definition.name)

  assert.ok(names.includes("websearch"))
  assert.ok(names.includes("webfetch"))
  assert.equal(withWeb.has("websearch"), true)
  assert.equal(withWeb.has("webfetch"), true)
})
