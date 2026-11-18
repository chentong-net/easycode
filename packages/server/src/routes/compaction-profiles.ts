import {
  ApiResponse,
  CompactionProfileDraftRequest,
  CompactionProfileListResponse,
  CompactionProfileResponse,
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

export interface CompactionProfileRoutesOptions extends RouteContext {}

export const compactionProfileRoutes: FastifyPluginAsyncZod<CompactionProfileRoutesOptions> =
  async (app, options) => {
    const { core } = options

    app.get(
      "/",
      {
        schema: {
          response: { 200: ApiResponse(CompactionProfileListResponse) },
        },
      },
      async () => {
        const profiles = await core.compactionProfiles.list()
        return success(
          profiles.map((profile) => ({
            id: profile.id,
            name: profile.name,
            ...(profile.description === undefined ? {} : { description: profile.description }),
            revision: profile.revision,
            builtIn: profile.builtIn,
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
          response: { 200: ApiResponse(CompactionProfileResponse) },
        },
      },
      async (request) => {
        try {
          return success(await core.compactionProfiles.require(request.params.profileID))
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
          body: CompactionProfileDraftRequest,
          response: { 200: ApiResponse(CompactionProfileResponse) },
        },
      },
      async (request) => {
        try {
          return success(await core.compactionProfiles.create(request.body))
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
          body: CompactionProfileDraftRequest,
          response: { 200: ApiResponse(CompactionProfileResponse) },
        },
      },
      async (request) => {
        try {
          return success(
            await core.compactionProfiles.update(request.params.profileID, request.body),
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
          await core.compactionProfiles.delete(request.params.profileID)
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
