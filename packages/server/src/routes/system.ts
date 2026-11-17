import { calculateCompactionBudget } from "@easycode/core"
import {
  API_VERSION,
  AgentListResponse,
  ApiResponse,
  HealthResponse,
} from "@easycode/protocol"
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"

import { success } from "../response.js"

import type { RouteContext } from "./shared.js"

export interface SystemRoutesOptions extends RouteContext {}

export const systemRoutes: FastifyPluginAsyncZod<SystemRoutesOptions> = async (
  app,
  options,
) => {
  app.get(
    "/health",
    {
      schema: {
        response: { 200: ApiResponse(HealthResponse) },
      },
    },
    async () => {
      const budget = calculateCompactionBudget(options.core.config)
      return success({
        ok: true,
        version: API_VERSION,
        model: options.core.config.model,
        contextWindow: options.core.config.contextWindow,
        maxOutputTokens: budget.outputTokens,
      } satisfies HealthResponse)
    },
  )

  app.get(
    "/agents",
    {
      schema: {
        response: { 200: ApiResponse(AgentListResponse) },
      },
    },
    async () =>
      success(
        options.core.agents.all().map((agent) => ({
          id: agent.id,
          description: agent.description,
        })),
      ),
  )
}
