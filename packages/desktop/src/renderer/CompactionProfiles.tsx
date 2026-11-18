import type { EasyCodeClient } from "@easycode/client"
import type {
  CompactionProfileDraftRequest,
  CompactionProfileResponse,
  CompactionProfileSummary,
} from "@easycode/protocol"
import {
  Bot,
  ChevronLeft,
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
  agentSystemPrompt: string
  systemPrompt: string
  includeTaskState: boolean
  instructions: CompactionProfileDraftRequest["instructions"]
  sectionTitles: CompactionProfileDraftRequest["sectionTitles"]
  headings: string[]
}

type View = { kind: "list" } | { kind: "edit"; profileID?: string }

const EMPTY_FORM: ProfileForm = {
  name: "",
  description: "",
  agentSystemPrompt: "",
  systemPrompt: "",
  includeTaskState: false,
  instructions: {
    initial: "",
    chunk: "",
    merge: "",
    correction: "",
  },
  sectionTitles: {
    previousSummary: "已有摘要",
    taskState: "当前任务状态",
    transcript: "待压缩对话",
    instruction: "压缩要求",
  },
  headings: [""],
}

export const CompactionProfilesDialog = ({
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
  const [profiles, setProfiles] = useState<CompactionProfileSummary[]>([])
  const [form, setForm] = useState<ProfileForm>(EMPTY_FORM)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deletingID, setDeletingID] = useState<string | undefined>()
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [feedback, setFeedback] = useState<string | undefined>()

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setView({ kind: "list" })
    setLoading(true)
    setError(undefined)
    setFeedback(undefined)
    setDirty(false)
    void (async () => {
      try {
        const list = await client.compactionProfiles.list(controller.signal)
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
    const list = await client.compactionProfiles.list()
    setProfiles(list)
  }

  const beginCreate = (): void => {
    setForm({ ...EMPTY_FORM, headings: [""] })
    setView({ kind: "edit" })
    setDirty(false)
    setError(undefined)
    setFeedback(undefined)
  }

  const beginEdit = async (profileID: string): Promise<void> => {
    setView({ kind: "edit", profileID })
    setLoading(true)
    setError(undefined)
    setFeedback(undefined)
    setDirty(false)
    try {
      const profile = await client.compactionProfiles.get(profileID)
      setForm(toForm(profile))
    } catch (cause) {
      setError(describeError(cause))
    } finally {
      setLoading(false)
    }
  }

  const remove = async (profile: CompactionProfileSummary): Promise<void> => {
    if (deletingID !== undefined) return
    if (!window.confirm(`确定删除压缩配置“${profile.name}”吗？\n\n正在使用它的会话将无法继续对话。`)) {
      return
    }
    setDeletingID(profile.id)
    setError(undefined)
    setFeedback(undefined)
    try {
      await client.compactionProfiles.delete(profile.id)
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
    if (saving || view.kind !== "edit") return
    const validation = validateForm(form)
    if (validation !== undefined) {
      setError(validation)
      return
    }

    const input = toDraft(form)
    setSaving(true)
    setError(undefined)
    setFeedback(undefined)
    try {
      if (view.profileID === undefined) {
        await client.compactionProfiles.create(input)
        setFeedback("压缩配置已创建，已立即生效。")
      } else {
        await client.compactionProfiles.update(view.profileID, input)
        setFeedback("压缩配置已保存，已立即生效。")
      }
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
        aria-labelledby="compaction-profile-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="settings-header">
          <div>
            <h2 id="compaction-profile-title">
              {view.kind === "list" ? "压缩配置管理" : view.profileID === undefined ? "新建压缩配置" : "编辑压缩配置"}
            </h2>
            <p>配置保存在本机，保存后立即用于后续压缩。</p>
          </div>
          <button
            type="button"
            className="settings-close"
            onClick={requestClose}
            disabled={saving}
            aria-label="关闭压缩配置管理"
            title="关闭"
          >
            <X size={18} strokeWidth={1.8} />
          </button>
        </header>

        {view.kind === "list" ? (
          <>
            <div className="settings-body compaction-profile-list">
              {loading ? (
                <div className="settings-loading">正在读取压缩配置…</div>
              ) : (
                <>
                  {error !== undefined && <div className="settings-load-error">{error}</div>}
                  {feedback !== undefined && (
                    <div className="settings-saved">
                      <span>{feedback}</span>
                    </div>
                  )}
                  {profiles.map((profile) => (
                    <article className="compaction-profile-item" key={profile.id}>
                      <div className="compaction-profile-icon" aria-hidden>
                        <Bot size={17} strokeWidth={1.8} />
                      </div>
                      <div className="compaction-profile-copy">
                        <div className="compaction-profile-name">
                          <strong>{profile.name}</strong>
                          {profile.builtIn && <span>默认</span>}
                          <small>v{profile.revision}</small>
                        </div>
                        <p>{profile.description ?? "未填写描述"}</p>
                      </div>
                      <div className="compaction-profile-actions">
                        {!profile.builtIn && (
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
                  ))}
                </>
              )}
            </div>
            <footer className="settings-footer compaction-profile-list-footer">
              <span>内置 Coding 不可修改或删除。</span>
              <button type="button" className="btn btn-primary" onClick={beginCreate}>
                <Plus size={14} />
                新建压缩配置
              </button>
            </footer>
          </>
        ) : (
          <form className="settings-form" onSubmit={(event) => void submit(event)}>
            <div className="settings-body">
              {loading ? (
                <div className="settings-loading">正在读取压缩配置…</div>
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
                          onChange={(event) => updateForm(setForm, setDirty, { name: event.target.value })}
                          placeholder="例如：小说创作"
                          maxLength={80}
                        />
                      </label>
                      <label className="settings-field settings-field-wide">
                        <span>描述</span>
                        <input
                          value={form.description}
                          onChange={(event) => updateForm(setForm, setDirty, { description: event.target.value })}
                          placeholder="说明这个压缩配置适合什么场景"
                          maxLength={500}
                        />
                      </label>
                    </div>
                  </section>

                  <section className="settings-section">
                    <div className="settings-section-heading">
                      <h3>会话系统提示词（BUILD）</h3>
                      <span>用于当前会话的主对话模型</span>
                    </div>
                    <label className="settings-field">
                      <span>定义角色、工作方式和行为边界</span>
                      <textarea
                        className="compaction-profile-textarea"
                        value={form.agentSystemPrompt}
                        onChange={(event) =>
                          updateForm(setForm, setDirty, {
                            agentSystemPrompt: event.target.value,
                          })
                        }
                        rows={10}
                      />
                    </label>
                  </section>

                  <section className="settings-section">
                    <div className="settings-section-heading">
                      <h3>压缩系统提示词</h3>
                      <span>仅用于生成上下文摘要</span>
                    </div>
                    <label className="settings-field">
                      <span>定义摘要器角色、信息取舍和压缩原则</span>
                      <textarea
                        className="compaction-profile-textarea"
                        value={form.systemPrompt}
                        onChange={(event) =>
                          updateForm(setForm, setDirty, { systemPrompt: event.target.value })
                        }
                        rows={8}
                      />
                    </label>
                    <label className="compaction-profile-check">
                      <input
                        type="checkbox"
                        checked={form.includeTaskState}
                        onChange={(event) =>
                          updateForm(setForm, setDirty, { includeTaskState: event.target.checked })
                        }
                      />
                      在存在任务状态时注入当前任务
                    </label>
                  </section>

                  <section className="settings-section">
                    <div className="settings-section-heading">
                      <h3>阶段指令</h3>
                      <span>引擎按当前压缩阶段自动选择</span>
                    </div>
                    <div className="compaction-profile-instructions">
                      <InstructionField
                        label="首次压缩"
                        value={form.instructions.initial}
                        onChange={(value) => updateInstruction(setForm, setDirty, "initial", value)}
                      />
                      <InstructionField
                        label="分块压缩"
                        value={form.instructions.chunk}
                        onChange={(value) => updateInstruction(setForm, setDirty, "chunk", value)}
                      />
                      <InstructionField
                        label="合并摘要"
                        value={form.instructions.merge}
                        onChange={(value) => updateInstruction(setForm, setDirty, "merge", value)}
                      />
                      <InstructionField
                        label="格式纠正"
                        value={form.instructions.correction}
                        onChange={(value) => updateInstruction(setForm, setDirty, "correction", value)}
                      />
                    </div>
                  </section>

                  <section className="settings-section">
                    <div className="settings-section-heading">
                      <h3>区段标题</h3>
                      <span>引擎负责固定顺序，配置只控制标题</span>
                    </div>
                    <div className="settings-grid">
                      {(
                        [
                          ["previousSummary", "已有摘要"],
                          ["taskState", "任务状态"],
                          ["transcript", "待压缩对话"],
                          ["instruction", "压缩要求"],
                        ] as const
                      ).map(([key, label]) => (
                        <label className="settings-field" key={key}>
                          <span>{label}</span>
                          <input
                            value={form.sectionTitles[key]}
                            onChange={(event) =>
                              updateSectionTitle(setForm, setDirty, key, event.target.value)
                            }
                            maxLength={100}
                          />
                        </label>
                      ))}
                    </div>
                  </section>

                  <section className="settings-section">
                    <div className="settings-section-heading">
                      <h3>摘要标题</h3>
                      <button
                        type="button"
                        className="btn btn-small"
                        onClick={() =>
                          updateForm(setForm, setDirty, { headings: [...form.headings, ""] })
                        }
                      >
                        <Plus size={13} />
                        添加标题
                      </button>
                    </div>
                    <div className="compaction-profile-headings">
                      {form.headings.map((heading, index) => (
                        <div className="compaction-profile-heading-row" key={index}>
                          <span>##</span>
                          <input
                            value={heading}
                            onChange={(event) =>
                              updateForm(setForm, setDirty, {
                                headings: form.headings.map((item, itemIndex) =>
                                  itemIndex === index ? event.target.value : item,
                                ),
                              })
                            }
                            placeholder="例如：人物状态"
                            maxLength={100}
                          />
                          <button
                            type="button"
                            className="settings-close"
                            onClick={() =>
                              updateForm(setForm, setDirty, {
                                headings:
                                  form.headings.length === 1
                                    ? [""]
                                    : form.headings.filter((_, itemIndex) => itemIndex !== index),
                              })
                            }
                            aria-label="删除标题"
                            title="删除标题"
                          >
                            <Trash2 size={14} />
                          </button>
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
              <div className="settings-footer-actions">
                {feedback !== undefined && (
                  <span className="settings-footer-message settings-footer-message-success">
                    {feedback}
                  </span>
                )}
                <button type="submit" className="btn btn-primary" disabled={saving || loading}>
                  {saving && <LoaderCircle size={14} className="settings-test-spinner" />}
                  {saving ? "保存中…" : "保存"}
                </button>
              </div>
            </footer>
          </form>
        )}
      </section>
    </div>
  )
}

const InstructionField = ({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) => (
  <label className="settings-field">
    <span>{label}</span>
    <textarea
      className="compaction-profile-textarea"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      rows={4}
    />
  </label>
)

const updateForm = (
  setForm: (updater: (current: ProfileForm) => ProfileForm) => void,
  setDirty: (value: boolean) => void,
  patch: Partial<ProfileForm>,
): void => {
  setForm((current) => ({ ...current, ...patch }))
  setDirty(true)
}

const updateInstruction = (
  setForm: (updater: (current: ProfileForm) => ProfileForm) => void,
  setDirty: (value: boolean) => void,
  key: keyof ProfileForm["instructions"],
  value: string,
): void => {
  setForm((current) => ({
    ...current,
    instructions: { ...current.instructions, [key]: value },
  }))
  setDirty(true)
}

const updateSectionTitle = (
  setForm: (updater: (current: ProfileForm) => ProfileForm) => void,
  setDirty: (value: boolean) => void,
  key: keyof ProfileForm["sectionTitles"],
  value: string,
): void => {
  setForm((current) => ({
    ...current,
    sectionTitles: { ...current.sectionTitles, [key]: value },
  }))
  setDirty(true)
}

const validateForm = (form: ProfileForm): string | undefined => {
  if (form.name.trim().length === 0) return "请填写压缩配置名称"
  const prompts = [
    form.agentSystemPrompt,
    form.systemPrompt,
    form.instructions.initial,
    form.instructions.chunk,
    form.instructions.merge,
    form.instructions.correction,
  ]
  if (prompts.some((value) => value.trim().length === 0)) return "请填写全部提示词"
  if (Object.values(form.sectionTitles).some((value) => value.trim().length === 0)) {
    return "请填写全部区段标题"
  }
  const headings = form.headings.map((heading) => heading.trim()).filter(Boolean)
  if (headings.length === 0) return "至少需要一个摘要标题"
  if (new Set(headings).size !== headings.length) return "摘要标题不能重复"
  return undefined
}

const toDraft = (form: ProfileForm): CompactionProfileDraftRequest => ({
  name: form.name.trim(),
  ...(form.description.trim().length === 0 ? {} : { description: form.description.trim() }),
  agentSystemPrompt: form.agentSystemPrompt.trim(),
  systemPrompt: form.systemPrompt.trim(),
  includeTaskState: form.includeTaskState,
  instructions: {
    initial: form.instructions.initial.trim(),
    chunk: form.instructions.chunk.trim(),
    merge: form.instructions.merge.trim(),
    correction: form.instructions.correction.trim(),
  },
  sectionTitles: {
    previousSummary: form.sectionTitles.previousSummary.trim(),
    taskState: form.sectionTitles.taskState.trim(),
    transcript: form.sectionTitles.transcript.trim(),
    instruction: form.sectionTitles.instruction.trim(),
  },
  format: {
    type: "headings",
    headings: form.headings.map((heading) => heading.trim()).filter(Boolean),
  },
})

const toForm = (profile: CompactionProfileResponse): ProfileForm => ({
  name: profile.name,
  description: profile.description ?? "",
  agentSystemPrompt: profile.agentSystemPrompt,
  systemPrompt: profile.systemPrompt,
  includeTaskState: profile.includeTaskState,
  instructions: { ...profile.instructions },
  sectionTitles: { ...profile.sectionTitles },
  headings: [...profile.format.headings],
})
