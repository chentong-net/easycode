import type { Core } from "@easycode/core"
import type { Logger } from "@easycode/core"

import { BusinessError } from "../errors.js"

export interface RouteContext {
  core: Core
  logger: Logger
}

export const requireSession = async (core: Core, sessionID: string) => {
  const session = await core.sessions.get(sessionID)
  if (!session) throw new BusinessError(`会话不存在：${sessionID}`)
  return session
}
