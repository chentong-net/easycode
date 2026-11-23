import {
  ApiResponse,
  PromptProfileDraftRequest,
  PromptProfileListResponse,
  PromptProfileResponse,
} from "@easycode/protocol"
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { z } from "zod"

import { BusinessError } from "../errors.js"
import { success } from "../response.js"

import type { RouteContext } from "./shared.js"

const ProfileParams = z.object({
  profileID: z.string().trim().min(1),
})

const NullData = z.null()
const MAX_PROFILE_BODY_BYTES = 2 * 1024 * 1024

export interface PromptProfileRoutesOptions extends RouteContext {}

export const promptProfileRoutes: FastifyPluginAsyncZod<PromptProfileRoutesOptions> =
  async (app, options) => {
    const { core } = options

    app.get(
      "/",
      {
        schema: {
          response: { 200: ApiResponse(PromptProfileListResponse) },
        },
      },
      async () => {
        const profiles = await core.promptProfiles.list()
        return success(
          profiles.map((profile) => ({
            id: profile.id,
            name: profile.name,
            ...(profile.description === undefined ? {} : { description: profile.description }),
            createdAt: profile.createdAt,
            updatedAt: profile.updatedAt,
          })),
        )
      },
    )

    app.get(
      "/:profileID",
      {
        schema: {
          params: ProfileParams,
          response: { 200: ApiResponse(PromptProfileResponse) },
        },
      },
      async (request) => {
        try {
          return success(await core.promptProfiles.require(request.params.profileID))
        } catch (error) {
          throw businessFailure(error)
        }
      },
    )

    app.post(
      "/",
      {
        bodyLimit: MAX_PROFILE_BODY_BYTES,
        schema: {
          body: PromptProfileDraftRequest,
          response: { 200: ApiResponse(PromptProfileResponse) },
        },
      },
      async (request) => {
        try {
          return success(await core.promptProfiles.create(request.body))
        } catch (error) {
          throw businessFailure(error)
        }
      },
    )

    app.put(
      "/:profileID",
      {
        bodyLimit: MAX_PROFILE_BODY_BYTES,
        schema: {
          params: ProfileParams,
          body: PromptProfileDraftRequest,
          response: { 200: ApiResponse(PromptProfileResponse) },
        },
      },
      async (request) => {
        try {
          return success(
            await core.promptProfiles.update(request.params.profileID, request.body),
          )
        } catch (error) {
          throw businessFailure(error)
        }
      },
    )

    app.delete(
      "/:profileID",
      {
        schema: {
          params: ProfileParams,
          response: { 200: ApiResponse(NullData) },
        },
      },
      async (request) => {
        try {
          await core.promptProfiles.delete(request.params.profileID)
          return success(null)
        } catch (error) {
          throw businessFailure(error)
        }
      },
    )
  }

const businessFailure = (error: unknown): BusinessError =>
  error instanceof BusinessError
    ? error
    : new BusinessError(error instanceof Error ? error.message : String(error))
