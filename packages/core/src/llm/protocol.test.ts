import assert from "node:assert/strict"
import { test } from "node:test"

import { buildRequestBody } from "./protocol.js"

const request = {
  model: "test-model",
  system: [],
  messages: [],
  tools: [],
}

test("未配置 reasoning level 时不发送 reasoning_effort", () => {
  const body = buildRequestBody(request)
  assert.equal("reasoning_effort" in body, false)
})

test("显式 reasoning level 包括 none 都原样发送", () => {
  assert.equal(buildRequestBody({ ...request, reasoningEffort: "none" }).reasoning_effort, "none")
  assert.equal(buildRequestBody({ ...request, reasoningEffort: "high" }).reasoning_effort, "high")
})
