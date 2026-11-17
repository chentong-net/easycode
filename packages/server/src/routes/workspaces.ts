import {
  ApiResponse,
  CreateWorkspaceRequest,
  DeleteWorkspaceResponse,
  PinWorkspaceRequest,
  RenameWorkspaceRequest,
  WorkspaceListResponse,
  WorkspaceResponse,
} from "@easycode/protocol"
import { WorkspaceDeleteError } from "@easycode/core"
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { z } from "zod"

import { BusinessError } from "../errors.js"
import { success } from "../response.js"

import type { RouteContext } from "./shared.js"

const WorkspaceParams = z.object({
  workspaceID: z.string().trim().min(1),
})

export interface WorkspaceRoutesOptions extends RouteContext {}

export const workspaceRoutes: FastifyPluginAsyncZod<WorkspaceRoutesOptions> = async (
  app,
  options,
) => {
  app.get(
    "/",
    {
      schema: {
        response: { 200: ApiResponse(WorkspaceListResponse) },
      },
    },
    async () => success(await options.core.workspaces.list()),
  )

  app.post(
    "/",
    {
      schema: {
        body: CreateWorkspaceRequest,
        response: { 200: ApiResponse(WorkspaceResponse) },
      },
    },
    async (request) => {
      try {
        return success(await options.core.workspaces.add(request.body.directory))
      } catch (error) {
        throw businessFailure(error)
      }
    },
  )

  app.patch(
    "/:workspaceID",
    {
      schema: {
        params: WorkspaceParams,
        body: RenameWorkspaceRequest,
        response: { 200: ApiResponse(WorkspaceResponse) },
      },
    },
    async (request) => {
      try {
        return success(
          await options.core.workspaces.rename(
            request.params.workspaceID,
            request.body.name,
          ),
        )
      } catch (error) {
        throw businessFailure(error)
      }
    },
  )

  app.delete(
    "/:workspaceID",
    {
      schema: {
        params: WorkspaceParams,
        response: { 200: ApiResponse(DeleteWorkspaceResponse) },
      },
    },
    async (request) => {
      try {
        return success(
          await options.core.workspaces.delete(request.params.workspaceID),
        )
      } catch (error) {
        if (error instanceof WorkspaceDeleteError) {
          throw new BusinessError(error.message)
        }
        throw businessFailure(error)
      }
    },
  )

  app.post(
    "/:workspaceID/pin",
    {
      schema: {
        params: WorkspaceParams,
        body: PinWorkspaceRequest,
        response: { 200: ApiResponse(WorkspaceResponse) },
      },
    },
    async (request) => {
      try {
        return success(
          await options.core.workspaces.pin(
            request.params.workspaceID,
            request.body.pinned,
          ),
        )
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
