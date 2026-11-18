import assert from "node:assert/strict"
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"

import {
  ensureRuntimeConfigFile,
  readStoredRuntimeConfig,
} from "./config.js"

let directory: string

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "easycode-config-test-"))
})

after(async () => {
  await rm(directory, { recursive: true, force: true })
})

test("旧 config.toml 迁移为 runtime.json 并保留可恢复备份", async () => {
  const configDirectory = join(directory, "config")
  const runtimeFile = join(configDirectory, "runtime.json")
  const legacyFile = join(directory, "config.toml")
  await writeFile(
    legacyFile,
    `[model]
base_url = "https://legacy.example.com/v1"
api_key = "legacy-key"
name = "legacy-model"
context_window = 32000
max_output_tokens = 4000

[web]
timeout_ms = 30000
max_response_bytes = 8388608

[runtime]
log_level = "warn"
`,
  )

  ensureRuntimeConfigFile(runtimeFile, legacyFile)

  const stored = readStoredRuntimeConfig(runtimeFile)
  assert.equal(stored.baseUrl, "https://legacy.example.com/v1")
  assert.equal(stored.model, "legacy-model")
  assert.equal(stored.logLevel, "warn")
  const raw = JSON.parse(await readFile(runtimeFile, "utf8")) as Record<string, unknown>
  assert.ok("model" in raw)
  assert.equal(
    (await readdir(directory)).some(
      (name) => name.startsWith("config.toml.migrated-") && name.endsWith(".bak"),
    ),
    true,
  )

  const before = await readFile(runtimeFile, "utf8")
  ensureRuntimeConfigFile(runtimeFile, legacyFile)
  assert.equal(await readFile(runtimeFile, "utf8"), before)
})
