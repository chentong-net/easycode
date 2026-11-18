import {
  ApiResponse,
  BulkDeleteSessionsResponse,
  BulkDeleteSessionsRequest,
  CreateSessionRequest,
  MessageListResponse,
  PermissionReplyRequest,
  PermissionListResponse,
  PinSessionRequest,
  PromptRequest,
  PromptResponse,
  QuestionReplyRequest,
  QuestionListResponse,
  RenameSessionRequest,
  SessionListResponse,
  SessionResponse,
  SessionConfigurationRequest,
  SessionTaskResponse,
} from "@easycode/protocol"
import {
  QuestionAnswerInvalidError,
  QuestionRequestNotFoundError,
} from "@easycode/core"
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { z } from "zod"

import { BusinessError } from "../errors.js"
import { success } from "../response.js"
import { streamEvents } from "../sse.js"

import { requireSession, type RouteContext } from "./shared.js"

const MAX_PROMPT_BODY_BYTES = 64 * 1024 * 1024

const SessionParams = z.object({
  sessionID: z.string().trim().min(1),
})

const PermissionParams = z.object({
  sessionID: z.string().trim().min(1),
  requestID: z.string().trim().min(1),
})

const QuestionParams = PermissionParams

const EventQuery = z.object({
  after: z.coerce.number().int().nonnegative().optional(),
})

export interface SessionRoutesOptions extends RouteContext {}

const NullData = z.null()

export const sessionRoutes: FastifyPluginAsyncZod<SessionRoutesOptions> =
  async (app, options) => {
    const { core, logger } = options

    app.get(
      "/",
      {
        schema: {
          response: { 200: ApiResponse(SessionListResponse) },
        },
      },
      async () => success(await core.sessions.list()),
    )

    app.post(
      "/",
      {
        schema: {
          body: CreateSessionRequest,
          response: { 200: ApiResponse(SessionResponse) },
        },
      },
      async (request) => {
        try {
          return success(
            await core.sessions.create(
              {
                directory: request.body.directory,
                ...(request.body.title === undefined ? {} : { title: request.body.title }),
                ...(request.body.modelConfigID === undefined
                  ? {}
                  : { modelConfigID: request.body.modelConfigID }),
                ...(request.body.compactionProfileID === undefined
                  ? {}
                  : { compactionProfileID: request.body.compactionProfileID }),
                ...(request.body.reasoningEffort === undefined
                  ? {}
                  : { reasoningEffort: request.body.reasoningEffort }),
              },
            ),
          )
        } catch (error) {
          throw businessFailure(error)
        }
      },
    )

    app.post(
      "/bulk-delete",
      {
        schema: {
          body: BulkDeleteSessionsRequest,
          response: { 200: ApiResponse(BulkDeleteSessionsResponse) },
        },
      },
      async (request) =>
        success(await core.sessions.deleteMany(request.body.sessionIDs)),
    )

    app.get(
      "/:sessionID",
      {
        schema: {
          params: SessionParams,
          response: { 200: ApiResponse(SessionResponse) },
        },
      },
      async (request) =>
        success(await requireSession(core, request.params.sessionID)),
    )

    app.patch(
      "/:sessionID",
      {
        schema: {
          params: SessionParams,
          body: RenameSessionRequest,
          response: { 200: ApiResponse(SessionResponse) },
        },
      },
      async (request) => {
        await requireSession(core, request.params.sessionID)
        try {
          return success(
            await core.sessions.rename(
              request.params.sessionID,
              request.body.title,
            ),
          )
        } catch (error) {
          throw businessFailure(error)
        }
      },
    )

    app.delete(
      "/:sessionID",
      {
        schema: {
          params: SessionParams,
          response: { 200: ApiResponse(NullData) },
        },
      },
      async (request) => {
        await requireSession(core, request.params.sessionID)
        try {
          await core.sessions.delete(request.params.sessionID)
          return success(null)
        } catch (error) {
          throw businessFailure(error)
        }
      },
    )

    app.post(
      "/:sessionID/pin",
      {
        schema: {
          params: SessionParams,
          body: PinSessionRequest,
          response: { 200: ApiResponse(SessionResponse) },
        },
      },
      async (request) => {
        await requireSession(core, request.params.sessionID)
        try {
          return success(
            await core.sessions.pin(
              request.params.sessionID,
              request.body.pinned,
            ),
          )
        } catch (error) {
          throw businessFailure(error)
        }
      },
    )

    app.get(
      "/:sessionID/messages",
      {
        schema: {
          params: SessionParams,
          response: { 200: ApiResponse(MessageListResponse) },
        },
      },
      async (request) => {
        await requireSession(core, request.params.sessionID)
        return success(await core.sessions.messages(request.params.sessionID))
      },
    )

    app.get(
      "/:sessionID/task",
      {
        schema: {
          params: SessionParams,
          response: { 200: ApiResponse(SessionTaskResponse) },
        },
      },
      async (request) => {
        await requireSession(core, request.params.sessionID)
        const task = await core.sessions.task(request.params.sessionID)
        return success({ task: task ?? null })
      },
    )

    app.put(
      "/:sessionID/configuration",
      {
        schema: {
          params: SessionParams,
          body: SessionConfigurationRequest,
          response: { 200: ApiResponse(SessionResponse) },
        },
      },
      async (request) => {
        await requireSession(core, request.params.sessionID)
        try {
          return success(
            await core.sessions.configure(request.params.sessionID, request.body),
          )
        } catch (error) {
          throw businessFailure(error)
        }
      },
    )

    app.post(
      "/:sessionID/prompt",
      {
        bodyLimit: MAX_PROMPT_BODY_BYTES,
        schema: {
          params: SessionParams,
          body: PromptRequest,
          response: { 200: ApiResponse(PromptResponse) },
        },
      },
      async (request) => {
        await requireSession(core, request.params.sessionID)
        try {
          return success(
            await core.sessions.prompt(request.params.sessionID, {
              text: request.body.text,
              content: request.body.content,
              ...(request.body.delivery === undefined
                ? {}
                : { delivery: request.body.delivery }),
            }),
          )
        } catch (error) {
          throw businessFailure(error)
        }
      },
    )

    app.post(
      "/:sessionID/interrupt",
      {
        schema: {
          params: SessionParams,
          response: { 200: ApiResponse(NullData) },
        },
      },
      async (request) => {
        await requireSession(core, request.params.sessionID)
        await core.sessions.interrupt(request.params.sessionID)
        return success(null)
      },
    )

    app.get(
      "/:sessionID/events",
      {
        schema: {
          params: SessionParams,
          querystring: EventQuery,
        },
      },
      async (request, reply) => {
        await requireSession(core, request.params.sessionID)
        reply.hijack()
        try {
          await streamEvents({
            core,
            sessionID: request.params.sessionID,
            after: request.query.after,
            res: reply.raw,
            logger,
          })
        } catch (error) {
          logger.error("事件流处理失败", {
            sessionID: request.params.sessionID,
            error,
          })
          reply.raw.end()
        }
        return reply
      },
    )

    app.get(
      "/:sessionID/permissions",
      {
        schema: {
          params: SessionParams,
          response: { 200: ApiResponse(PermissionListResponse) },
        },
      },
      async (request) => {
        await requireSession(core, request.params.sessionID)
        const handle = await core.sessions.handle(request.params.sessionID)
        return success(core.permissions.pending(handle))
      },
    )

    app.post(
      "/:sessionID/permissions/:requestID/reply",
      {
        schema: {
          params: PermissionParams,
          body: PermissionReplyRequest,
          response: { 200: ApiResponse(NullData) },
        },
      },
      async (request) => {
        await requireSession(core, request.params.sessionID)
        const handle = await core.sessions.handle(request.params.sessionID)
        try {
          await core.permissions.reply({
            handle,
            requestID: request.params.requestID,
            reply: request.body.reply,
            ...(request.body.feedback === undefined
              ? {}
              : { feedback: request.body.feedback }),
          })
          return success(null)
        } catch (error) {
          throw businessFailure(error)
        }
      },
    )

    app.get(
      "/:sessionID/questions",
      {
        schema: {
          params: SessionParams,
          response: { 200: ApiResponse(QuestionListResponse) },
        },
      },
      async (request) => {
        await requireSession(core, request.params.sessionID)
        const handle = await core.sessions.handle(request.params.sessionID)
        return success(core.questions.pending(handle))
      },
    )

    app.post(
      "/:sessionID/questions/:requestID/reply",
      {
        schema: {
          params: QuestionParams,
          body: QuestionReplyRequest,
          response: { 200: ApiResponse(NullData) },
        },
      },
      async (request) => {
        await requireSession(core, request.params.sessionID)
        const handle = await core.sessions.handle(request.params.sessionID)
        try {
          await core.questions.reply({
            handle,
            requestID: request.params.requestID,
            answers: request.body.answers,
          })
          return success(null)
        } catch (error) {
          if (
            error instanceof QuestionRequestNotFoundError ||
            error instanceof QuestionAnswerInvalidError
          ) {
            throw new BusinessError(error.message)
          }
          throw error
        }
      },
    )
  }

const businessFailure = (error: unknown): BusinessError =>
  error instanceof BusinessError
    ? error
    : new BusinessError(error instanceof Error ? error.message : String(error))
