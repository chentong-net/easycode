import assert from "node:assert/strict"
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"

import {
  ensureConfigFiles,
  readStoredRuntimeConfig,
} from "./config.js"

let directory: string

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "easycode-config-test-"))
})

after(async () => {
  await rm(directory, { recursive: true, force: true })
})

test("旧 config.toml 迁移为单个 ID.toml 并保留备份", async () => {
  const root = join(directory, "legacy-toml")
  await mkdir(root, { recursive: true })
  const configDirectory = join(root, "config")
  const legacyFile = join(root, "config.toml")
  const legacyJson = join(configDirectory, "runtime.json")
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

  const configFile = ensureConfigFiles(configDirectory, legacyFile, legacyJson)
  assert.match(configFile, /[/\\][0-9a-f-]+\.toml$/)
  const stored = readStoredRuntimeConfig(configFile)
  assert.equal(stored.baseUrl, "https://legacy.example.com/v1")
  assert.equal(stored.model, "legacy-model")
  assert.equal(stored.logLevel, "warn")
  assert.equal(
    (await readdir(root)).some(
      (name) => name.startsWith("config.toml.migrated-") && name.endsWith(".bak"),
    ),
    true,
  )

  assert.equal(ensureConfigFiles(configDirectory, legacyFile, legacyJson), configFile)
})

test("中间 JSON 版本迁移到 TOML 并保留模型级别", async () => {
  const root = join(directory, "legacy-json")
  const configDirectory = join(root, "config")
  await mkdir(configDirectory, { recursive: true })
  const legacyToml = join(root, "config.toml")
  const legacyJson = join(configDirectory, "runtime.json")
  await writeFile(
    legacyJson,
    JSON.stringify(
      {
        model: {
          base_url: "https://json.example.com/v1",
          api_key: "json-key",
          name: "json-model",
          context_window: 64000,
          max_output_tokens: 8000,
        },
        web: { timeout_ms: 30000, max_response_bytes: 8388608 },
        runtime: { log_level: "info" },
      },
      null,
      2,
    ),
  )
  const modelId = "12345678-1234-4123-8123-123456789abc"
  await writeFile(
    join(configDirectory, `${modelId}.json`),
    JSON.stringify({
      schemaVersion: 1,
      id: modelId,
      revision: 3,
      name: "推理模型",
      baseUrl: "https://json.example.com/v1",
      model: "reasoning-model",
      apiKey: "json-key",
      headers: {},
      contextWindow: 64000,
      maxOutputTokens: 8000,
      supportedReasoningEfforts: ["low", "high"],
      createdAt: 2,
      updatedAt: 3,
    }),
  )
  const secondId = "abcdef12-1234-4123-8123-123456789abc"
  await writeFile(
    join(configDirectory, `${secondId}.json`),
    JSON.stringify({
      schemaVersion: 1,
      id: secondId,
      revision: 1,
      name: "第二模型",
      baseUrl: "http://localhost:11434/v1",
      model: "ollama-model",
      apiKey: "",
      headers: {},
      contextWindow: 32000,
      maxOutputTokens: 4000,
      supportedReasoningEfforts: ["none"],
      createdAt: 4,
      updatedAt: 4,
    }),
  )

  const configFile = ensureConfigFiles(configDirectory, legacyToml, legacyJson)
  assert.equal(configFile, join(configDirectory, `${modelId}.toml`))
  const stored = readStoredRuntimeConfig(join(configDirectory, `${modelId}.toml`))
  assert.equal(stored.configName, "推理模型")
  assert.equal(stored.model, "reasoning-model")
  assert.deepEqual(stored.supportedReasoningEfforts, ["low", "high"])
  const files = await readdir(configDirectory)
  assert.equal(files.filter((name) => name.endsWith(".toml")).length, 2)
  assert.equal(files.includes(`${secondId}.toml`), true)
  assert.equal(files.includes("runtime.json"), false)
  assert.equal(
    files.some((name) => name.startsWith("runtime.json.migrated-") && name.endsWith(".bak")),
    true,
  )
})
