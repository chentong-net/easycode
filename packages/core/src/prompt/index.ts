import { randomUUID } from "node:crypto"
import { chmod, mkdir, readFile, readdir, unlink } from "node:fs/promises"
import { join } from "node:path"

import {
  PromptProfile,
  PromptProfileDraft,
  type PromptProfileDraft as PromptProfileDraftType,
} from "@easycode/schema"

import { BUILD_SYSTEM_PROMPT } from "../agent.js"
import type { Logger } from "../log.js"
import { writeFileAtomic } from "../util/atomic.js"

import { CODING_PROMPT_PROFILE_ID, codingPromptProfile } from "./coding.js"

export { CODING_PROMPT_PROFILE_ID, codingPromptProfile } from "./coding.js"

export const PROMPT_PROFILE_DIRECTORY = "prompt"
/** 未发布版本的旧目录，只在读取时用于一次性迁移。 */
export const LEGACY_PROMPT_PROFILE_DIRECTORY = "compaction-profile"
export const PROMPT_PROFILE_REQUIRED_MESSAGE = "请选择提示配置。"
export const PROMPT_PROFILE_MISSING_MESSAGE = "当前会话使用的提示配置已不存在，无法继续对话。"

export interface PromptProfileService {
  /** 内置编程配置在前，自定义配置随后。 */
  list(): Promise<PromptProfile[]>
  get(id: string): Promise<PromptProfile | undefined>
  require(id: string): Promise<PromptProfile>
  create(input: PromptProfileDraftType): Promise<PromptProfile>
  update(id: string, input: PromptProfileDraftType): Promise<PromptProfile>
  delete(id: string): Promise<void>
}

export interface PromptProfileServiceDeps {
  dataDir: string
  logger?: Logger
}

/**
 * 文件型场景提示配置服务。
 *
 * 当前目录是 `prompt/`。读取 `compaction-profile/` 仅用于迁移尚未发布的旧数据。
 */
export const createPromptProfileService = (
  deps: PromptProfileServiceDeps,
): PromptProfileService => {
  const directory = join(deps.dataDir, PROMPT_PROFILE_DIRECTORY)
  const legacyDirectory = join(deps.dataDir, LEGACY_PROMPT_PROFILE_DIRECTORY)

  const ensureDirectory = async (): Promise<void> => {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await chmod(directory, 0o700)
  }

  const fileFor = (base: string, id: string): string => join(base, `${id}.json`)

  const readAt = async (base: string, id: string): Promise<unknown | undefined> => {
    try {
      return JSON.parse(await readFile(fileFor(base, id), "utf8")) as unknown
    } catch (error) {
      if (isNotFound(error)) return undefined
      throw error
    }
  }

  const migrate = (id: string, value: unknown): PromptProfile | undefined => {
    if (!isRecord(value)) return undefined
    const legacyHeadings = isRecord(value.format) ? value.format.headings : undefined
    if (!Array.isArray(legacyHeadings)) return undefined

    const createdAt = typeof value.createdAt === "number" ? value.createdAt : 0
    const updatedAt = typeof value.updatedAt === "number" ? value.updatedAt : createdAt
    const parsed = PromptProfile.safeParse({
      id,
      name: value.name,
      ...(typeof value.description === "string" ? { description: value.description } : {}),
      systemPrompt:
        typeof value.agentSystemPrompt === "string" ? value.agentSystemPrompt : BUILD_SYSTEM_PROMPT,
      compactionSystemPrompt:
        typeof value.systemPrompt === "string"
          ? value.systemPrompt
          : codingPromptProfile.compactionSystemPrompt,
      compactionHeadings: legacyHeadings,
      createdAt,
      updatedAt,
    })
    return parsed.success ? parsed.data : undefined
  }

  const readCustom = async (id: string): Promise<PromptProfile | undefined> => {
    if (!isCustomProfileID(id)) return undefined

    let value: unknown
    try {
      value = await readAt(directory, id)
      const parsed = PromptProfile.safeParse(value)
      if (parsed.success) {
        return parsed.data.id === id ? parsed.data : undefined
      }

      if (value === undefined) value = await readAt(legacyDirectory, id)
      const profile = migrate(id, value)
      if (!profile) {
        deps.logger?.warn("忽略结构无效的提示配置", { id })
        return undefined
      }
      await writeProfile(profile)
      deps.logger?.info("已迁移提示配置", { id })
      return profile
    } catch (error) {
      deps.logger?.warn("忽略无法读取的提示配置", { id, error })
      return undefined
    }
  }

  const get = async (id: string): Promise<PromptProfile | undefined> => {
    if (id === CODING_PROMPT_PROFILE_ID) return codingPromptProfile
    return readCustom(id)
  }

  const list = async (): Promise<PromptProfile[]> => {
    const ids = new Set<string>()
    for (const base of [directory, legacyDirectory]) {
      try {
        for (const entry of await readdir(base, { withFileTypes: true })) {
          if (entry.isFile() && entry.name.endsWith(".json")) {
            ids.add(entry.name.slice(0, -".json".length))
          }
        }
      } catch (error) {
        if (!isNotFound(error)) throw error
      }
    }

    const custom = (
      await Promise.all([...ids].map((id) => readCustom(id)))
    )
      .filter((profile): profile is PromptProfile => profile !== undefined)
      .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"))

    return [codingPromptProfile, ...custom]
  }

  const require = async (id: string): Promise<PromptProfile> => {
    const profile = await get(id)
    if (!profile) throw new Error(PROMPT_PROFILE_MISSING_MESSAGE)
    return profile
  }

  const create = async (input: PromptProfileDraftType): Promise<PromptProfile> => {
    const draft = PromptProfileDraft.parse(input)
    const now = Date.now()
    const profile = PromptProfile.parse({
      ...draft,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    })
    await writeProfile(profile)
    deps.logger?.info("已创建提示配置", { id: profile.id, name: profile.name })
    return profile
  }

  const update = async (
    id: string,
    input: PromptProfileDraftType,
  ): Promise<PromptProfile> => {
    if (id === CODING_PROMPT_PROFILE_ID) {
      throw new Error("内置编程配置不能修改")
    }
    const current = await readCustom(id)
    if (!current) throw new Error(`提示配置不存在：${id}`)

    const draft = PromptProfileDraft.parse(input)
    const changed = !sameDraft(current, draft)
    const profile = PromptProfile.parse({
      ...draft,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: changed ? Date.now() : current.updatedAt,
    })
    if (changed) {
      await writeProfile(profile)
      deps.logger?.info("已更新提示配置", { id: profile.id })
    }
    return profile
  }

  const remove = async (id: string): Promise<void> => {
    if (id === CODING_PROMPT_PROFILE_ID) {
      throw new Error("内置编程配置不能删除")
    }
    if (!isCustomProfileID(id) || (await readCustom(id)) === undefined) {
      throw new Error(`提示配置不存在：${id}`)
    }
    await Promise.all(
      [directory, legacyDirectory].map((base) =>
        unlink(fileFor(base, id)).catch((error: unknown) => {
          if (!isNotFound(error)) throw error
        }),
      ),
    )
    deps.logger?.info("已删除提示配置", { id })
  }

  const writeProfile = async (profile: PromptProfile): Promise<void> => {
    await ensureDirectory()
    const file = fileFor(directory, profile.id)
    await writeFileAtomic(file, `${JSON.stringify(profile, null, 2)}\n`, { mode: 0o600 })
    await chmod(file, 0o600)
  }

  return {
    list,
    get,
    require,
    create,
    update,
    delete: remove,
  }
}

const sameDraft = (profile: PromptProfile, draft: PromptProfileDraftType): boolean =>
  profile.name === draft.name &&
  profile.description === draft.description &&
  profile.systemPrompt === draft.systemPrompt &&
  profile.compactionSystemPrompt === draft.compactionSystemPrompt &&
  profile.compactionHeadings.length === draft.compactionHeadings.length &&
  profile.compactionHeadings.every((heading, index) => heading === draft.compactionHeadings[index])

const isCustomProfileID = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isNotFound = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
