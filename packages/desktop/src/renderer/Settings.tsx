import type { EasyCodeClient } from "@easycode/client"
import {
  type ImagePlatformInfo,
  RuntimeConfigResponse,
  type WebProvider,
} from "@easycode/protocol"
import { RotateCw, X } from "lucide-react"
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react"

import { hasHost, restartApp } from "./bridge"
import { describeError } from "./format"
import {
  base64Platform,
  readImagePlatform,
  saveImagePlatform,
} from "./image-platform"
import {
  ModelConfigSettings,
  type ModelConfigSettingsHandle,
} from "./ModelConfigs"

interface ConfigForm {
  baseUrl: string
  model: string
  contextWindow: string
  maxOutputTokens: string
  temperature: string
  apiKey: string
  extraHeaders: string
  webSearchProvider: WebProvider | ""
  webSearchApiKey: string
  webFetchProvider: WebProvider | ""
  webFetchApiKey: string
  webTimeoutMs: string
  webMaxResponseBytes: string
  logLevel: RuntimeConfigResponse["logLevel"]
}

interface ClearState {
  apiKey: boolean
  extraHeaders: boolean
  webSearchApiKey: boolean
  webFetchApiKey: boolean
}

interface SaveFeedback {
  tone: "success" | "error"
  message: string
}

const EMPTY_FORM: ConfigForm = {
  baseUrl: "",
  model: "",
  contextWindow: "128000",
  maxOutputTokens: "8192",
  temperature: "",
  apiKey: "",
  extraHeaders: "",
  webSearchProvider: "",
  webSearchApiKey: "",
  webFetchProvider: "",
  webFetchApiKey: "",
  webTimeoutMs: "30000",
  webMaxResponseBytes: "8388608",
  logLevel: "info",
}

const EMPTY_CLEAR: ClearState = {
  apiKey: false,
  extraHeaders: false,
  webSearchApiKey: false,
  webFetchApiKey: false,
}

export const SettingsDialog = ({
  client,
  open,
  onClose,
  onModelConfigsChanged,
}: {
  client: EasyCodeClient
  open: boolean
  onClose: () => void
  onModelConfigsChanged: () => Promise<void>
}) => {
  const [config, setConfig] = useState<RuntimeConfigResponse | undefined>()
  const [form, setForm] = useState<ConfigForm>(EMPTY_FORM)
  const [clear, setClear] = useState<ClearState>(EMPTY_CLEAR)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loadError, setLoadError] = useState<string | undefined>()
  const [imagePlatforms, setImagePlatforms] = useState<ImagePlatformInfo[]>([base64Platform])
  const [imagePlatform, setImagePlatform] = useState(base64Platform.platform)
  const [imagePlatformsError, setImagePlatformsError] = useState<string | undefined>()
  const [saveFeedback, setSaveFeedback] = useState<SaveFeedback | undefined>()
  const modelConfigRef = useRef<ModelConfigSettingsHandle>(null)

  const handleRuntimeLoaded = useCallback((next: {
    webSearchProvider?: WebProvider
    webFetchProvider?: WebProvider
    webTimeoutMs: number
    webMaxResponseBytes: number
    logLevel: RuntimeConfigResponse["logLevel"]
  }): void => {
    setForm((current) => ({
      ...current,
      webSearchProvider: next.webSearchProvider ?? "",
      webFetchProvider: next.webFetchProvider ?? "",
      webSearchApiKey: "",
      webFetchApiKey: "",
      webTimeoutMs: String(next.webTimeoutMs),
      webMaxResponseBytes: String(next.webMaxResponseBytes),
      logLevel: next.logLevel,
    }))
    setClear((current) => ({
      ...current,
      webSearchApiKey: false,
      webFetchApiKey: false,
    }))
  }, [])

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setLoading(true)
    setSaved(false)
    setLoadError(undefined)
    setImagePlatforms([base64Platform])
    setImagePlatform(readImagePlatform() ?? base64Platform.platform)
    setImagePlatformsError(undefined)
    setSaveFeedback(undefined)
    setClear(EMPTY_CLEAR)
    void (async () => {
      const [configResult, platformsResult] = await Promise.allSettled([
        client.config.get(controller.signal),
        client.images.platforms(controller.signal),
      ])
      if (controller.signal.aborted) return

      if (configResult.status === "fulfilled") {
        setConfig(configResult.value)
        setForm(toForm(configResult.value))
      } else {
        setLoadError(describeError(configResult.reason))
      }

      if (platformsResult.status === "fulfilled") {
        const list = platformsResult.value
        const saved = readImagePlatform()
        const selected = saved !== undefined && list.platforms.some((item) => item.platform === saved)
          ? saved
          : list.defaultPlatform
        setImagePlatforms(list.platforms)
        setImagePlatform(selected)
        saveImagePlatform(selected)
      } else {
        setImagePlatforms([base64Platform])
        setImagePlatform(base64Platform.platform)
        saveImagePlatform(base64Platform.platform)
        setImagePlatformsError(describeError(platformsResult.reason))
      }

      setLoading(false)
    })()
    return () => controller.abort()
  }, [client, open])

  useEffect(() => {
    if (!open) return
    const frame = window.requestAnimationFrame(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !saving && !restarting) onClose()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [onClose, open, restarting, saving])

  if (!open) return null

  const setField = <Key extends keyof ConfigForm>(key: Key, value: ConfigForm[Key]): void => {
    setSaved(false)
    setSaveFeedback(undefined)
    setLoadError(undefined)
    setForm((current) => ({ ...current, [key]: value }))
  }

  const setSecret = (
    field: "apiKey" | "extraHeaders" | "webSearchApiKey" | "webFetchApiKey",
    value: string,
  ): void => {
    setSaved(false)
    setSaveFeedback(undefined)
    setLoadError(undefined)
    setClear((current) => ({ ...current, [field]: false }))
    setForm((current) => ({ ...current, [field]: value }))
  }

  const toggleClear = (field: keyof ClearState): void => {
    setSaved(false)
    setSaveFeedback(undefined)
    setLoadError(undefined)
    setClear((current) => ({ ...current, [field]: !current[field] }))
    setForm((current) => ({ ...current, [field]: "" }))
  }

  const submit = async (event?: FormEvent): Promise<void> => {
    event?.preventDefault()
    if (saving) return

    const webTimeoutMs = Number(form.webTimeoutMs)
    const webMaxResponseBytes = Number(form.webMaxResponseBytes)
    if (
      !Number.isInteger(webTimeoutMs) ||
      webTimeoutMs <= 0 ||
      !Number.isInteger(webMaxResponseBytes) ||
      webMaxResponseBytes <= 0
    ) {
      setSaveFeedback({ tone: "error", message: "请填写有效的联网数值配置" })
      return
    }

    setSaving(true)
    setSaveFeedback(undefined)
    try {
      const handle = modelConfigRef.current
      if (handle === null) {
        setSaveFeedback({ tone: "error", message: "模型配置尚未加载完成" })
        return
      }
      const saved = await handle.saveWithRuntime({
        webSearchProvider: form.webSearchProvider,
        webSearchApiKey:
          clear.webSearchApiKey
            ? null
            : form.webSearchApiKey.trim().length > 0
              ? form.webSearchApiKey.trim()
              : undefined,
        clearWebSearchApiKey: clear.webSearchApiKey,
        webFetchProvider: form.webFetchProvider,
        webFetchApiKey:
          clear.webFetchApiKey
            ? null
            : form.webFetchApiKey.trim().length > 0
              ? form.webFetchApiKey.trim()
              : undefined,
        clearWebFetchApiKey: clear.webFetchApiKey,
        webTimeoutMs,
        webMaxResponseBytes,
        logLevel: form.logLevel,
      })
      if (saved !== true) return
      setClear(EMPTY_CLEAR)
      setSaved(true)
      setSaveFeedback({ tone: "success", message: "保存成功" })
    } catch (cause) {
      setSaveFeedback({ tone: "error", message: describeError(cause) })
    } finally {
      setSaving(false)
    }
  }

  const restart = async (): Promise<void> => {
    setRestarting(true)
    setSaveFeedback(undefined)
    try {
      await restartApp()
    } catch (cause) {
      setSaveFeedback({ tone: "error", message: describeError(cause) })
      setRestarting(false)
    }
  }

  return (
    <div className="settings-backdrop" role="presentation" onMouseDown={() => !saving && !restarting && onClose()}>
      <section
        className="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="settings-header">
          <div>
            <h2 id="settings-title">运行配置</h2>
            <p>配置保存在本机，不会上传到 EasyCode 服务。</p>
          </div>
          <button
            type="button"
            className="settings-close"
            onClick={onClose}
            disabled={saving || restarting}
            aria-label="关闭设置"
            title="关闭设置"
          >
            <X size={18} strokeWidth={1.8} />
          </button>
        </header>

        <form className="settings-form" onSubmit={(event) => void submit(event)}>
          <div className="settings-body">
            {loading ? (
              <div className="settings-loading">正在读取配置…</div>
            ) : (
              <>
                {config !== undefined && (
                  <div className={`settings-status${config.modelConfigured ? " settings-status-ok" : ""}`}>
                    <span className="settings-status-dot" aria-hidden />
                    {config.modelConfigured ? "模型服务已配置，可以开始使用" : "模型服务尚未配置完成"}
                  </div>
                )}

                {loadError !== undefined && <div className="settings-load-error">无法读取配置：{loadError}</div>}
                {saved && (
                  <div className="settings-saved">
                    <span>配置已保存。联网与日志设置需要重启应用；模型配置保存后立即生效。</span>
                    {hasHost && (
                      <button type="button" className="btn btn-small" onClick={() => void restart()} disabled={restarting}>
                        <RotateCw size={13} />
                        {restarting ? "正在重启…" : "立即重启"}
                      </button>
                    )}
                  </div>
                )}

                <ModelConfigSettings
                  ref={modelConfigRef}
                  client={client}
                  onChanged={onModelConfigsChanged}
                  onRuntimeLoaded={handleRuntimeLoaded}
                />

                <section className="settings-section">
                  <div className="settings-section-heading">
                    <h3>图片输入</h3>
                    <span>平台列表由服务端提供</span>
                  </div>
                  <div className="settings-grid">
                    <Field label="图片发送方式" wide>
                      <select
                        value={imagePlatform}
                        onChange={(event) => {
                          const next = event.target.value
                          setImagePlatform(next)
                          saveImagePlatform(next)
                        }}
                      >
                        {imagePlatforms.map((item) => (
                          <option key={item.platform} value={item.platform}>
                            {item.displayName}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <p className="settings-note">
                    {imagePlatformsError === undefined
                      ? "该选择只保存在当前客户端；服务端会校验不存在的平台并回退 Base64。"
                      : `无法加载服务端图片平台，已回退 Base64：${imagePlatformsError}`}
                  </p>
                </section>

                <section className="settings-section">
                  <div className="settings-section-heading">
                    <h3>联网能力</h3>
                    <span>搜索和网页读取可分别配置</span>
                  </div>
                  <div className="settings-grid">
                    <Field label="搜索服务">
                      <select
                        value={form.webSearchProvider}
                        onChange={(event) => setField("webSearchProvider", event.target.value as WebProvider | "")}
                      >
                        <option value="">不启用</option>
                        <option value="deepseek">DeepSeek Search</option>
                        <option value="glm">GLM Web Search</option>
                        <option value="tavily">Tavily Search</option>
                      </select>
                    </Field>
                    <SecretField
                      label="搜索 API Key"
                      configured={config?.hasWebSearchApiKey === true}
                      clearing={clear.webSearchApiKey}
                      value={form.webSearchApiKey}
                      placeholder={
                        config?.hasWebSearchApiKey === true ? "已保存，输入新密钥可替换" : "请输入搜索 API Key"
                      }
                      onChange={(value) => setSecret("webSearchApiKey", value)}
                      onToggleClear={() => toggleClear("webSearchApiKey")}
                    />
                    <Field label="网页读取服务">
                      <select
                        value={form.webFetchProvider}
                        onChange={(event) => setField("webFetchProvider", event.target.value as WebProvider | "")}
                      >
                        <option value="">不启用</option>
                        <option value="deepseek">DeepSeek Fetch</option>
                        <option value="glm">GLM Reader</option>
                        <option value="tavily">Tavily Extract</option>
                      </select>
                    </Field>
                    <SecretField
                      label="网页读取 API Key"
                      configured={config?.hasWebFetchApiKey === true}
                      clearing={clear.webFetchApiKey}
                      value={form.webFetchApiKey}
                      placeholder={
                        config?.hasWebFetchApiKey === true ? "已保存，输入新密钥可替换" : "请输入网页读取 API Key"
                      }
                      onChange={(value) => setSecret("webFetchApiKey", value)}
                      onToggleClear={() => toggleClear("webFetchApiKey")}
                    />
                    <Field label="联网超时" hint="单位毫秒，最大 120000。">
                      <input
                        type="number"
                        min={1}
                        max={120000}
                        step={1}
                        value={form.webTimeoutMs}
                        onChange={(event) => setField("webTimeoutMs", event.target.value)}
                      />
                    </Field>
                    <Field label="联网响应上限" hint="单位字节，最大 32 MB。">
                      <input
                        type="number"
                        min={1}
                        max={32 * 1024 * 1024}
                        step={1}
                        value={form.webMaxResponseBytes}
                        onChange={(event) => setField("webMaxResponseBytes", event.target.value)}
                      />
                    </Field>
                  </div>
                  <p className="settings-note">服务与对应密钥都配置后，Agent 才会获得相应工具。</p>
                </section>

                <section className="settings-section">
                  <div className="settings-section-heading">
                    <h3>本地运行</h3>
                    <span>修改后需要重启</span>
                  </div>
                  <div className="settings-grid">
                    <Field label="日志级别">
                      <select
                        value={form.logLevel}
                        onChange={(event) =>
                          setField("logLevel", event.target.value as RuntimeConfigResponse["logLevel"])
                        }
                      >
                        <option value="debug">debug</option>
                        <option value="info">info</option>
                        <option value="warn">warn</option>
                        <option value="error">error</option>
                      </select>
                    </Field>
                  </div>
                  {config !== undefined && (
                    <>
                      <p className="settings-path">
                        配置文件路径：<code>{config.configFile}</code>
                      </p>
                      <p className="settings-path">
                        数据目录：<code>~/easycode/.easycode</code>
                      </p>
                    </>
                  )}
                </section>
              </>
            )}
          </div>

          <footer className="settings-footer">
            {saveFeedback !== undefined && (
              <span className={`settings-footer-message settings-footer-message-${saveFeedback.tone}`}>
                {saveFeedback.message}
              </span>
            )}
            <div className="settings-footer-actions">
              <button type="button" className="btn" onClick={onClose} disabled={saving || restarting}>
                取消
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={loading || saving || restarting}
              >
                {saving ? "保存中…" : "保存配置"}
              </button>
            </div>
          </footer>
        </form>
      </section>
    </div>
  )
}

const Field = ({
  label,
  hint,
  wide = false,
  children,
}: {
  label: string
  hint?: string
  wide?: boolean
  children: React.ReactNode
}) => (
  <label className={`settings-field${wide ? " settings-field-wide" : ""}`}>
    <span className="settings-label">{label}</span>
    {children}
    {hint !== undefined && <span className="settings-hint">{hint}</span>}
  </label>
)

const SecretField = ({
  label,
  configured,
  clearing,
  value,
  placeholder,
  hint,
  masked = true,
  onChange,
  onToggleClear,
}: {
  label: string
  configured: boolean
  clearing: boolean
  value: string
  placeholder: string
  hint?: string
  masked?: boolean
  onChange: (value: string) => void
  onToggleClear: () => void
}) => (
  <label className="settings-field">
    <span className="settings-label-row">
      <span className="settings-label">{label}</span>
      <span className="settings-secret-meta">
        <span className={configured && !clearing ? "settings-key-state settings-key-state-ok" : "settings-key-state"}>
          {clearing ? "保存后清除" : configured ? "已保存" : "未配置"}
        </span>
        {configured && (
          <button type="button" className="settings-clear-secret" onClick={onToggleClear}>
            {clearing ? "取消" : "清除"}
          </button>
        )}
      </span>
    </span>
    <input
      type={masked ? "password" : "text"}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={clearing ? "保存后将清除当前值" : placeholder}
      disabled={clearing}
      spellCheck={false}
    />
    {hint !== undefined && <span className="settings-hint">{hint}</span>}
  </label>
)

const toForm = (config: RuntimeConfigResponse): ConfigForm => ({
  baseUrl: config.baseUrl,
  model: config.model,
  contextWindow: String(config.contextWindow),
  maxOutputTokens: String(config.maxOutputTokens),
  temperature: config.temperature === undefined ? "" : String(config.temperature),
  apiKey: "",
  extraHeaders: "",
  webSearchProvider: config.webSearchProvider ?? "",
  webSearchApiKey: "",
  webFetchProvider: config.webFetchProvider ?? "",
  webFetchApiKey: "",
  webTimeoutMs: String(config.webTimeoutMs),
  webMaxResponseBytes: String(config.webMaxResponseBytes),
  logLevel: config.logLevel,
})
