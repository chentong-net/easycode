import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"

import type { PromptProfileDraft } from "@easycode/schema"

import { BUILD_SYSTEM_PROMPT } from "../agent.js"
import type { Logger } from "../log.js"
import {
  createPromptProfileService,
  LEGACY_PROMPT_PROFILE_DIRECTORY,
  PROMPT_PROFILE_DIRECTORY,
} from "./index.js"

const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => logger,
}

const draft = {
  name: "小说创作",
  description: "用于长篇小说",
  systemPrompt: "你是小说创作助手。",
  compactionSystemPrompt: "把对话整理成小说创作记忆。",
  compactionHeadings: ["人物状态", "当前情节", "下一步"],
} satisfies PromptProfileDraft

let directory: string

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "easycode-prompt-profile-test-"))
})

after(async () => {
  await rm(directory, { recursive: true, force: true })
})

test("内置编程配置始终存在、时间为零且不可修改或删除", async () => {
  const service = createPromptProfileService({ dataDir: directory, logger })
  const profiles = await service.list()

  assert.equal(profiles[0]?.id, "coding")
  const coding = await service.require("coding")
  assert.equal(coding.systemPrompt, BUILD_SYSTEM_PROMPT)
  assert.equal(coding.createdAt, 0)
  assert.equal(coding.updatedAt, 0)
  await assert.rejects(service.update("coding", draft), /不能修改/)
  await assert.rejects(service.delete("coding"), /不能删除/)
})

test("自定义配置写入 prompt 目录，omit 已移除字段", async () => {
  const service = createPromptProfileService({ dataDir: directory, logger })
  const created = await service.create(draft)

  assert.match(
    created.id,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  )
  assert.equal(created.createdAt, created.updatedAt)
  assert.equal((await service.require(created.id)).name, draft.name)

  const raw = JSON.parse(
    await readFile(
      join(directory, PROMPT_PROFILE_DIRECTORY, `${created.id}.json`),
      "utf8",
    ),
  ) as Record<string, unknown>
  assert.equal(raw.id, created.id)
  assert.equal(raw.systemPrompt, draft.systemPrompt)
  assert.equal("schemaVersion" in raw, false)
  assert.equal("revision" in raw, false)
  assert.equal("builtIn" in raw, false)
  assert.equal("instructions" in raw, false)
  assert.equal("format" in raw, false)
})

test("更新时间只在内容实际变化时推进", async () => {
  const service = createPromptProfileService({ dataDir: directory, logger })
  const created = await service.create({ ...draft, name: "更新时间测试" })

  await new Promise((resolve) => setTimeout(resolve, 5))
  const unchanged = await service.update(created.id, { ...draft, name: "更新时间测试" })
  assert.equal(unchanged.updatedAt, created.updatedAt)

  await new Promise((resolve) => setTimeout(resolve, 5))
  const changed = await service.update(created.id, {
    ...draft,
    name: "更新时间测试",
    description: "已修改",
  })
  assert.equal(changed.id, created.id)
  assert.equal(changed.createdAt, created.createdAt)
  assert.ok(changed.updatedAt > created.updatedAt)
})

test("旧 compaction-profile 配置会迁移字段和目录", async () => {
  const service = createPromptProfileService({ dataDir: directory, logger })
  const id = randomUUID()
  const legacyDirectory = join(directory, LEGACY_PROMPT_PROFILE_DIRECTORY)
  await mkdir(legacyDirectory, { recursive: true })
  await writeFile(
    join(legacyDirectory, `${id}.json`),
    JSON.stringify({
      id,
      name: "迁移测试",
      description: "旧配置",
      agentSystemPrompt: "旧主对话提示词",
      systemPrompt: "旧摘要提示词",
      includeTaskState: true,
      instructions: {
        initial: "旧 initial",
        chunk: "旧 chunk",
        merge: "旧 merge",
        correction: "旧 correction",
      },
      sectionTitles: {
        previousSummary: "旧摘要",
        taskState: "旧任务",
        transcript: "旧对话",
        instruction: "旧要求",
      },
      format: { type: "headings", headings: ["人物状态", "当前情节"] },
      createdAt: 1,
      updatedAt: 2,
    }),
  )

  const migrated = await service.require(id)
  assert.equal(migrated.systemPrompt, "旧主对话提示词")
  assert.equal(migrated.compactionSystemPrompt, "旧摘要提示词")
  assert.deepEqual(migrated.compactionHeadings, ["人物状态", "当前情节"])
  assert.equal(migrated.createdAt, 1)
  assert.equal(migrated.updatedAt, 2)

  const currentFiles = await readdir(join(directory, PROMPT_PROFILE_DIRECTORY))
  assert.ok(currentFiles.includes(`${id}.json`))
  const migratedRaw = await readFile(
    join(directory, PROMPT_PROFILE_DIRECTORY, `${id}.json`),
    "utf8",
  )
  assert.equal(migratedRaw.includes("agentSystemPrompt"), false)
  assert.equal(migratedRaw.includes("instructions"), false)
})

test("旧配置缺少主对话提示词时使用 BUILD 默认值", async () => {
  const service = createPromptProfileService({ dataDir: directory, logger })
  const id = randomUUID()
  const legacyDirectory = join(directory, LEGACY_PROMPT_PROFILE_DIRECTORY)
  await mkdir(legacyDirectory, { recursive: true })
  await writeFile(
    join(legacyDirectory, `${id}.json`),
    JSON.stringify({
      name: "缺省测试",
      systemPrompt: "摘要提示词",
      format: { type: "headings", headings: ["状态"] },
      createdAt: 1,
      updatedAt: 1,
    }),
  )

  const loaded = await service.require(id)
  assert.equal(loaded.systemPrompt, BUILD_SYSTEM_PROMPT)
  assert.equal(loaded.compactionSystemPrompt, "摘要提示词")
})

test("删除后从列表和详情中立即消失", async () => {
  const service = createPromptProfileService({ dataDir: directory, logger })
  const created = await service.create({ ...draft, name: "待删除" })

  await service.delete(created.id)
  assert.equal(await service.get(created.id), undefined)
  assert.equal(
    (await service.list()).some((profile) => profile.id === created.id),
    false,
  )
})

test("无效用户文件不会阻止其它配置加载", async () => {
  const service = createPromptProfileService({ dataDir: directory, logger })
  const profileDirectory = join(directory, PROMPT_PROFILE_DIRECTORY)
  await mkdir(profileDirectory, { recursive: true })
  await writeFile(join(profileDirectory, "broken.json"), "{")

  const profiles = await service.list()
  assert.ok(profiles.some((profile) => profile.id === "coding"))
  assert.equal(profiles.some((profile) => profile.id === "broken"), false)
})
