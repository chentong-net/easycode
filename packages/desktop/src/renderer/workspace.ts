import type { EasyCodeClient } from "@easycode/client"
import type { RuntimeInfoResponse } from "@easycode/protocol"
import type { Workspace } from "@easycode/schema"
import { useCallback, useEffect, useMemo, useState } from "react"

import { selectDirectory } from "./bridge"
import { describeError } from "./format"

export interface WorkspaceState {
  workspaces: Workspace[]
  /** Server 返回的 Core 默认路径。 */
  runtimeInfo: RuntimeInfoResponse | undefined
  activeWorkspace: Workspace | undefined
  /** 当前工作区目录，供会话列表过滤和新建会话使用。 */
  directory: string | undefined
  loading: boolean
  selecting: boolean
  error: string | undefined
  selectWorkspace(workspaceID: string): void
  /** 选择目录并添加工作区；重复目录会直接选中已有项。 */
  select(): Promise<void>
  rename(workspaceID: string, name: string): Promise<Workspace | undefined>
  pin(workspaceID: string, pinned: boolean): Promise<Workspace | undefined>
  deleteWorkspace(workspaceID: string): Promise<{ deletedSessions: number } | undefined>
  clearError(): void
}

export const useWorkspaces = (client: EasyCodeClient): WorkspaceState => {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfoResponse | undefined>()
  const [activeWorkspaceID, setActiveWorkspaceID] = useState<string | undefined>()
  const [loading, setLoading] = useState(true)
  const [selecting, setSelecting] = useState(false)
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const [paths, list] = await Promise.all([
          client.runtimeInfo(controller.signal),
          client.workspaces.list(controller.signal),
        ])
        if (controller.signal.aborted) return
        setRuntimeInfo(paths)
        setWorkspaces(sortWorkspaces(list, paths.workspaceDirectory))
        const defaultWorkspace = list.find((item) =>
          isDefaultWorkspace(item, paths.workspaceDirectory),
        )
        setActiveWorkspaceID(defaultWorkspace?.id ?? list[0]?.id)
      } catch (cause) {
        if (!controller.signal.aborted) setError(describeError(cause))
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })()
    return () => controller.abort()
  }, [client])

  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceID),
    [activeWorkspaceID, workspaces],
  )

  const selectWorkspace = useCallback((workspaceID: string) => {
    setError(undefined)
    setActiveWorkspaceID(workspaceID)
  }, [])

  const select = useCallback(async () => {
    setSelecting(true)
    setError(undefined)
    try {
      const picked = await selectDirectory(
        activeWorkspace?.directory ?? runtimeInfo?.workspaceDirectory,
      )
      if (picked === undefined) return
      const workspace = await client.workspaces.add({ directory: picked })
      setWorkspaces((previous) =>
        sortWorkspaces(
          previous.some((item) => item.id === workspace.id)
            ? previous.map((item) => (item.id === workspace.id ? workspace : item))
            : [...previous, workspace],
          runtimeInfo?.workspaceDirectory,
        ),
      )
      setActiveWorkspaceID(workspace.id)
    } catch (cause) {
      setError(describeError(cause))
    } finally {
      setSelecting(false)
    }
  }, [activeWorkspace?.directory, client.workspaces, runtimeInfo?.workspaceDirectory])

  const rename = useCallback(
    async (workspaceID: string, name: string): Promise<Workspace | undefined> => {
      setError(undefined)
      try {
        const updated = await client.workspaces.rename(workspaceID, { name })
        setWorkspaces((previous) =>
          sortWorkspaces(
            previous.map((workspace) => (workspace.id === workspaceID ? updated : workspace)),
            runtimeInfo?.workspaceDirectory,
          ),
        )
        return updated
      } catch (cause) {
        setError(describeError(cause))
        return undefined
      }
    },
    [client.workspaces, runtimeInfo?.workspaceDirectory],
  )

  const pin = useCallback(
    async (workspaceID: string, pinned: boolean): Promise<Workspace | undefined> => {
      setError(undefined)
      try {
        const updated = await client.workspaces.pin(workspaceID, { pinned })
        setWorkspaces((previous) =>
          sortWorkspaces(
            previous.map((workspace) => (workspace.id === workspaceID ? updated : workspace)),
            runtimeInfo?.workspaceDirectory,
          ),
        )
        return updated
      } catch (cause) {
        setError(describeError(cause))
        return undefined
      }
    },
    [client.workspaces, runtimeInfo?.workspaceDirectory],
  )

  const deleteWorkspace = useCallback(
    async (workspaceID: string): Promise<{ deletedSessions: number } | undefined> => {
      setError(undefined)
      try {
        const result = await client.workspaces.delete(workspaceID)
        const remaining = workspaces.filter((workspace) => workspace.id !== workspaceID)
        setWorkspaces(remaining)
        if (activeWorkspaceID === workspaceID) {
          setActiveWorkspaceID(
            remaining.find((item) =>
              isDefaultWorkspace(item, runtimeInfo?.workspaceDirectory),
            )?.id ?? remaining[0]?.id,
          )
        }
        return result
      } catch (cause) {
        setError(describeError(cause))
        return undefined
      }
    },
    [activeWorkspaceID, client.workspaces, runtimeInfo?.workspaceDirectory, workspaces],
  )

  const clearError = useCallback(() => setError(undefined), [])

  return {
    workspaces,
    runtimeInfo,
    activeWorkspace,
    directory: activeWorkspace?.directory,
    loading,
    selecting,
    error,
    selectWorkspace,
    select,
    rename,
    pin,
    deleteWorkspace,
    clearError,
  }
}

export const isDefaultWorkspace = (
  workspace: Workspace,
  defaultWorkspaceDirectory: string | undefined,
): boolean =>
  defaultWorkspaceDirectory !== undefined &&
  workspace.directory === defaultWorkspaceDirectory

const sortWorkspaces = (
  workspaces: Workspace[],
  defaultWorkspaceDirectory: string | undefined,
): Workspace[] =>
  [...workspaces].sort((left, right) => {
    const leftDefault = isDefaultWorkspace(left, defaultWorkspaceDirectory)
    const rightDefault = isDefaultWorkspace(right, defaultWorkspaceDirectory)
    if (leftDefault !== rightDefault) return leftDefault ? -1 : 1

    const leftPinned = left.pinnedAt !== undefined
    const rightPinned = right.pinnedAt !== undefined
    if (leftPinned !== rightPinned) return leftPinned ? -1 : 1
    if (leftPinned && rightPinned) return (right.pinnedAt ?? 0) - (left.pinnedAt ?? 0)

    return left.createdAt - right.createdAt || left.name.localeCompare(right.name)
  })
