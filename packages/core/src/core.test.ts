import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import { EASYCODE_HOME_DIR, type CoreConfig, type Logger } from "./index.js"
import { createCore } from "./core.js"

const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => logger,
}

test("runtimeInfo、initialize 和 status 使用 Core 的默认路径", async () => {
  const directory = await mkdtemp(join(tmpdir(), "easycode-core-runtime-test-"))
  const config = testConfig(directory)
  const core = createCore({ config, logger })

  try {
    assert.deepEqual(core.runtimeInfo(), {
      workspaceDirectory: EASYCODE_HOME_DIR,
      dataDir: config.dataDir,
    })
    assert.deepEqual(await core.status(), {
      initialized: false,
      storageReady: false,
      modelConfigured: false,
      ready: false,
    })

    await core.initialize()
    await core.initialize()

    assert.deepEqual(await core.status(), {
      initialized: true,
      storageReady: true,
      modelConfigured: true,
      ready: true,
    })
  } finally {
    await core.shutdown()
    await rm(directory, { recursive: true, force: true })
  }
})

const testConfig = (directory: string): CoreConfig => ({
  baseUrl: "https://example.com/v1",
  apiKey: "test",
  model: "test-model",
  contextWindow: 128_000,
  maxOutputTokens: 8_192,
  headers: {},
  configName: "测试配置",
  supportedReasoningEfforts: [],
  revision: 1,
  createdAt: 1,
  updatedAt: 1,
  web: {
    timeoutMs: 30_000,
    maxResponseBytes: 1024,
    search: { apiKey: "" },
    fetch: { apiKey: "" },
  },
  logLevel: "error",
  configFile: join(directory, "config.toml"),
  dataDir: join(directory, "data"),
  modelConfigured: true,
})
