import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"

import {
  COMPACTION_PROFILE_DIRECTORY,
  createCompactionProfileService,
} from "./index.js"
import { BUILD_SYSTEM_PROMPT } from "../agent.js"
import type { Logger } from "../log.js"

const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => logger,
}

let directory: string

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "easycode-compaction-profile-test-"))
})

after(async () => {
  await rm(directory, { recursive: true, force: true })
})

const draft = {
  name: "小说创作",
  description: "用于长篇小说",
  agentSystemPrompt: "你是小说创作助手。",
  systemPrompt: "把对话整理成小说创作记忆。",
  includeTaskState: false,
  instructions: {
    initial: "整理成创作记忆。",
    chunk: "先整理这一段。",
    merge: "合并已有创作记忆。",
    correction: "请按标题重新输出。",
  },
  sectionTitles: {
    previousSummary: "已有创作记忆",
    taskState: "当前任务状态",
    transcript: "待压缩历史",
    instruction: "压缩要求",
  },
  format: {
    type: "headings" as const,
    headings: ["人物状态", "当前情节", "下一步"],
  },
}

test("内置 Coding 始终存在且不可修改或删除", async () => {
  const service = createCompactionProfileService({ dataDir: directory, logger })

  assert.equal((await service.list())[0]?.id, "coding")
  const coding = await service.require("coding")
  assert.equal(coding.builtIn, true)
  assert.equal(coding.agentSystemPrompt, BUILD_SYSTEM_PROMPT)
  await assert.rejects(service.update("coding", draft), /不能修改/)
  await assert.rejects(service.delete("coding"), /不能删除/)
})

test("自定义配置写入后立即可读，更新会增加 revision，删除后立即消失", async () => {
  const service = createCompactionProfileService({ dataDir: directory, logger })
  const created = await service.create(draft)

  assert.equal(created.revision, 1)
  assert.equal(created.builtIn, false)
  assert.equal((await service.require(created.id)).name, "小说创作")

  const raw = JSON.parse(
    await readFile(join(directory, COMPACTION_PROFILE_DIRECTORY, `${created.id}.json`), "utf8"),
  ) as { id: string; name: string }
  assert.equal(raw.id, created.id)
  assert.equal(raw.name, "小说创作")

  const updated = await service.update(created.id, { ...draft, name: "长篇小说创作" })
  assert.equal(updated.id, created.id)
  assert.equal(updated.revision, 2)
  assert.equal(updated.name, "长篇小说创作")

  await service.delete(created.id)
  assert.equal(await service.get(created.id), undefined)
  assert.deepEqual(
    (await service.list()).map((profile) => profile.id),
    ["coding"],
  )
})

test("旧配置缺少会话系统提示词时自动使用 BUILD 默认值", async () => {
  const service = createCompactionProfileService({ dataDir: directory, logger })
  const id = randomUUID()
  const profileDirectory = join(directory, COMPACTION_PROFILE_DIRECTORY)
  await mkdir(profileDirectory, { recursive: true })
  await writeFile(
    join(profileDirectory, `${id}.json`),
    JSON.stringify({
      ...draft,
      schemaVersion: 1,
      id,
      revision: 2,
      builtIn: false,
      createdAt: 1,
      updatedAt: 2,
      agentSystemPrompt: undefined,
    }),
  )

  const loaded = await service.require(id)
  assert.equal(loaded.agentSystemPrompt, BUILD_SYSTEM_PROMPT)
})

test("无效用户文件不会阻止其它配置加载", async () => {
  const service = createCompactionProfileService({ dataDir: directory, logger })
  const profileDirectory = join(directory, COMPACTION_PROFILE_DIRECTORY)
  await writeFile(join(profileDirectory, "broken.json"), "{")

  const profiles = await service.list()
  assert.ok(profiles.some((profile) => profile.id === "coding"))
  assert.equal(profiles.some((profile) => profile.id === "broken"), false)
})
