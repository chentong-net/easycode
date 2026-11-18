import assert from "node:assert/strict"
import { test } from "node:test"

import { CompactionProfile } from "@easycode/schema"

import {
  buildCompactionUserPrompt,
  hasRequiredCompactionHeadings,
  renderCompactionSystemPrompt,
} from "./compaction-prompt.js"

const profile = CompactionProfile.parse({
  schemaVersion: 1,
  id: "novel",
  revision: 1,
  builtIn: false,
  name: "小说创作",
  systemPrompt: "整理小说创作记忆。",
  includeTaskState: false,
  instructions: {
    initial: "整理新内容。",
    chunk: "整理当前分块。",
    merge: "合并已有内容。",
    correction: "请重新输出。",
  },
  sectionTitles: {
    previousSummary: "已有创作记忆",
    taskState: "当前任务状态",
    transcript: "待压缩创作历史",
    instruction: "压缩要求",
  },
  format: {
    type: "headings",
    headings: ["人物状态", "当前情节"],
  },
  createdAt: 0,
  updatedAt: 0,
})

test("system prompt 自动包含配置中的全部二级标题", () => {
  const system = renderCompactionSystemPrompt(profile)
  assert.match(system, /整理小说创作记忆/)
  assert.match(system, /## 人物状态/)
  assert.match(system, /## 当前情节/)
})

test("user prompt 按固定顺序组装已有摘要、任务、对话和要求", () => {
  const prompt = buildCompactionUserPrompt(profile, {
    previousSummary: "旧记忆",
    taskMemory: "任务状态",
    transcript: "新对话",
    instruction: "合并内容",
  })

  assert.ok(prompt.indexOf("# 已有创作记忆") < prompt.indexOf("# 当前任务状态"))
  assert.ok(prompt.indexOf("# 当前任务状态") < prompt.indexOf("# 待压缩创作历史"))
  assert.ok(prompt.indexOf("# 待压缩创作历史") < prompt.indexOf("# 压缩要求"))
})

test("缺省的任务状态不会生成空 section", () => {
  const prompt = buildCompactionUserPrompt(profile, {
    transcript: "对话",
    instruction: "整理",
  })
  assert.equal(prompt.includes("# 当前任务状态"), false)
})

test("输出校验只忽略未出现或格式不完整的标题", () => {
  assert.equal(hasRequiredCompactionHeadings(profile, "## 人物状态\nA\n## 当前情节\nB"), true)
  assert.equal(hasRequiredCompactionHeadings(profile, "人物状态\n当前情节"), false)
  assert.equal(hasRequiredCompactionHeadings(profile, "## 人物状态\nA"), false)
})
