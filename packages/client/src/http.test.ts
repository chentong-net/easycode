import assert from "node:assert/strict"
import { test } from "node:test"

import {
  ApiCallError,
  HealthResponse,
  ProtocolError,
} from "@easycode/protocol"

import { parseEnvelopeData } from "./http.js"

test("successful envelopes return validated data", () => {
  const data = parseEnvelopeData(
    HealthResponse,
    {
      code: 0,
      message: "SUCCESS",
      data: {
        ok: true,
        version: "0.18.0",
        model: "test",
        contextWindow: 128_000,
        maxOutputTokens: 8_192,
      },
    },
    "/api/health",
  )

  assert.equal(data.model, "test")
})

test("business error envelopes throw ApiCallError", () => {
  assert.throws(
    () =>
      parseEnvelopeData(
        HealthResponse,
        { code: -1, message: "业务失败" },
        "/api/health",
      ),
    (error: unknown) =>
      error instanceof ApiCallError &&
      error.code === -1 &&
      error.message === "业务失败",
  )
})

test("malformed envelopes throw ProtocolError", () => {
  assert.throws(
    () => parseEnvelopeData(HealthResponse, { data: {} }, "/api/health"),
    (error: unknown) => error instanceof ProtocolError,
  )
})
