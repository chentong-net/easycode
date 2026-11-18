import assert from "node:assert/strict"
import { test } from "node:test"

import { buildRequestHeaders } from "./client.js"

test("空 API Key 不发送 Authorization，允许 Ollama 等本地服务", () => {
  const headers = buildRequestHeaders(
    {
      baseUrl: "http://localhost:11434/v1",
      apiKey: "",
    },
    { sessionID: "session" },
  )
  assert.equal("authorization" in headers, false)
  assert.equal(headers["x-session-id"], "session")
})

test("配置 API Key 时发送 Bearer Authorization", () => {
  const headers = buildRequestHeaders(
    {
      baseUrl: "https://example.com/v1",
      apiKey: "secret",
    },
    {},
  )
  assert.equal(headers.authorization, "Bearer secret")
})
