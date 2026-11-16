import type { Content, JsonObject, Message, Part } from "@easycode/schema"
import { Copy, Ellipsis, LoaderCircle } from "lucide-react"
import { useEffect, useState, type ComponentProps } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import { summarizeToolInput } from "./format"
import { cachedImagePreview } from "./image-preview-cache"

const ICON_STROKE = 1.8
const REMARK_PLUGINS = [remarkGfm]

const MarkdownTable = (props: ComponentProps<"table">) => (
  <div className="markdown-table-scroll">
    <table {...props} />
  </div>
)

const MARKDOWN_COMPONENTS = { table: MarkdownTable }

const Markdown = ({ text }: { text: string }) => (
  <div className="markdown">
    <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={MARKDOWN_COMPONENTS}>
      {text}
    </ReactMarkdown>
  </div>
)

const ReasoningBlock = ({ text }: { text: string }) => {
  const [open, setOpen] = useState(false)
  return (
    <div className="reasoning">
      <button type="button" className="reasoning-toggle" onClick={() => setOpen((value) => !value)}>
        {open ? "▾" : "▸"} 思考过程
      </button>
      {open && <pre className="reasoning-body">{text}</pre>}
    </div>
  )
}

type ToolPart = Extract<Part, { type: "tool" }>

const ToolCard = ({ part }: { part: ToolPart }) => {
  const [open, setOpen] = useState(false)
  const view = toToolView(part)
  const state = part.state.status === "pending" ? "running" : view.ok ? "success" : "error"

  return (
    <div className={`tool-card tool-${state}`}>
      <button type="button" className="tool-header" onClick={() => setOpen((value) => !value)}>
        <span className={`tool-dot tool-dot-${state}`} aria-hidden />
        <span className="tool-name">{part.name}</span>
        <span className="tool-summary">{summarizeToolInput(part.input)}</span>
        <span className="tool-chevron">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="tool-body">
          {part.state.status === "pending" ? (
            <div className="tool-pending">执行中…</div>
          ) : (
            <pre className="tool-output">{view.text}</pre>
          )}
          {view.outputPaths.length > 0 && (
            <div className="tool-paths">完整输出已落盘：{view.outputPaths.join("、")}</div>
          )}
          {view.changedPaths.length > 0 && (
            <div className="tool-paths">修改文件：{view.changedPaths.join("、")}</div>
          )}
        </div>
      )}
    </div>
  )
}

const toolStateView = (part: Exclude<ToolPart["state"], { status: "pending" }>) => ({
  ok: part.status === "success",
  text: contentText(part.content ?? []) || (part.status === "error" ? part.error : "（工具执行完成，没有输出）"),
  outputPaths: part.outputPaths ?? [],
  changedPaths: part.metadata?.changedPaths ?? [],
})

const toToolView = (part: ToolPart) =>
  part.state.status === "pending"
    ? { ok: true, text: "", outputPaths: [], changedPaths: [] }
    : toolStateView(part.state)

const contentText = (content: Content[]): string =>
  content
    .map((part) => (part.type === "text" ? part.text : `[附件 ${part.name ?? part.mime}]`))
    .join("\n")

const Attachment = ({ part }: { part: Extract<Part, { type: "file" }> }) => (
  <div className="message-file">附件：{part.name ?? part.mime}</div>
)

const AssistantParts = ({ message }: { message: Extract<Message, { role: "assistant" }> }) => (
  <>
    {message.parts.map((part, index) => {
      switch (part.type) {
        case "text":
          return <Markdown key={`text-${index}`} text={part.text} />
        case "reasoning":
          return <ReasoningBlock key={`reasoning-${index}`} text={part.text} />
        case "tool":
          return <ToolCard key={part.callID} part={part} />
        case "file":
          return <Attachment key={`file-${index}`} part={part} />
      }
    })}
  </>
)

const isUserText = (part: JsonObject): boolean =>
  part.type === "text" && typeof part.text === "string"

const dataImageURL = (part: JsonObject): string | undefined => {
  if (part.type !== "image_url" || typeof part.image_url !== "object" || part.image_url === null) return undefined
  if (!("url" in part.image_url) || typeof part.image_url.url !== "string") return undefined
  return part.image_url.url.startsWith("data:image/") ? part.image_url.url : undefined
}

type ImagePreviewState =
  | { phase: "loading" }
  | { phase: "ready"; url: string }
  | { phase: "missing" }

const UserImage = ({ content }: { content: JsonObject }) => {
  const direct = dataImageURL(content)
  const [preview, setPreview] = useState<ImagePreviewState>(
    direct === undefined ? { phase: "loading" } : { phase: "ready", url: direct },
  )

  useEffect(() => {
    if (direct !== undefined) {
      setPreview({ phase: "ready", url: direct })
      return
    }

    let active = true
    setPreview({ phase: "loading" })
    void cachedImagePreview(content).then((url) => {
      if (!active) return
      setPreview(url === undefined ? { phase: "missing" } : { phase: "ready", url })
    })
    return () => {
      active = false
    }
  }, [content, direct])

  if (preview.phase === "ready") {
    return <img className="message-image" src={preview.url} alt="用户上传的图片" />
  }
  if (preview.phase === "loading") {
    return (
      <div className="message-image message-image-placeholder" aria-label="正在加载图片预览">
        <LoaderCircle size={16} className="settings-test-spinner" />
      </div>
    )
  }
  return <div className="message-file">附件：图片</div>
}

const CopyButton = ({ text }: { text: string }) => {
  const [copied, setCopied] = useState(false)

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  return (
    <button
      type="button"
      className="message-action"
      title={copied ? "已复制" : "复制这条回复"}
      data-copied={copied}
      aria-label={copied ? "已复制" : "复制这条回复"}
      onClick={() => void copy()}
    >
      <Copy size={14} strokeWidth={ICON_STROKE} />
    </button>
  )
}

const MessageActions = ({ text }: { text: string }) => (
  <div className="message-actions">
    <CopyButton text={text} />
    <button type="button" className="message-action" disabled title="更多操作暂未支持">
      <Ellipsis size={14} strokeWidth={ICON_STROKE} />
    </button>
  </div>
)

const messageText = (message: Message): string => {
  if (message.role === "assistant") {
    return [
      ...message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])),
      ...(message.error ? [message.error] : []),
    ].join("\n\n")
  }
  if (message.role === "user") {
    return message.content
      .flatMap((part) => (part.type === "text" && typeof part.text === "string" ? [part.text] : []))
      .join("\n\n")
  }
  return ""
}

export const MessageView = ({ message }: { message: Message }) => {
  if (message.role === "user") {
    const images = message.content.filter((part) => !isUserText(part))
    const texts = message.content.filter(isUserText)
    return (
      <article className="message message-user-group" data-message-id={message.id}>
        {images.length > 0 && (
          <div className="message-user-images">
            {images.map((part, index) => (
              <UserImage key={`image-${index}`} content={part} />
            ))}
          </div>
        )}
        {texts.length > 0 && (
          <div className="message-user-bubble">
            {texts.map((part, index) => (
              <div key={`text-${index}`} className="plain-text">
                {part.text as string}
              </div>
            ))}
          </div>
        )}
      </article>
    )
  }

  if (message.role !== "assistant") return null

  return (
    <article className="message message-assistant" data-message-id={message.id}>
      <AssistantParts message={message} />
      {message.error !== undefined && <div className="message-error">{message.error}</div>}
      {message.completedAt === undefined && (
        <div className="message-running" aria-label="正在生成">
          <span />
        </div>
      )}
      <MessageActions text={messageText(message)} />
    </article>
  )
}
