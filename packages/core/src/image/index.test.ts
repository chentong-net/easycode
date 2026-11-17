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
    baseUrl: "https://example.com",
    apiKey: "test",
    model: "test",
    headers: {},
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
})

test("adapter execution failures are returned without fallback", async () => {
  const failing: ImageService = {
    platform: "failing",
    async prepare() {
      throw new Error("adapter failed")
    },
  }
  const registry = createImageServiceRegistry({
    baseUrl: "https://example.com",
    apiKey: "test",
    model: "test",
    headers: {},
    logger,
    adapters: [failing],
  })

  await assert.rejects(
    registry.prepare("failing", { path: imagePath }),
    /adapter failed/,
  )
})

test("duplicate adapter identifiers fail registration", () => {
  const duplicate: ImageService = {
    platform: "base64",
    async prepare() {
      throw new Error("unused")
    },
  }

  assert.throws(
    () =>
      createImageServiceRegistry({
        baseUrl: "https://example.com",
        apiKey: "test",
        model: "test",
        headers: {},
        logger,
        adapters: [duplicate],
      }),
    /重复的图片 Adapter/,
  )
})
