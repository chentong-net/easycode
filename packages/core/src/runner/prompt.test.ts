import assert from "node:assert/strict"
import { test } from "node:test"

import { buildMainSystemPrompt } from "./index.js"

test("主对话请求使用场景 BUILD 提示词并保持 baseline 顺序", () => {
  assert.deepEqual(
    buildMainSystemPrompt("你是小说创作助手。", "# 当前场景\n工作目录：/tmp"),
    ["你是小说创作助手。", "# 当前场景\n工作目录：/tmp"],
  )
})
