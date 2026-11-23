import type { EasyCodeClient } from "@easycode/client"
import type {
  ModelConfigResponse,
  ModelConfigSummary,
  ModelConfigUpdateRequest,
} from "@easycode/protocol"
import type { ReasoningEffort } from "@easycode/schema"
import { AlertCircle, Check, LoaderCircle, Plus, Trash2 } from "lucide-react"
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
} from "react"

import { describeError } from "./format"

interface ModelConfigForm {
  name: string
  baseUrl: string
  model: string
  contextWindow: string
  maxOutputTokens: string
  temperature: string
  apiKey: string
  extraHeaders: string
  clearApiKey: boolean
  clearHeaders: boolean
  supportedReasoningEfforts: ReasoningEffort[]
}

type TestState =
  | { phase: "idle" }
  | { phase: "testing" }
  | { phase: "success"; latencyMs: number }
  | { phase: "error"; message: string }

export interface ModelConfigRuntimeInput {
  webSearchProvider: ModelConfigUpdateRequest["webSearchProvider"]
  webSearchApiKey?: string | null
  clearWebSearchApiKey: boolean
  webFetchProvider: ModelConfigUpdateRequest["webFetchProvider"]
  webFetchApiKey?: string | null
  clearWebFetchApiKey: boolean
  webTimeoutMs: number
  webMaxResponseBytes: number
  logLevel: ModelConfigUpdateRequest["logLevel"]
}

export interface ModelConfigRuntimeMetadata {
  webSearchProvider?: ModelConfigUpdateRequest["webSearchProvider"]
  hasWebSearchApiKey: boolean
  webFetchProvider?: ModelConfigUpdateRequest["webFetchProvider"]
  hasWebFetchApiKey: boolean
  webTimeoutMs: number
  webMaxResponseBytes: number
  logLevel: ModelConfigUpdateRequest["logLevel"]
}

export interface ModelConfigSettingsHandle {
  saveWithRuntime(input: ModelConfigRuntimeInput): Promise<boolean>
}

const EMPTY_FORM: ModelConfigForm = {
  name: "",
  baseUrl: "",
  model: "",
  contextWindow: "128000",
  maxOutputTokens: "8192",
  temperature: "",
  apiKey: "",
  extraHeaders: "",
  clearApiKey: false,
  clearHeaders: false,
  supportedReasoningEfforts: [],
}

export const ModelConfigSettings = forwardRef<ModelConfigSettingsHandle, {
  client: EasyCodeClient
  onChanged: () => Promise<void>
  onRuntimeLoaded: (config: ModelConfigRuntimeMetadata) => void
}>(({ client, onChanged, onRuntimeLoaded }, ref) => {
  const [configs, setConfigs] = useState<ModelConfigSummary[]>([])
  const [availableEfforts, setAvailableEfforts] = useState<ReasoningEffort[]>([])
  const [selectedID, setSelectedID] = useState<string | undefined>()
  const [config, setConfig] = useState<ModelConfigResponse | undefined>()
  const [form, setForm] = useState<ModelConfigForm>(EMPTY_FORM)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [feedback, setFeedback] = useState<string | undefined>()
  const [test, setTest] = useState<TestState>({ phase: "idle" })

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(undefined)
    void (async () => {
      try {
        const result = await client.modelConfigs.list(controller.signal)
        if (controller.signal.aborted) return
        setConfigs(result.configs)
        setAvailableEfforts(result.availableReasoningEfforts)
        const next = result.configs[0]
        if (next) setSelectedID(next.id)
        else {
          setSelectedID(undefined)
          setConfig(undefined)
          setForm(EMPTY_FORM)
          onRuntimeLoaded(emptyRuntimeMetadata())
        }
      } catch (cause) {
        if (!controller.signal.aborted) setError(describeError(cause))
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })()
    return () => controller.abort()
  }, [client, onRuntimeLoaded])

  useEffect(() => {
    if (selectedID === undefined) return
    const controller = new AbortController()
    setLoading(true)
    setError(undefined)
    setFeedback(undefined)
    setTest({ phase: "idle" })
    onRuntimeLoaded(emptyRuntimeMetadata())
    void (async () => {
      try {
        const next = await client.modelConfigs.get(selectedID, controller.signal)
        if (controller.signal.aborted) return
        setConfig(next)
        setForm(toForm(next))
        onRuntimeLoaded(next)
      } catch (cause) {
        if (!controller.signal.aborted) setError(describeError(cause))
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })()
    return () => controller.abort()
  }, [client, onRuntimeLoaded, selectedID])

  const refreshList = async (preferredID?: string): Promise<void> => {
    const result = await client.modelConfigs.list()
    setConfigs(result.configs)
    setAvailableEfforts(result.availableReasoningEfforts)
    const nextID =
      preferredID !== undefined &&
      result.configs.some((item) => item.id === preferredID)
        ? preferredID
        : result.configs[0]?.id
    setSelectedID(nextID)
    if (nextID === undefined) {
      setConfig(undefined)
      setForm(EMPTY_FORM)
    }
  }

  const beginCreate = (): void => {
    setSelectedID(undefined)
    setConfig(undefined)
    setForm(EMPTY_FORM)
    setError(undefined)
    setFeedback(undefined)
    setTest({ phase: "idle" })
  }

  const setField = <Key extends keyof ModelConfigForm>(
    key: Key,
    value: ModelConfigForm[Key],
  ): void => {
    setFeedback(undefined)
    setError(undefined)
    setTest({ phase: "idle" })
    setForm((current) => ({ ...current, [key]: value }))
  }

  const toggleEffort = (effort: ReasoningEffort): void => {
    setFeedback(undefined)
    setError(undefined)
    setForm((current) => ({
      ...current,
      supportedReasoningEfforts: current.supportedReasoningEfforts.includes(effort)
        ? current.supportedReasoningEfforts.filter((item) => item !== effort)
        : [...current.supportedReasoningEfforts, effort],
    }))
  }

  const save = async (runtime: ModelConfigRuntimeInput): Promise<boolean> => {
    if (saving) return false
    const contextWindow = Number(form.contextWindow)
    const maxOutputTokens = Number(form.maxOutputTokens)
    const temperatureText = form.temperature.trim()
    const temperature = temperatureText.length === 0 ? null : Number(temperatureText)
    if (
      form.name.trim().length === 0 ||
      form.baseUrl.trim().length === 0 ||
      form.model.trim().length === 0 ||
      !Number.isInteger(contextWindow) ||
      contextWindow <= 0 ||
      !Number.isInteger(maxOutputTokens) ||
      maxOutputTokens <= 0 ||
      (temperature !== null && !Number.isFinite(temperature))
    ) {
      setError("请填写有效的名称、接口地址、模型 ID 和数值配置")
      return false
    }

    const input: ModelConfigUpdateRequest = {
      name: form.name.trim(),
      baseUrl: form.baseUrl.trim(),
      model: form.model.trim(),
      contextWindow,
      maxOutputTokens,
      temperature,
      supportedReasoningEfforts: form.supportedReasoningEfforts,
      ...secretInput("apiKey", form.apiKey, form.clearApiKey),
      ...secretInput("extraHeaders", form.extraHeaders, form.clearHeaders),
      webSearchProvider: runtime.webSearchProvider,
      ...secretInput(
        "webSearchApiKey",
        runtime.webSearchApiKey ?? "",
        runtime.clearWebSearchApiKey,
      ),
      webFetchProvider: runtime.webFetchProvider,
      ...secretInput(
        "webFetchApiKey",
        runtime.webFetchApiKey ?? "",
        runtime.clearWebFetchApiKey,
      ),
      webTimeoutMs: runtime.webTimeoutMs,
      webMaxResponseBytes: runtime.webMaxResponseBytes,
      logLevel: runtime.logLevel,
    }
    setSaving(true)
    setError(undefined)
    setFeedback(undefined)
    try {
      const next =
        selectedID === undefined
          ? await client.modelConfigs.create(input)
          : await client.modelConfigs.update(selectedID, input)
      setConfig(next)
      setForm(toForm(next))
      onRuntimeLoaded(next)
      setSelectedID(next.id)
      await refreshList(next.id)
      await onChanged()
      setFeedback("配置已保存，已立即生效")
      return true
    } catch (cause) {
      setError(describeError(cause))
      return false
    } finally {
      setSaving(false)
    }
  }

  const remove = async (): Promise<void> => {
    if (selectedID === undefined || deleting) return
    if (!window.confirm(`确定删除模型配置“${config?.name ?? form.name}”吗？\n\n正在使用它的会话将无法继续对话。`)) {
      return
    }
    setDeleting(true)
    setError(undefined)
    setFeedback(undefined)
    try {
      await client.modelConfigs.delete(selectedID)
      await refreshList()
      await onChanged()
      setFeedback("模型配置已删除")
    } catch (cause) {
      setError(describeError(cause))
    } finally {
      setDeleting(false)
    }
  }

  const testConnection = async (): Promise<void> => {
    if (test.phase === "testing") return
    setTest({ phase: "testing" })
    try {
      const result =
        selectedID === undefined
          ? await client.config.test({
              baseUrl: form.baseUrl,
              model: form.model,
              ...(form.apiKey.trim().length > 0
                ? { apiKey: form.apiKey.trim() }
                : {}),
              ...(form.extraHeaders.trim().length > 0
                ? { extraHeaders: form.extraHeaders.trim() }
                : {}),
            })
          : await client.modelConfigs.test(selectedID)
      setTest(
        result.ok
          ? { phase: "success", latencyMs: result.latencyMs }
          : { phase: "error", message: result.message ?? "连接测试失败" },
      )
    } catch (cause) {
      setTest({ phase: "error", message: describeError(cause) })
    }
  }

  useImperativeHandle(ref, () => ({ saveWithRuntime: save }))

  return (
    <section
      className="settings-section"
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
          event.preventDefault()
        }
      }}
    >
      <div className="settings-section-heading">
        <h3>模型配置</h3>
        <button type="button" className="btn btn-small" onClick={beginCreate}>
          <Plus size={13} />
          新建模型配置
        </button>
      </div>

      <div className="model-config-list">
        {configs.map((item, index) => (
          <button
            type="button"
            className={`model-config-list-item${selectedID === item.id ? " model-config-list-item-active" : ""}`}
            key={item.id}
            onClick={() => setSelectedID(item.id)}
          >
            <span>
              <strong>{item.name}</strong>
              <small>{item.model}</small>
            </span>
            {index === 0 && <em>新会话默认</em>}
          </button>
        ))}
        {!loading && configs.length === 0 && (
          <span className="settings-hint">还没有模型配置，请先创建一项。</span>
        )}
      </div>

      {config !== undefined && (
        <p className="settings-path">
          配置文件路径：<code>{config.configFile}</code>
        </p>
      )}

      <div className="settings-grid model-config-form">
        <label className="settings-field">
          <span>配置名称</span>
          <input
            value={form.name}
            onChange={(event) => setField("name", event.target.value)}
            placeholder="例如：长上下文模型"
          />
        </label>
        <label className="settings-field">
          <span>模型 ID</span>
          <input
            value={form.model}
            onChange={(event) => setField("model", event.target.value)}
            placeholder="例如 gpt-5 或 deepseek-chat"
            spellCheck={false}
          />
        </label>
        <label className="settings-field settings-field-wide">
          <span>接口地址</span>
          <input
            value={form.baseUrl}
            onChange={(event) => setField("baseUrl", event.target.value)}
            placeholder="https://api.openai.com/v1"
            spellCheck={false}
          />
        </label>
        <SecretField
          label="API Key"
          configured={config?.hasApiKey === true}
          clearing={form.clearApiKey}
          value={form.apiKey}
          placeholder={config?.hasApiKey === true ? "已保存，输入新密钥可替换" : "请输入 API Key"}
          hint="留空不会替换已保存的密钥"
          onChange={(value) => setField("apiKey", value)}
          onToggleClear={() => setField("clearApiKey", !form.clearApiKey)}
        />
        <SecretField
          label="附加请求头"
          configured={config?.hasExtraHeaders === true}
          clearing={form.clearHeaders}
          value={form.extraHeaders}
          placeholder="X-Project: example; X-Region: cn"
          hint="多个请求头用分号或换行分隔"
          masked={false}
          onChange={(value) => setField("extraHeaders", value)}
          onToggleClear={() => setField("clearHeaders", !form.clearHeaders)}
        />
        <label className="settings-field">
          <span>上下文窗口</span>
          <input
            type="number"
            min={1}
            step={1}
            value={form.contextWindow}
            onChange={(event) => setField("contextWindow", event.target.value)}
          />
        </label>
        <label className="settings-field">
          <span>单轮输出上限</span>
          <input
            type="number"
            min={1}
            step={1}
            value={form.maxOutputTokens}
            onChange={(event) => setField("maxOutputTokens", event.target.value)}
          />
        </label>
        <label className="settings-field">
          <span>温度</span>
          <input
            type="number"
            step="0.1"
            value={form.temperature}
            onChange={(event) => setField("temperature", event.target.value)}
            placeholder="使用模型默认值"
          />
        </label>
      </div>

      <div className="model-config-reasoning">
        <div className="settings-label-row">
          <span className="settings-label">支持的思考强度</span>
          <span className="settings-hint">全不选时不发送 reasoning_effort</span>
        </div>
        <div className="model-config-efforts">
          {availableEfforts.map((effort) => (
            <label key={effort}>
              <input
                type="checkbox"
                checked={form.supportedReasoningEfforts.includes(effort)}
                onChange={() => toggleEffort(effort)}
              />
              {formatEffort(effort)}
            </label>
          ))}
        </div>
      </div>

      {error !== undefined && <div className="settings-load-error">{error}</div>}
      {feedback !== undefined && <div className="settings-saved">{feedback}</div>}
      {test.phase === "testing" && (
        <p className="settings-test-result settings-test-result-testing">正在测试模型连接…</p>
      )}
      {test.phase === "success" && (
        <p className="settings-test-result settings-test-result-success">
          <Check size={13} />
          连接成功，用时 {test.latencyMs}ms
        </p>
      )}
      {test.phase === "error" && (
        <p className="settings-test-result settings-test-result-error">
          <AlertCircle size={13} />
          {test.message}
        </p>
      )}
      <div className="model-config-actions">
        {selectedID !== undefined && (
          <button type="button" className="btn btn-small btn-danger" onClick={() => void remove()} disabled={deleting}>
            {deleting ? <LoaderCircle size={13} className="settings-test-spinner" /> : <Trash2 size={13} />}
            删除
          </button>
        )}
        <button
          type="button"
          className="btn btn-small"
          onClick={() => void testConnection()}
          disabled={
            loading ||
            saving ||
            test.phase === "testing" ||
            form.baseUrl.trim().length === 0 ||
            form.model.trim().length === 0
          }
          title={selectedID === undefined ? "使用当前表单值测试" : "测试已保存的模型配置"}
        >
          {test.phase === "testing" ? "测试中…" : "测试连接"}
        </button>
      </div>
    </section>
  )
})

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
  hint: string
  masked?: boolean
  onChange: (value: string) => void
  onToggleClear: () => void
}) => (
  <label className="settings-field">
    <div className="settings-label-row">
      <span>{label}</span>
      <span className="settings-key-state settings-key-state-ok">
        {clearing ? "保存后清除" : configured ? "已保存" : "未配置"}
      </span>
    </div>
    <input
      type={masked ? "password" : "text"}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={clearing ? "保存后将清除当前值" : placeholder}
      disabled={clearing}
      spellCheck={false}
    />
    <div className="settings-label-row">
      <span className="settings-hint">{hint}</span>
      {configured && (
        <button type="button" className="settings-clear-secret" onClick={onToggleClear}>
          {clearing ? "取消清除" : "清除已保存值"}
        </button>
      )}
    </div>
  </label>
)

const toForm = (config: ModelConfigResponse): ModelConfigForm => ({
  name: config.name,
  baseUrl: config.baseUrl,
  model: config.model,
  contextWindow: String(config.contextWindow),
  maxOutputTokens: String(config.maxOutputTokens),
  temperature: config.temperature === undefined ? "" : String(config.temperature),
  apiKey: "",
  extraHeaders: "",
  clearApiKey: false,
  clearHeaders: false,
  supportedReasoningEfforts: [...config.supportedReasoningEfforts],
})

const secretInput = (
  field: "apiKey" | "extraHeaders" | "webSearchApiKey" | "webFetchApiKey",
  value: string,
  clearing: boolean,
): Partial<ModelConfigUpdateRequest> => {
  if (clearing) return { [field]: null }
  const trimmed = value.trim()
  return trimmed.length === 0 ? {} : { [field]: trimmed }
}

const formatEffort = (effort: ReasoningEffort): string =>
  effort === "none" ? "None" : effort.charAt(0).toUpperCase() + effort.slice(1)

const emptyRuntimeMetadata = (): ModelConfigRuntimeMetadata => ({
  webSearchProvider: "",
  hasWebSearchApiKey: false,
  webFetchProvider: "",
  hasWebFetchApiKey: false,
  webTimeoutMs: 30_000,
  webMaxResponseBytes: 8 * 1024 * 1024,
  logLevel: "info",
})
