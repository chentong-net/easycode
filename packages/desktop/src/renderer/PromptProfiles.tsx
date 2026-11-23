import type { EasyCodeClient } from "@easycode/client"
import type {
  PromptProfileDraftRequest,
  PromptProfileResponse,
  PromptProfileSummary,
} from "@easycode/protocol"
import {
  Bot,
  ChevronLeft,
  Eye,
  LoaderCircle,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react"
import { useEffect, useState, type FormEvent } from "react"

import { describeError } from "./format"

interface ProfileForm {
  name: string
  description: string
  systemPrompt: string
  compactionSystemPrompt: string
  compactionHeadings: string[]
}

type View =
  | { kind: "list" }
  | { kind: "edit"; profileID?: string; readOnly?: boolean }

const EMPTY_FORM: ProfileForm = {
  name: "",
  description: "",
  systemPrompt: "",
  compactionSystemPrompt: "",
  compactionHeadings: [""],
}

export const PromptProfilesDialog = ({
  client,
  open,
  onClose,
  onChanged,
}: {
  client: EasyCodeClient
  open: boolean
  onClose: () => void
  onChanged: () => Promise<void>
}) => {
  const [view, setView] = useState<View>({ kind: "list" })
  const [profiles, setProfiles] = useState<PromptProfileSummary[]>([])
  const [form, setForm] = useState<ProfileForm>(EMPTY_FORM)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deletingID, setDeletingID] = useState<string | undefined>()
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setView({ kind: "list" })
    setLoading(true)
    setError(undefined)
    setDirty(false)
    void (async () => {
      try {
        const list = await client.promptProfiles.list(controller.signal)
        if (!controller.signal.aborted) setProfiles(list)
      } catch (cause) {
        if (!controller.signal.aborted) setError(describeError(cause))
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })()
    return () => controller.abort()
  }, [client, open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || saving) return
      if (view.kind === "edit" && dirty && !window.confirm("放弃尚未保存的修改吗？")) return
      if (view.kind === "list") onClose()
      else setView({ kind: "list" })
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [dirty, onClose, open, saving, view])

  if (!open) return null

  const readOnly = view.kind === "edit" && view.readOnly === true

  const requestClose = (): void => {
    if (saving) return
    if (view.kind === "edit" && dirty && !window.confirm("放弃尚未保存的修改吗？")) return
    onClose()
  }

  const returnToList = (): void => {
    if (saving) return
    if (dirty && !window.confirm("放弃尚未保存的修改吗？")) return
    setView({ kind: "list" })
    setError(undefined)
  }

  const refreshList = async (): Promise<void> => {
    setProfiles(await client.promptProfiles.list())
  }

  const beginCreate = (): void => {
    setForm({ ...EMPTY_FORM, compactionHeadings: [""] })
    setView({ kind: "edit" })
    setDirty(false)
    setError(undefined)
  }

  const openProfile = async (profileID: string, readonly: boolean): Promise<void> => {
    setView({ kind: "edit", profileID, readOnly: readonly })
    setLoading(true)
    setError(undefined)
    setDirty(false)
    try {
      setForm(toForm(await client.promptProfiles.get(profileID)))
    } catch (cause) {
      setError(describeError(cause))
    } finally {
      setLoading(false)
    }
  }

  const beginEdit = async (profileID: string): Promise<void> => {
    await openProfile(profileID, false)
  }

  const beginView = async (profileID: string): Promise<void> => {
    await openProfile(profileID, true)
  }

  const remove = async (profile: PromptProfileSummary): Promise<void> => {
    if (deletingID !== undefined) return
    if (!window.confirm(`确定删除提示配置“${profile.name}”吗？\n\n正在使用它的会话将无法继续对话。`)) {
      return
    }
    setDeletingID(profile.id)
    setError(undefined)
    try {
      await client.promptProfiles.delete(profile.id)
      await refreshList()
      await onChanged()
    } catch (cause) {
      setError(describeError(cause))
    } finally {
      setDeletingID(undefined)
    }
  }

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (saving || view.kind !== "edit" || readOnly) return
    const validation = validateForm(form)
    if (validation !== undefined) {
      setError(validation)
      return
    }

    setSaving(true)
    setError(undefined)
    try {
      const input = toDraft(form)
      if (view.profileID === undefined) await client.promptProfiles.create(input)
      else await client.promptProfiles.update(view.profileID, input)
      setDirty(false)
      await refreshList()
      await onChanged()
      setView({ kind: "list" })
    } catch (cause) {
      setError(describeError(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="settings-backdrop" role="presentation" onMouseDown={requestClose}>
      <section
        className="settings-panel compaction-profile-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="prompt-profile-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="settings-header">
          <div>
            <h2 id="prompt-profile-title">
              {view.kind === "list"
                ? "提示配置"
                : readOnly
                  ? "查看提示词配置"
                  : view.profileID === undefined
                    ? "新建提示配置"
                    : "编辑提示词配置"}
            </h2>
          </div>
          <button
            type="button"
            className="settings-close"
            onClick={requestClose}
            disabled={saving}
            aria-label="关闭提示配置"
            title="关闭"
          >
            <X size={18} strokeWidth={1.8} />
          </button>
        </header>

        {view.kind === "list" ? (
          <>
            <div className="settings-body compaction-profile-list">
              {loading ? (
                <div className="settings-loading">正在读取提示配置…</div>
              ) : (
                <>
                  {error !== undefined && <div className="settings-load-error">{error}</div>}
                  {profiles.map((profile) => {
                    const builtIn = profile.id === "coding"
                    return (
                      <article className="compaction-profile-item" key={profile.id}>
                        <div className="compaction-profile-icon" aria-hidden>
                          <Bot size={17} strokeWidth={1.8} />
                        </div>
                        <div className="compaction-profile-copy">
                          <div className="compaction-profile-name">
                            <strong>{profile.name}</strong>
                            {builtIn && <span>默认</span>}
                          </div>
                          <p>{profile.description ?? "未填写描述"}</p>
                        </div>
                        <div className="compaction-profile-actions">
                          {builtIn ? (
                            <button
                              type="button"
                              className="btn btn-small"
                              onClick={() => void beginView(profile.id)}
                            >
                              <Eye size={13} />
                              查看
                            </button>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="btn btn-small"
                                onClick={() => void beginEdit(profile.id)}
                              >
                                <Pencil size={13} />
                                编辑
                              </button>
                              <button
                                type="button"
                                className="btn btn-small btn-danger"
                                onClick={() => void remove(profile)}
                                disabled={deletingID !== undefined}
                              >
                                {deletingID === profile.id ? (
                                  <LoaderCircle size={13} className="settings-test-spinner" />
                                ) : (
                                  <Trash2 size={13} />
                                )}
                                删除
                              </button>
                            </>
                          )}
                        </div>
                      </article>
                    )
                  })}
                </>
              )}
            </div>
            <footer className="settings-footer compaction-profile-list-footer">
              <span>内置编程配置可查看，但不可修改或删除。</span>
              <button type="button" className="btn btn-primary" onClick={beginCreate}>
                <Plus size={14} />
                新建提示配置
              </button>
            </footer>
          </>
        ) : (
          <form
            className={`settings-form${readOnly ? " settings-form-readonly" : ""}`}
            onSubmit={(event) => void submit(event)}
          >
            <div className="settings-body">
              {loading ? (
                <div className="settings-loading">正在读取提示配置…</div>
              ) : (
                <>
                  {error !== undefined && <div className="settings-load-error">{error}</div>}
                  <section className="settings-section">
                    <div className="settings-section-heading">
                      <h3>基本信息</h3>
                    </div>
                    <div className="settings-grid">
                      <label className="settings-field">
                        <span>名称</span>
                        <input
                          value={form.name}
                          readOnly={readOnly}
                          onChange={(event) =>
                            updateForm(setForm, setDirty, { name: event.target.value })
                          }
                          placeholder="例如：小说创作"
                          maxLength={80}
                        />
                      </label>
                      <label className="settings-field settings-field-wide">
                        <span>描述</span>
                        <input
                          value={form.description}
                          readOnly={readOnly}
                          onChange={(event) =>
                            updateForm(setForm, setDirty, {
                              description: event.target.value,
                            })
                          }
                          placeholder="说明这个配置适合什么场景"
                          maxLength={500}
                        />
                      </label>
                    </div>
                  </section>

                  <section className="settings-section">
                    <div className="settings-section-heading">
                      <h3>系统提示词</h3>
                      <span>用于主对话 Agent</span>
                    </div>
                    <label className="settings-field">
                      <span>定义角色、工作方式和行为边界</span>
                      <textarea
                        className="compaction-profile-textarea"
                        value={form.systemPrompt}
                        readOnly={readOnly}
                        onChange={(event) =>
                          updateForm(setForm, setDirty, {
                            systemPrompt: event.target.value,
                          })
                        }
                        rows={10}
                      />
                    </label>
                  </section>

                  <section className="settings-section">
                    <div className="settings-section-heading">
                      <h3>摘要系统提示词</h3>
                      <span>仅用于生成上下文摘要</span>
                    </div>
                    <label className="settings-field">
                      <span>定义摘要器角色、场景关注点和信息取舍</span>
                      <textarea
                        className="compaction-profile-textarea"
                        value={form.compactionSystemPrompt}
                        readOnly={readOnly}
                        onChange={(event) =>
                          updateForm(setForm, setDirty, {
                            compactionSystemPrompt: event.target.value,
                          })
                        }
                        rows={8}
                      />
                    </label>
                  </section>

                  <section className="settings-section">
                    <div className="settings-section-heading">
                      <h3>摘要内容标题</h3>
                      {!readOnly && (
                        <button
                          type="button"
                          className="btn btn-small"
                          disabled={form.compactionHeadings.length >= 12}
                          onClick={() =>
                            updateForm(setForm, setDirty, {
                              compactionHeadings: [...form.compactionHeadings, ""],
                            })
                          }
                        >
                          <Plus size={13} />
                          添加标题
                        </button>
                      )}
                    </div>
                    <div className="compaction-profile-headings">
                      {form.compactionHeadings.map((heading, index) => (
                        <div className="compaction-profile-heading-row" key={index}>
                          <span>##</span>
                          <input
                            value={heading}
                            readOnly={readOnly}
                            onChange={(event) =>
                              updateForm(setForm, setDirty, {
                                compactionHeadings: form.compactionHeadings.map(
                                  (item, itemIndex) =>
                                    itemIndex === index ? event.target.value : item,
                                ),
                              })
                            }
                            placeholder="例如：人物状态"
                            maxLength={100}
                          />
                          {!readOnly && (
                            <button
                              type="button"
                              className="settings-close"
                              onClick={() =>
                                updateForm(setForm, setDirty, {
                                  compactionHeadings:
                                    form.compactionHeadings.length === 1
                                      ? [""]
                                      : form.compactionHeadings.filter(
                                          (_, itemIndex) => itemIndex !== index,
                                        ),
                                })
                              }
                              aria-label="删除标题"
                              title="删除标题"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>
                </>
              )}
            </div>
            <footer className="settings-footer">
              <button type="button" className="btn" onClick={returnToList} disabled={saving}>
                <ChevronLeft size={14} />
                返回列表
              </button>
              {!readOnly && (
                <button type="submit" className="btn btn-primary" disabled={saving || loading}>
                  {saving && <LoaderCircle size={14} className="settings-test-spinner" />}
                  {saving ? "保存中…" : "保存"}
                </button>
              )}
            </footer>
          </form>
        )}
      </section>
    </div>
  )
}

const updateForm = (
  setForm: (updater: (current: ProfileForm) => ProfileForm) => void,
  setDirty: (value: boolean) => void,
  patch: Partial<ProfileForm>,
): void => {
  setForm((current) => ({ ...current, ...patch }))
  setDirty(true)
}

const validateForm = (form: ProfileForm): string | undefined => {
  if (form.name.trim().length === 0) return "请填写提示配置名称"
  if (form.systemPrompt.trim().length === 0) return "请填写系统提示词"
  if (form.compactionSystemPrompt.trim().length === 0) {
    return "请填写摘要系统提示词"
  }
  const headings = form.compactionHeadings.map((heading) => heading.trim()).filter(Boolean)
  if (headings.length === 0) return "至少需要一个摘要标题"
  if (headings.length > 12) return "摘要标题不能超过 12 个"
  if (new Set(headings).size !== headings.length) return "摘要标题不能重复"
  if (headings.some((heading) => heading.includes("\n") || heading.startsWith("#"))) {
    return "摘要标题不能包含换行，也不需要填写 # 前缀"
  }
  return undefined
}

const toDraft = (form: ProfileForm): PromptProfileDraftRequest => ({
  name: form.name.trim(),
  ...(form.description.trim().length === 0
    ? {}
    : { description: form.description.trim() }),
  systemPrompt: form.systemPrompt.trim(),
  compactionSystemPrompt: form.compactionSystemPrompt.trim(),
  compactionHeadings: form.compactionHeadings
    .map((heading) => heading.trim())
    .filter(Boolean),
})

const toForm = (profile: PromptProfileResponse): ProfileForm => ({
  name: profile.name,
  description: profile.description ?? "",
  systemPrompt: profile.systemPrompt,
  compactionSystemPrompt: profile.compactionSystemPrompt,
  compactionHeadings: [...profile.compactionHeadings],
})
