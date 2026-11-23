import { ImageServiceError } from "@easycode/core"
import {
  ApiResponse,
  ImagePrepareRequest,
  ImagePrepareResponse,
  ImagePlatformListResponse,
} from "@easycode/protocol"
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"

import { BusinessError } from "../errors.js"
import { success } from "../response.js"

import type { RouteContext } from "./shared.js"

export interface ImageRoutesOptions extends RouteContext {}

export const imageRoutes: FastifyPluginAsyncZod<ImageRoutesOptions> = async (
  app,
  options,
) => {
  app.get(
    "/platforms",
    {
      schema: {
        response: { 200: ApiResponse(ImagePlatformListResponse) },
      },
    },
    async () => success(options.core.images.platforms()),
  )

  app.post(
    "/prepare",
    {
      schema: {
        body: ImagePrepareRequest,
        response: { 200: ApiResponse(ImagePrepareResponse) },
      },
    },
    async (request) => {
      try {
        const record =
          request.body.platform !== "deepseek-files" ||
          request.body.modelConfigID === undefined
            ? undefined
            : await options.core.modelConfigs.requireRecord(request.body.modelConfigID)
        return success(
          await options.core.images.prepare(
            request.body.platform,
            { path: request.body.path },
            record?.runtime,
          ),
        )
      } catch (error) {
        if (error instanceof ImageServiceError) {
          throw new BusinessError(error.message)
        }
        throw error
      }
    },
  )
}
