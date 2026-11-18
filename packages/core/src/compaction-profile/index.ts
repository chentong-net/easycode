import { randomUUID } from "node:crypto"
import { chmod, mkdir, readFile, readdir, unlink } from "node:fs/promises"
import { join } from "node:path"

import {
  CompactionProfile,
  CompactionProfileDraft,
  type CompactionProfileDraft as CompactionProfileDraftType,
} from "@easycode/schema"

import type { Logger } from "../log.js"
import { writeFileAtomic } from "../util/atomic.js"

import { CODING_COMPACTION_PROFILE_ID, codingCompactionProfile } from "./coding.js"

export { CODING_COMPACTION_PROFILE_ID, codingCompactionProfile } from "./coding.js"

export const COMPACTION_PROFILE_DIRECTORY = "compaction-profile"
export const COMPACTION_PROFILE_MISSING_MESSAGE = "当前会话使用的压缩配置已不存在，无法继续对话。"

export interface CompactionProfileService {
  /** 内置 Coding 在前，自定义配置随后。 */
  list(): Promise<CompactionProfile[]>
  get(id: string): Promise<CompactionProfile | undefined>
  /** 配置不存在或不可用时返回清晰错误。 */
  require(id: string): Promise<CompactionProfile>
  create(input: CompactionProfileDraftType): Promise<CompactionProfile>
  update(id: string, input: CompactionProfileDraftType): Promise<CompactionProfile>
  delete(id: string): Promise<void>
}

export interface CompactionProfileServiceDeps {
  dataDir: string
  logger?: Logger
}

/**
 * 文件型压缩配置服务。
 *
 * 每次读取都重新检查当前文件，因此通过 API 保存或删除后无需重启即可生效。
 * compaction 引擎会在一次压缩开始时捕获完整对象，所以热更新不会改变正在
 * 执行的摘要请求。
 */
export const createCompactionProfileService = (
  deps: CompactionProfileServiceDeps,
): CompactionProfileService => {
  const directory = join(deps.dataDir, COMPACTION_PROFILE_DIRECTORY)

  const ensureDirectory = async (): Promise<void> => {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await chmod(directory, 0o700)
  }

  const fileFor = (id: string): string => join(directory, `${id}.json`)

  const readCustom = async (id: string): Promise<CompactionProfile | undefined> => {
    if (!isCustomProfileID(id)) return undefined
    let raw: string
    try {
      raw = await readFile(fileFor(id), "utf8")
    } catch (error) {
      if (isNotFound(error)) return undefined
      throw error
    }

    try {
      const parsed = CompactionProfile.safeParse(JSON.parse(raw))
      if (!parsed.success) {
        deps.logger?.warn("忽略结构无效的压缩配置", {
          id,
          error: parsed.error.message,
        })
        return undefined
      }
      if (parsed.data.id !== id || parsed.data.builtIn) {
        deps.logger?.warn("忽略标识与文件名不一致的压缩配置", { id })
        return undefined
      }
      return parsed.data
    } catch (error) {
      deps.logger?.warn("忽略无法解析的压缩配置", { id, error })
      return undefined
    }
  }

  const get = async (id: string): Promise<CompactionProfile | undefined> => {
    if (id === CODING_COMPACTION_PROFILE_ID) return codingCompactionProfile
    return readCustom(id)
  }

  const list = async (): Promise<CompactionProfile[]> => {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      if (isNotFound(error)) return [codingCompactionProfile]
      throw error
    }

    const custom = (
      await Promise.all(
        entries
          .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
          .map((entry) => readCustom(entry.name.slice(0, -".json".length))),
      )
    )
      .filter((profile): profile is CompactionProfile => profile !== undefined)
      .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"))

    return [codingCompactionProfile, ...custom]
  }

  const require = async (id: string): Promise<CompactionProfile> => {
    const profile = await get(id)
    if (!profile) throw new Error(COMPACTION_PROFILE_MISSING_MESSAGE)
    return profile
  }

  const create = async (input: CompactionProfileDraftType): Promise<CompactionProfile> => {
    const draft = CompactionProfileDraft.parse(input)
    const now = Date.now()
    const profile = CompactionProfile.parse({
      ...draft,
      schemaVersion: 1,
      id: randomUUID(),
      revision: 1,
      builtIn: false,
      createdAt: now,
      updatedAt: now,
    })
    await writeProfile(profile)
    deps.logger?.info("已创建压缩配置", { id: profile.id, name: profile.name })
    return profile
  }

  const update = async (
    id: string,
    input: CompactionProfileDraftType,
  ): Promise<CompactionProfile> => {
    if (id === CODING_COMPACTION_PROFILE_ID) {
      throw new Error("内置 Coding 压缩配置不能修改")
    }
    const current = await readCustom(id)
    if (!current) throw new Error(`压缩配置不存在：${id}`)

    const draft = CompactionProfileDraft.parse(input)
    const profile = CompactionProfile.parse({
      ...draft,
      schemaVersion: 1,
      id: current.id,
      revision: current.revision + 1,
      builtIn: false,
      createdAt: current.createdAt,
      updatedAt: Date.now(),
    })
    await writeProfile(profile)
    deps.logger?.info("已更新压缩配置", { id: profile.id, revision: profile.revision })
    return profile
  }

  const remove = async (id: string): Promise<void> => {
    if (id === CODING_COMPACTION_PROFILE_ID) {
      throw new Error("内置 Coding 压缩配置不能删除")
    }
    if (!isCustomProfileID(id) || (await readCustom(id)) === undefined) {
      throw new Error(`压缩配置不存在：${id}`)
    }
    await unlink(fileFor(id))
    deps.logger?.info("已删除压缩配置", { id })
  }

  const writeProfile = async (profile: CompactionProfile): Promise<void> => {
    await ensureDirectory()
    const file = fileFor(profile.id)
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

const isCustomProfileID = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

const isNotFound = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
