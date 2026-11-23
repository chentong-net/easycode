import type { JsonObject } from "@easycode/schema"
import type { PromptProfileSummary, ModelConfigSummary } from "@easycode/protocol"
import type { ReasoningEffort } from "@easycode/schema"
import { ArrowUp, Bot, Image as ImageIcon, LoaderCircle, Plus, Square, X } from "lucide-react"
import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react"

import { saveClipboardImage, selectImages } from "./bridge"
import { describeError } from "./format"
import { cacheImagePreview } from "./image-preview-cache"

const ICON_STROKE = 1.8
const MAX_INPUT_HEIGHT = 180
const IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"])

type ImageItem = {
  id: string
  path: string
  preview?: string
  phase: "uploading" | "ready" | "error"
  content?: JsonObject
  error?: string
}

interface ImageSelection {
  path: string
  preview?: string
}

export const Composer = ({
  running,
  inputDisabled = false,
  promptProfiles,
  promptProfileID,
  modelConfigs,
  modelConfigID,
  availableReasoningEfforts,
  reasoningEffort,
  configurationLocked,
  configurationComplete,
  onPromptProfileChange,
  onModelConfigChange,
  onReasoningEffortChange,
  onPrepareImage,
  onSend,
  onStop,
}: {
  running: boolean
  /** 有必须通过专用卡片回答的问题时暂停普通输入。 */
  inputDisabled?: boolean
  promptProfiles: PromptProfileSummary[]
  promptProfileID: string
  modelConfigs: ModelConfigSummary[]
  modelConfigID: string
  availableReasoningEfforts: ReasoningEffort[]
  reasoningEffort: ReasoningEffort | ""
  configurationLocked: boolean
  configurationComplete: boolean
  onPromptProfileChange: (profileID: string) => void
  onModelConfigChange: (modelConfigID: string) => void
  onReasoningEffortChange: (effort: ReasoningEffort | "") => void
  onPrepareImage: (path: string, signal?: AbortSignal) => Promise<JsonObject>
  onSend: (text: string, imageContents: JsonObject[]) => Promise<boolean>
  onStop: () => Promise<void>
}) => {
  const [draft, setDraft] = useState("")
  const [images, setImages] = useState<ImageItem[]>([])
  const [pasteError, setPasteError] = useState<string | undefined>()
  const [submitting, setSubmitting] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const uploads = useRef(new Map<string, AbortController>())
  const imageSequence = useRef(0)

  useEffect(() => {
    const element = input.current
    if (!element) return
    element.style.height = "auto"
    element.style.height = `${Math.min(element.scrollHeight, MAX_INPUT_HEIGHT)}px`
  }, [draft])

  useEffect(
    () => () => {
      for (const controller of uploads.current.values()) controller.abort()
      uploads.current.clear()
    },
    [],
  )

  const nextImageID = (): string => {
    imageSequence.current += 1
    return `image-${Date.now()}-${imageSequence.current}`
  }

  const updateImage = (id: string, update: Partial<ImageItem>): void => {
    setImages((current) => current.map((item) => (item.id === id ? { ...item, ...update } : item)))
  }

  const prepareImage = async (item: ImageItem): Promise<void> => {
    const controller = new AbortController()
    uploads.current.set(item.id, controller)
    try {
      const content = await onPrepareImage(item.path, controller.signal)
      if (!controller.signal.aborted) {
        await cacheImagePreview(content, item.preview)
      }
      if (!controller.signal.aborted) {
        updateImage(item.id, { phase: "ready", content, error: undefined })
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        updateImage(item.id, { phase: "error", content: undefined, error: describeError(cause) })
      }
    } finally {
      uploads.current.delete(item.id)
    }
  }

  const addSelections = (selections: ImageSelection[]): void => {
    if (selections.length === 0) return
    const items: ImageItem[] = selections.map((selection) => ({
      id: nextImageID(),
      path: selection.path,
      ...(selection.preview === undefined ? {} : { preview: selection.preview }),
      phase: "uploading",
    }))
    setImages((current) => [...current, ...items])
    for (const item of items) void prepareImage(item)
  }

  const chooseImages = async (): Promise<void> => {
    if (submitting || inputDisabled) return
    try {
      addSelections(await selectImages())
    } catch (cause) {
      setPasteError(describeError(cause))
    }
  }

  const pasteImages = async (files: File[]): Promise<void> => {
    setPasteError(undefined)
    const results = await Promise.allSettled(files.map((file) => saveClipboardImage(file)))
    const selections: ImageSelection[] = []
    let failed = 0
    for (const result of results) {
      if (result.status === "fulfilled") selections.push(result.value)
      else failed += 1
    }
    if (failed > 0) setPasteError(`${failed} 张图片保存失败，请重新复制后再试`)
    addSelections(selections)
  }

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>): void => {
    const fromItems = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file")
      .flatMap((item) => {
        const file = item.getAsFile()
        return file === null ? [] : [file]
      })
    const files = fromItems.length > 0 ? fromItems : Array.from(event.clipboardData.files)
    const imageFiles = files.filter((file) => IMAGE_MIMES.has(file.type))
    if (imageFiles.length === 0) return
    event.preventDefault()
    void pasteImages(imageFiles)
  }

  const removeImage = (id: string): void => {
    uploads.current.get(id)?.abort()
    uploads.current.delete(id)
    setImages((current) => current.filter((item) => item.id !== id))
  }

  const submit = async (event?: FormEvent): Promise<void> => {
    event?.preventDefault()
    const text = draft.trim()
    const imageContents = images.flatMap((item) => (item.phase === "ready" && item.content ? [item.content] : []))
    const allImagesReady = images.every((item) => item.phase === "ready")
    if (
      (text.length === 0 && imageContents.length === 0) ||
      !allImagesReady ||
      submitting
    ) {
      return
    }

    setSubmitting(true)
    try {
      const sent = await onSend(text, imageContents)
      if (sent) {
        setDraft("")
        setImages([])
        setPasteError(undefined)
      }
    } finally {
      setSubmitting(false)
      input.current?.focus()
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== "Enter" || event.shiftKey) return
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    void submit(event)
  }

  const uploading = images.some((item) => item.phase === "uploading")
  const allImagesReady = images.every((item) => item.phase === "ready")
  const hasReadyImage = images.some((item) => item.phase === "ready")
  const selectedProfile = promptProfiles.find((profile) => profile.id === promptProfileID)
  const selectedModel = modelConfigs.find((config) => config.id === modelConfigID)
  const profileOptions = promptProfiles.length
    ? promptProfiles
    : [fallbackCodingProfile()]
  const profilesLoaded = promptProfiles.length > 0
  const profileMissing =
    profilesLoaded &&
    promptProfileID.length > 0 &&
    selectedProfile === undefined &&
    promptProfileID !== "coding"
  const profileLoading =
    !profilesLoaded &&
    promptProfileID.length > 0 &&
    selectedProfile === undefined &&
    promptProfileID !== "coding"
  const canSend =
    (draft.trim().length > 0 || hasReadyImage) &&
    allImagesReady &&
    !uploading &&
    !submitting &&
    !inputDisabled &&
    configurationComplete

  return (
    <form className="composer" onSubmit={(event) => void submit(event)}>
      {(images.length > 0 || pasteError !== undefined) && (
        <div className="composer-attachments" aria-live="polite">
          {images.map((item) => (
            <div
              className={`composer-image composer-image-${item.phase}`}
              key={item.id}
              title={item.error ?? item.path}
            >
              {item.preview === undefined ? (
                <ImageIcon size={22} strokeWidth={ICON_STROKE} aria-hidden />
              ) : (
                <img src={item.preview} alt="" draggable={false} />
              )}
              {item.phase === "uploading" && (
                <span className="composer-image-overlay" aria-label="图片正在处理">
                  <LoaderCircle size={17} className="settings-test-spinner" />
                </span>
              )}
              {item.phase === "error" && (
                <span className="composer-image-overlay composer-image-error" aria-label="图片处理失败">
                  失败
                </span>
              )}
              <button
                type="button"
                className="composer-image-remove"
                onClick={() => removeImage(item.id)}
                title="移除图片"
                aria-label="移除图片"
              >
                <X size={12} strokeWidth={2.2} />
              </button>
            </div>
          ))}
          {pasteError !== undefined && <div className="composer-paste-error">{pasteError}</div>}
        </div>
      )}

      <textarea
        ref={input}
        className="composer-input"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onPaste={onPaste}
        onKeyDown={onKeyDown}
        placeholder={inputDisabled ? "请先回答上方问题" : "发消息…（Enter 发送，Shift+Enter 换行）"}
        rows={1}
        aria-label="消息输入框"
        disabled={submitting || inputDisabled}
      />

      <div className="composer-toolbar">
        <button
          type="button"
          className="composer-plus"
          onClick={() => void chooseImages()}
          disabled={submitting || inputDisabled}
          title="添加图片"
        >
          <Plus size={18} strokeWidth={ICON_STROKE} />
        </button>

        <div className="composer-actions">
          <label
            className="composer-profile"
            title={configurationLocked ? "会话正在运行，暂不能更换模型配置" : "选择模型配置"}
          >
            <select
              value={modelConfigID}
              onChange={(event) => onModelConfigChange(event.target.value)}
              disabled={configurationLocked || submitting || inputDisabled}
              aria-label="模型配置"
            >
              <option value="">请选择模型配置</option>
              {modelConfigs.map((config) => (
                <option value={config.id} key={config.id}>
                  {config.name}
                </option>
              ))}
              {modelConfigID.length > 0 &&
                !modelConfigs.some((config) => config.id === modelConfigID) && (
                  <option value={modelConfigID}>模型配置已丢失</option>
                )}
            </select>
          </label>
          <label
            className="composer-profile"
            title={profileTitle(configurationLocked, profileMissing, profileLoading)}
          >
            <Bot size={14} strokeWidth={ICON_STROKE} aria-hidden />
            <select
              value={promptProfileID}
              onChange={(event) => onPromptProfileChange(event.target.value)}
              disabled={configurationLocked || submitting || inputDisabled}
              aria-label="提示配置"
            >
              <option value="">请选择提示配置</option>
              {profileMissing && (
                <option value={promptProfileID}>提示配置已丢失</option>
              )}
              {profileLoading && (
                <option value={promptProfileID}>正在读取提示配置…</option>
              )}
              {profileOptions.map((profile) => (
                <option value={profile.id} key={profile.id}>
                  {profile.name}
                  {profile.id === "coding" ? "（默认）" : ""}
                </option>
              ))}
            </select>
          </label>
          {selectedModel !== undefined && selectedModel.supportedReasoningEfforts.length > 0 && (
            <label
              className="composer-profile"
              title={configurationLocked ? "会话正在运行，暂不能更换思考强度" : "选择思考强度"}
            >
              <select
                value={reasoningEffort}
                onChange={(event) =>
                  onReasoningEffortChange(event.target.value as ReasoningEffort | "")
                }
                disabled={configurationLocked || submitting || inputDisabled}
                aria-label="思考强度"
              >
                <option value="">不指定（模型默认）</option>
                {(selectedModel?.supportedReasoningEfforts ?? availableReasoningEfforts).map(
                  (effort) => (
                    <option value={effort} key={effort}>
                      {formatReasoningEffort(effort)}
                    </option>
                  ),
                )}
              </select>
            </label>
          )}
          {running && (
            <button
              type="button"
              className="composer-send composer-stop"
              title="停止生成"
              aria-label="停止生成"
              onClick={() => void onStop()}
            >
              <Square size={12} strokeWidth={0} fill="currentColor" />
            </button>
          )}
          <button
            type="submit"
            className="composer-send"
            title={uploading ? "请等待图片处理完成" : running ? "发送插话" : "发送"}
            aria-label={running ? "发送插话" : "发送消息"}
            disabled={!canSend}
          >
            <ArrowUp size={17} strokeWidth={2.4} />
          </button>
        </div>
      </div>
    </form>
  )
}

const fallbackCodingProfile = (): PromptProfileSummary => ({
  id: "coding",
  name: "编程",
  description: "默认编程与代码修改场景",
  createdAt: 0,
  updatedAt: 0,
})

const profileTitle = (locked: boolean, missing: boolean, loading: boolean): string => {
  if (loading) return "正在读取当前会话的提示配置"
  if (missing) return "当前会话使用的提示配置已丢失"
  if (locked) return "会话正在运行，暂不能更换提示配置"
  return "选择新会话使用的提示配置"
}

const formatReasoningEffort = (effort: ReasoningEffort): string =>
  effort === "none"
    ? "None"
    : effort.charAt(0).toUpperCase() + effort.slice(1)
