import assert from "node:assert/strict"
import { after, before, test } from "node:test"

import type { Core } from "@easycode/core"

import { createApplication } from "./app.js"

const token = "test-token"
const auth = { "x-easycode-token": token }
const codingProfile = {
  id: "coding",
  name: "Coding",
  description: "默认编程与代码修改场景",
  systemPrompt: "你是一个编程助手。",
  compactionSystemPrompt: "整理编程记忆",
  compactionHeadings: ["目标", "下一步"],
  createdAt: 0,
  updatedAt: 0,
}

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
    promptProfiles: {
      list: async () => [codingProfile],
      require: async (id: string) => {
        if (id === "coding") return codingProfile
        throw new Error(`提示配置不存在：${id}`)
      },
      create: async (input: { name: string }) => ({
        ...codingProfile,
        id: "custom",
        name: input.name,
      }),
      update: async () => {
        throw new Error("内置 Coding 提示配置不能修改")
      },
      get: async (id: string) => (id === "coding" ? codingProfile : undefined),
      delete: async () => {
        throw new Error("内置 Coding 提示配置不能删除")
      },
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
      version: "0.16.0",
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

test("prompt profile list only exposes summaries", async () => {
  const response = await application.app.inject({
    method: "GET",
    url: "/api/prompt-profiles",
    headers: auth,
  })

  assert.equal(response.statusCode, 200)
  const data = response.json().data as Array<Record<string, unknown>>
  assert.deepEqual(data[0], {
    id: "coding",
    name: "Coding",
    description: "默认编程与代码修改场景",
    createdAt: 0,
    updatedAt: 0,
  })
  assert.equal("systemPrompt" in data[0]!, false)
  assert.equal("compactionSystemPrompt" in data[0]!, false)
  assert.equal("revision" in data[0]!, false)
  assert.equal("builtIn" in data[0]!, false)
})

test("built-in prompt profile cannot be deleted", async () => {
  const response = await application.app.inject({
    method: "DELETE",
    url: "/api/prompt-profiles/coding",
    headers: auth,
  })

  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json(), {
    code: -1,
    message: "内置 Coding 提示配置不能删除",
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
