import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"

import type { Logger } from "../log.js"
import { createImageServiceRegistry } from "./index.js"
import type { ImageService } from "./types.js"

const logs: Array<{ message: string; data?: unknown }> = []
const logger: Logger = {
  debug: (message, data) => logs.push({ message, data }),
  info: (message, data) => logs.push({ message, data }),
  warn: (message, data) => logs.push({ message, data }),
  error: (message, data) => logs.push({ message, data }),
  child: () => logger,
}

let directory: string
let imagePath: string

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "easycode-image-test-"))
  imagePath = join(directory, "pixel.png")
  await writeFile(
    imagePath,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  )
})

after(async () => {
  await rm(directory, { recursive: true, force: true })
})

test("missing and unknown adapters fall back to Base64", async () => {
  const registry = createImageServiceRegistry({
    logger,
  })

  const missing = await registry.prepare(undefined, { path: imagePath })
  assert.equal(missing.adapter, "base64")
  assert.equal(missing.fallback, true)
  assert.equal(missing.content.type, "image_url")

  const unknown = await registry.prepare("unknown-adapter", { path: imagePath })
  assert.equal(unknown.adapter, "base64")
  assert.equal(unknown.fallback, true)
  assert.equal(unknown.requestedPlatform, "unknown-adapter")

  assert.ok(
    logs.some(
      (entry) =>
        entry.message === "图片准备完成" &&
        (entry.data as { adapter?: string } | undefined)?.adapter === "base64",
    ),
  )

  assert.deepEqual(registry.platforms(), {
    defaultPlatform: "base64",
    platforms: [
      { platform: "base64", displayName: "Base64" },
      { platform: "deepseek-files", displayName: "DeepSeek Files API" },
    ],
  })
})

test("adapter execution failures are returned without fallback", async () => {
  const failing: ImageService = {
    platform: "failing",
    displayName: "Failing",
    async prepare() {
      throw new Error("adapter failed")
    },
  }
  const registry = createImageServiceRegistry({
    logger,
    adapters: [failing],
  })

  await assert.rejects(
    registry.prepare("failing", { path: imagePath }),
    /adapter failed/,
  )
})

test("DeepSeek Files 使用请求携带的模型配置", async () => {
  const originalFetch = globalThis.fetch
  let requestedURL = ""
  let requestedHeaders: Record<string, string> | undefined
  let requestedBody: FormData | undefined
  globalThis.fetch = (async (input, init) => {
    requestedURL = String(input)
    requestedHeaders = init?.headers as Record<string, string> | undefined
    requestedBody = init?.body as FormData
    return new Response(JSON.stringify({ id: "file_test" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }) as typeof fetch

  try {
    const registry = createImageServiceRegistry({ logger })
    const result = await registry.prepare(
      "deepseek-files",
      { path: imagePath },
      {
        baseUrl: "https://api.deepseek.com/",
        apiKey: "selected-key",
        model: "deepseek-flash",
        headers: { "x-test": "selected" },
      },
    )

    assert.equal(result.adapter, "deepseek-files")
    assert.deepEqual(result.content, { type: "file", file_id: "file_test" })
    assert.equal(requestedURL, "https://api.deepseek.com/files")
    assert.equal(requestedBody?.get("purpose"), "user_data")
    assert.equal(
      requestedHeaders?.authorization,
      "Bearer selected-key",
    )
    assert.equal(requestedHeaders?.["x-test"], "selected")
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("duplicate adapter identifiers fail registration", () => {
  const duplicate: ImageService = {
    platform: "base64",
    displayName: "Duplicate Base64",
    async prepare() {
      throw new Error("unused")
    },
  }

  assert.throws(
    () =>
      createImageServiceRegistry({
        logger,
        adapters: [duplicate],
      }),
    /重复的图片 Adapter/,
  )
})
