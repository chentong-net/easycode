import {
  ApiResponse,
  ModelConnectionTestRequest,
  ModelConnectionTestResponse,
  RuntimeConfigResponse,
  RuntimeConfigUpdateRequest,
} from "@easycode/protocol"
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"

import { BusinessError } from "../errors.js"
import { success } from "../response.js"

import type { RouteContext } from "./shared.js"

export interface ConfigRoutesOptions extends RouteContext {}

export const configRoutes: FastifyPluginAsyncZod<ConfigRoutesOptions> = async (
  app,
  options,
) => {
  app.get(
    "/",
    {
      schema: {
        response: { 200: ApiResponse(RuntimeConfigResponse) },
      },
    },
    async () => success(await options.core.configuration.read()),
  )

  app.put(
    "/",
    {
      schema: {
        body: RuntimeConfigUpdateRequest,
        response: { 200: ApiResponse(RuntimeConfigResponse) },
      },
    },
    async (request) => {
      try {
        return success(await options.core.configuration.update(request.body))
      } catch (error) {
        throw new BusinessError(error instanceof Error ? error.message : String(error))
      }
    },
  )

  app.post(
    "/test",
    {
      schema: {
        body: ModelConnectionTestRequest,
        response: { 200: ApiResponse(ModelConnectionTestResponse) },
      },
    },
    async (request) => success(await options.core.configuration.testModel(request.body)),
  )
}
