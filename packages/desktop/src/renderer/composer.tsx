import type { JsonObject } from "@easycode/schema"
import { ArrowUp, Image as ImageIcon, LoaderCircle, Plus, Square, X } from "lucide-react"
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react"

import { selectImage } from "./bridge"
import { describeError } from "./format"

const ICON_STROKE = 1.8
const MAX_INPUT_HEIGHT = 180

type PreparedImage =
  | { phase: "uploading"; path: string }
  | { phase: "ready"; path: string; content: JsonObject }
  | { phase: "error"; path: string; message: string }

export const Composer = ({
  running,
  inputDisabled = false,
  onPrepareImage,
  onSend,
  onStop,
}: {
  running: boolean
  /** 有必须通过专用卡片回答的问题时暂停普通输入。 */
  inputDisabled?: boolean
  onPrepareImage: (path: string, signal?: AbortSignal) => Promise<JsonObject>
  onSend: (text: string, imageContent?: JsonObject) => Promise<boolean>
  onStop: () => Promise<void>
}) => {
  const [draft, setDraft] = useState("")
  const [image, setImage] = useState<PreparedImage | undefined>()
  const [submitting, setSubmitting] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const upload = useRef<AbortController | undefined>(undefined)

  useEffect(() => {
    const element = input.current
    if (!element) return
    element.style.height = "auto"
    element.style.height = `${Math.min(element.scrollHeight, MAX_INPUT_HEIGHT)}px`
  }, [draft])

  useEffect(
    () => () => {
      upload.current?.abort()
    },
    [],
  )

  const chooseImage = async (): Promise<void> => {
    if (submitting || inputDisabled || image?.phase === "uploading" || image?.phase === "ready") return

    const path = await selectImage()
    if (path === undefined) return

    upload.current?.abort()
    const controller = new AbortController()
    upload.current = controller
    setImage({ phase: "uploading", path })

    try {
      const content = await onPrepareImage(path, controller.signal)
      if (!controller.signal.aborted) setImage({ phase: "ready", path, content })
    } catch (cause) {
      if (!controller.signal.aborted) setImage({ phase: "error", path, message: describeError(cause) })
    }
  }

  const removeImage = (): void => {
    upload.current?.abort()
    upload.current = undefined
    setImage(undefined)
  }

  const submit = async (event?: FormEvent): Promise<void> => {
    event?.preventDefault()
    const text = draft.trim()
    const imageContent = image?.phase === "ready" ? image.content : undefined
    if ((text.length === 0 && imageContent === undefined) || submitting || image?.phase === "uploading") return

    setSubmitting(true)
    try {
      const sent = await onSend(text, imageContent)
      if (sent) {
        setDraft("")
        setImage(undefined)
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

  const uploading = image?.phase === "uploading"
  const hasReadyImage = image?.phase === "ready"
  const canSend =
    (draft.trim().length > 0 || hasReadyImage) &&
    !submitting &&
    !uploading &&
    !inputDisabled

  return (
    <form className="composer" onSubmit={(event) => void submit(event)}>
      <textarea
        ref={input}
        className="composer-input"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={inputDisabled ? "请先回答上方问题" : "发消息…（Enter 发送，Shift+Enter 换行）"}
        rows={1}
        aria-label="消息输入框"
        disabled={submitting || inputDisabled}
      />

      {image !== undefined && (
        <div className={`composer-attachment composer-attachment-${image.phase}`}>
          <ImageIcon size={15} strokeWidth={ICON_STROKE} aria-hidden />
          <span className="composer-attachment-name" title={image.path}>
            {fileName(image.path)}
          </span>
          {image.phase === "uploading" && (
            <span className="composer-attachment-status">
              <LoaderCircle size={13} className="settings-test-spinner" />
              正在处理
            </span>
          )}
          {image.phase === "ready" && <span className="composer-attachment-status">已就绪</span>}
          {image.phase === "error" && (
            <span className="composer-attachment-error" title={image.message}>
              处理失败：{image.message}
            </span>
          )}
          <button
            type="button"
            className="composer-attachment-remove"
            onClick={removeImage}
            title="移除图片"
            aria-label="移除图片"
          >
            <X size={13} strokeWidth={2} />
          </button>
        </div>
      )}

      <div className="composer-toolbar">
        <button
          type="button"
          className="composer-plus"
          onClick={() => void chooseImage()}
          disabled={submitting || inputDisabled || uploading || hasReadyImage}
          title={uploading ? "图片正在处理" : hasReadyImage ? "每条消息最多一张图片" : "添加图片"}
        >
          <Plus size={18} strokeWidth={ICON_STROKE} />
        </button>

        <div className="composer-actions">
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

const fileName = (path: string): string => path.split(/[\\/]/).at(-1) || path
