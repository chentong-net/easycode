import assert from "node:assert/strict"
import { test } from "node:test"

import { PromptProfile } from "@easycode/schema"

import {
  COMPACTION_SECTION_TITLES,
  CompactionPromptBuilder,
  renderCompactionSystemPrompt,
} from "./compaction-prompt.js"

const profile = PromptProfile.parse({
  id: "novel",
  name: "小说创作",
  systemPrompt: "你是小说创作助手。",
  compactionSystemPrompt: "整理小说创作记忆。",
  compactionHeadings: ["人物状态", "当前情节"],
  createdAt: 0,
  updatedAt: 0,
})

test("system prompt 包含场景规则和全部输出标题", () => {
  const system = renderCompactionSystemPrompt(profile)
  assert.match(system, /整理小说创作记忆/)
  assert.match(system, /## 人物状态/)
  assert.match(system, /## 当前情节/)
  assert.match(system, /输出一份新的、完整的 checkpoint/)
})

test("builder 按添加顺序组装 section 并省略空内容", () => {
  const prompt = new CompactionPromptBuilder()
    .addSection(COMPACTION_SECTION_TITLES.previousSummary, () => "旧记忆")
    .addSection("额外上下文", () => "")
    .addSection(COMPACTION_SECTION_TITLES.transcript, () => "新对话")
    .build()

  assert.equal(
    prompt,
    [
      `# ${COMPACTION_SECTION_TITLES.previousSummary}`,
      "旧记忆",
      "",
      `# ${COMPACTION_SECTION_TITLES.transcript}`,
      "新对话",
    ].join("\n"),
  )
  assert.equal(prompt.includes("# 额外上下文"), false)
})

test("section 回调在一个 builder 中只执行一次", () => {
  let calls = 0
  const builder = new CompactionPromptBuilder().addSection("额外上下文", () => {
    calls += 1
    return "内容"
  })

  assert.equal(builder.build(), "# 额外上下文\n内容")
  assert.equal(builder.build(), "# 额外上下文\n内容")
  assert.equal(calls, 1)
})

test("section 标题非法或重复时立即失败", () => {
  const builder = new CompactionPromptBuilder().addSection("额外上下文", () => "内容")
  assert.throws(
    () => builder.addSection("额外上下文", () => "重复"),
    /标题重复/,
  )
  assert.throws(
    () => builder.addSection("# 额外上下文", () => "带井号"),
    /不需要填写 Markdown/,
  )
  assert.throws(
    () => builder.addSection("多行\n标题", () => "不能包含换行"),
    /不能包含换行/,
  )
})
