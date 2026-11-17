import assert from "node:assert/strict"
import { after, before, test } from "node:test"

import type { Core } from "@easycode/core"

import { createApplication } from "./app.js"

const token = "test-token"
const auth = { "x-easycode-token": token }

let application: Awaited<ReturnType<typeof createApplication>>

before(async () => {
  const logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    child: () => logger,
  }
  const core = {
    config: {
      model: "test-model",
      contextWindow: 128_000,
      maxOutputTokens: 8_192,
    },
    agents: {
      all: () => [{ id: "build", description: "test" }],
    },
    sessions: {
      get: async () => undefined,
    },
    images: {
      platforms: () => ({
        defaultPlatform: "base64",
        platforms: [{ platform: "base64", displayName: "Base64" }],
      }),
    },
  } as unknown as Core

  application = await createApplication({ core, token, logger })
})

after(async () => {
  await application.app.close()
})

test("health uses the success envelope", async () => {
  const response = await application.app.inject({
    method: "GET",
    url: "/api/health",
    headers: auth,
  })

  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json(), {
    code: 0,
    message: "SUCCESS",
    data: {
      ok: true,
      version: "0.13.0",
      model: "test-model",
      contextWindow: 128_000,
      maxOutputTokens: 8_192,
    },
  })
})

test("image platforms are loaded through the success envelope", async () => {
  const response = await application.app.inject({
    method: "GET",
    url: "/api/images/platforms",
    headers: auth,
  })

  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json(), {
    code: 0,
    message: "SUCCESS",
    data: {
      defaultPlatform: "base64",
      platforms: [{ platform: "base64", displayName: "Base64" }],
    },
  })
})

test("business failures use HTTP 200 and an error envelope", async () => {
  const response = await application.app.inject({
    method: "GET",
    url: "/api/sessions/missing",
    headers: auth,
  })

  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json(), {
    code: -1,
    message: "会话不存在：missing",
  })
})

test("request validation is treated as a business failure", async () => {
  const response = await application.app.inject({
    method: "POST",
    url: "/api/sessions",
    headers: { ...auth, "content-type": "application/json" },
    payload: {},
  })

  assert.equal(response.statusCode, 200)
  assert.equal(response.json().code, -1)
})

test("unknown routes use HTTP 404 and an error envelope", async () => {
  const response = await application.app.inject({
    method: "GET",
    url: "/api/unknown",
    headers: auth,
  })

  assert.equal(response.statusCode, 404)
  assert.deepEqual(response.json(), {
    code: -1,
    message: "未知接口：GET /api/unknown",
  })
})

test("authentication failures use HTTP 401 and an error envelope", async () => {
  const response = await application.app.inject({
    method: "GET",
    url: "/api/health",
  })

  assert.equal(response.statusCode, 401)
  assert.deepEqual(response.json(), {
    code: -1,
    message: "缺少或错误的访问令牌",
  })
})

test("invalid JSON remains a framework-level HTTP 400", async () => {
  const response = await application.app.inject({
    method: "POST",
    url: "/api/sessions",
    headers: { ...auth, "content-type": "application/json" },
    payload: "{",
  })

  assert.equal(response.statusCode, 400)
  assert.equal(response.json().code, -1)
})
