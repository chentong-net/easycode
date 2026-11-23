# EasyCode

EasyCode 在本地机器上运行，通过 OpenAI 兼容协议调用模型，在指定的工作目录内读写文件、检索内容、执行命令。入口有两个：命令行与 Electron 桌面端，两者共用同一套 Core 运行时。模型、API Key、联网与日志配置保存在 `~/easycode/.easycode/config/<ID>.toml`；主对话与 compaction（压缩）提示词通过独立的「提示配置」管理。

术语说明：本文保留 `epoch`、`baseline`、`checkpoint`、`snapshot`、`compaction` 的原始英文，并在首次出现时用括号标注中文提示。`epoch` 指一次冻结上下文从建立到重建的周期，不是模型训练中的 epoch，也不是 Unix 时间起点。

## 包结构

| 包 | 职责 | 上游依赖 |
| --- | --- | --- |
| `@easycode/schema` | 语义值：工作区、会话、消息、事件、工具、权限、用量 | — |
| `@easycode/protocol` | 接口契约：端点常量、请求与响应 DTO、错误分类 | schema |
| `@easycode/core` | Agent 运行时：回合循环、上下文组装、工具执行、权限判定、事件日志 | schema |
| `@easycode/server` | 使用 Fastify 把 Core 绑定到 HTTP 与 SSE | core、protocol |
| `@easycode/client` | TypeScript 客户端，供界面调用 HTTP 接口 | protocol |
| `@easycode/cli` | 命令行入口 | core、server、protocol、schema |
| `@easycode/desktop` | Electron 外壳、本地 sidecar 与渲染层 | core、server、client、protocol、schema |

依赖方向单向：`schema → core → server`。`client` 以 `protocol` 为契约来源；`cli` 与 `desktop` 通过 `server` 暴露的接口访问运行时。这套方向由各包的依赖表约束：`core` 的依赖项为 `schema`、`glob`、`zod`、`zod-to-json-schema`，`client` 的依赖项为 `protocol`、`schema`、`zod`，界面相关依赖集中在 `desktop`。

## 源码目录

```
packages/
  schema/src/        语义值定义
  protocol/src/      接口契约
  core/src/
    llm/             OpenAI 兼容协议的报文编解码与流式解析
    session/         事件日志、投影、上下文组装、compaction（压缩）
    tool/            工具定义、内置工具、路径解析与目录边界
      builtin/web/   可选的网页搜索、抓取及其厂商映射
    permission/      权限规则求值
    runner/          回合循环
    workspace/       工作区注册、目录校验与持久化
  server/src/        HTTP 路由与 SSE
  client/src/        类型化客户端
  cli/src/           命令行
  desktop/src/
    main/            主进程：窗口、sidecar 启动、系统目录选择
    preload/         预加载脚本：向渲染层注入运行环境信息
    renderer/        React 消息界面与 Markdown 渲染
    sidecar/         Core 服务进程
    shared/          主进程与预加载脚本共用的常量与类型
```

## 环境要求

- Node.js 20 或更高版本（见根 `package.json` 的 `engines` 字段）
- npm（依赖以 workspaces 方式安装）

## 安装与配置

```bash
npm install
```

首次启动会自动创建 `~/easycode/.easycode/config/<ID>.toml`。可以双击桌面端后通过「运行配置」填写，也可以直接编辑对应 TOML 文件；联网与日志设置保存后重启应用生效。

设置页的「模型配置」以 ID 为文件名展示多个 TOML。每项独立保存接口地址、模型 ID、API Key、上下文窗口、输出上限、温度、附加请求头、联网配置、日志和多个支持的 reasoning level。设置页底部只有一个「保存配置」按钮，一次保存当前选中的完整 TOML。

Reasoning Level 由后端提供，当前包括 `none`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max`。模型配置一个 level 都不选时，第三级下拉框不出现；配置了 level 但会话选择“不指定”时，请求同样不发送 `reasoning_effort`，使用模型自身默认行为。显式选择具体值时，正常会话和标题生成会复用该值；compaction 摘要请求刻意不继承 reasoning，避免额外推理占用已经紧张的 32K 窗口。

桌面端设置按钮左侧的机器人按钮打开「提示配置管理」。内置「编程」配置直接定义在代码中，始终可用且不可修改或删除；用户新建的提示配置保存在 `~/easycode/.easycode/prompt/`，保存后立即热加载。旧 `compaction-profile/` 仅在读取时用于字段迁移。新建和已有会话都可以重新选择提示配置，每次选择都会更新会话元数据。

新建会话的输入框按「模型配置 → 提示配置 → 思考强度」顺序选择。第三级仅在所选模型配置声明了至少一个 level 时出现，并且只显示该模型配置支持的 level；它可以选择“不指定”，此时直接发送消息并使用模型默认行为。模型配置、提示配置和思考强度都只以 ID/值写入会话元信息，每次重新选择都会更新会话；配置文件被删除后可以直接改选其他有效配置。会话运行期间暂不允许切换，避免请求中途换配置。

配置文件示例：

```toml
[model]
base_url = "https://api.openai.com/v1"
api_key = "sk-..."
name = "gpt-4o"
context_window = 128000
max_output_tokens = 8192
# temperature = 0.2

[model.headers]
# "X-Example" = "value"

[web]
timeout_ms = 30000
max_response_bytes = 8388608

[web.search]
provider = "tavily"
api_key = "..."

[web.fetch]
provider = "glm"
api_key = "..."

[runtime]
log_level = "info"
```

路径规则是固定的，不读取环境变量，也不提供配置入口：

- EasyCode 根目录：`~/easycode`
- 内部状态目录：`~/easycode/.easycode`
- 模型配置文件：`~/easycode/.easycode/config/<模型配置ID>.toml`
- 会话、快照、日志和工具输出：`~/easycode/.easycode/`

密钥只保存在配置文件与 Core 进程内，HTTP 配置接口只返回是否已配置。环境变量不会覆盖配置文件中的值。

模型 API Key 可以为空。空 Key 时客户端不会发送 `Authorization` 请求头，因此可直接连接 Ollama 等本地无鉴权服务；联网搜索和网页读取仍分别要求对应 Provider 与 Key。

搜索和抓取分别要求同时配置 Provider 与对应的 API Key；任意一项缺失时，该工具不会注册。系统不会自动选择厂商，也不会复用模型 API Key。

## 构建与检查

```bash
npm run build       # 按依赖顺序构建全部包
npm run typecheck   # 各包执行 tsc --noEmit
npm test            # 运行服务端接口测试、Client 响应解析测试和图片 Adapter 测试
npm run clean       # 清理 dist 与 release 目录
```

## 命令行

```bash
npm run build

# 在工作目录下执行一次任务
node packages/cli/dist/index.js run "统计 src 下的 TypeScript 文件数量" --dir ~/easycode

# 列出全部会话
node packages/cli/dist/index.js sessions

# 启动本地 HTTP 服务，供界面连接
node packages/cli/dist/index.js serve --port 8080
```

| 命令 | 用途 |
| --- | --- |
| `run "<要求>"` | 在工作目录下执行一次任务，过程与结果输出到终端 |
| `sessions` | 列出全部会话（id、标题、更新时间、工作目录） |
| `serve` | 启动本地 HTTP 服务 |

| 选项 | 适用命令 | 说明 |
| --- | --- | --- |
| `--dir <目录>` | `run` | 工作目录，默认 `~/easycode` |
| `--session <ID>` | `run` | 复用已有会话，省略时新建 |
| `--reasoning` | `run` | 输出模型的推理过程 |
| `--port <端口>` | `serve` | 监听端口，默认由系统分配空闲端口 |
| `--token <令牌>` | `serve` | 访问令牌，默认随机生成 |
| `--no-token` | `serve` | 关闭鉴权，供本机调试使用 |

`serve` 会把服务地址与访问令牌打印到终端，接口调用示例：

```bash
curl -H "x-easycode-token: <令牌>" http://127.0.0.1:8080/api/health
```

`packages/cli` 注册了名为 `easycode` 的 bin，执行 `npm link` 之后可以直接使用该命令。

## 图片输入

图片准备请求只要求本地路径，可选携带 `platform` 字符串：

```json
{
  "path": "/home/user/screenshot.png",
  "platform": "custom-adapter"
}
```

Core 使用 `Map<string, ImageService>` 注册图片 Adapter，不再通过公共枚举限制实现方式。Adapter 自行声明 `platform`，新增实现时只需注册 Adapter，不需要修改协议。未提供 `platform` 或注册表中找不到对应项时回退 Base64；Adapter 已找到但执行失败时不会回退，而是直接返回业务错误。

客户端通过 `GET /api/images/platforms` 获取当前已注册平台：

```json
{
  "code": 0,
  "message": "SUCCESS",
  "data": {
    "defaultPlatform": "base64",
    "platforms": [
      {
        "platform": "base64",
        "displayName": "Base64"
      },
      {
        "platform": "deepseek-files",
        "displayName": "DeepSeek Files API"
      }
    ]
  }
}
```

桌面端使用该列表动态生成下拉框，并把选中的字符串保存在本地。已保存平台不在最新列表中时选择 `defaultPlatform`；平台列表请求失败时回退 Base64。

响应会记录实际使用的 Adapter：

```json
{
  "code": 0,
  "message": "SUCCESS",
  "data": {
    "adapter": "base64",
    "requestedPlatform": "custom-adapter",
    "fallback": true,
    "content": {
      "type": "image_url",
      "image_url": {
        "url": "data:image/png;base64,..."
      }
    }
  }
}
```

## 桌面端

```bash
npm run build
npm start --workspace @easycode/desktop
```

打包安装包：

```bash
npm run package --workspace @easycode/desktop
```

产物写入 `packages/desktop/release`，macOS 目标为 dmg，Windows 目标为 nsis，Linux 目标为 AppImage。

进程结构：

| 进程 | 职责 |
| --- | --- |
| 主进程 | 创建窗口、拉起 sidecar、把服务地址与访问令牌注入预加载脚本、提供系统目录选择 |
| 预加载脚本 | 通过 `contextBridge` 暴露 `serverUrl`、`serverToken`、`platform`、`homeDirectory`、`selectDirectory` |
| 渲染进程 | 自有 React 消息界面，经 HTTP 与 SSE 读取 Core 状态 |
| sidecar | 由 `utilityProcess` 拉起，内部加载 Core 并在回环地址上启动 HTTP 服务，就绪后把地址写入握手文件 |

服务端口由系统分配，地址与令牌经预加载脚本单向注入渲染层；渲染层调用主进程的能力为系统目录选择一项，工作区、会话、消息、工具调用均经 HTTP 接口完成。窗口标题栏与侧边栏、会话标题栏合并，macOS 上以 `titleBarStyle: hidden` 隐藏系统标题栏，并按平台为左上角的窗口按钮留出位置。

开发模式与打包后的桌面端都从 `~/easycode/.easycode/config/` 读取多份 TOML 配置。

## 运行机制

### 回合循环

一次回合按以下顺序推进：

1. 用户输入在回合开始前写入事件日志
2. Runner 为用户输入建立任务契约和显式阶段状态
3. 组装任务记忆、历史上下文和工具定义并调用模型
4. 模型产出的工具调用先写入事件日志，再按顺序交给工具执行
5. 工具结果更新修改文件、失败观察和重复调用计数
6. 全部工具调用完成并写入结果之后，判断是否进入下一个 provider turn（模型调用轮次）
7. 每个步骤窗口达到 30 个 provider turn 时，Runner 发起续行检查点并等待用户决定继续或停止
8. 回合结束前写入结构化任务结果，再写入空闲事件

任务状态通过 `task.updated` 事件持久化，包含目标、验收条件、阶段、修改文件、待办和最终结果。它独立于普通消息历史，并继续注入主对话请求尾部；摘要输入只包含已有 checkpoint、额外 section 和待压缩对话，不额外复制任务状态。

步骤预算分为当前窗口与累计步数。30 步是人工续行检查点，不是任务上限；用户选择继续后开启新的 30 步窗口。Agent 仍可配置可选的硬上限用于异常保护，达到硬上限时禁用工具并强制文本收尾。

### 事件日志与投影

每个会话对应一份 append-only 的 `events.jsonl`，它是状态的单一事实来源；消息列表与界面展示由 `applyEvent` 投影得到，同一份日志重放所得结果一致。事件分两类：带 `seq` 的持久化事件可通过 `after` 参数补发；`text.delta` 这类瞬时事件经 SSE 推送，用于展示生成过程。上下文压缩另以 `compaction.started`、`compaction.ended` 和 `compaction.failed` 记录完整生命周期，界面据此展示真实的状态文案。

### 上下文组装与 compaction（压缩）

在一个 epoch（上下文周期）内，Agent 系统提示词与冻结的 baseline（基线）逐字节保持一致，以提升 prompt 缓存命中率。工作目录位于 baseline 中；只有日期等来源发生变化时，才在历史中追加系统消息，而不是改写 baseline。

compaction 预算根据模型上下文窗口动态推导。32K 窗口下摘要请求会使用约 4K 输出预算，而不是按 8% 固定成约 2.5K；预算还会受模型自身 `maxOutputTokens` 限制。Runner 只在请求达到软阈值时调用会话级 `Compaction.compact()`，同一会话最多执行一个压缩任务。

每份 `PromptProfile` 只包含 `id`、`name`、`description`、`systemPrompt`、`compactionSystemPrompt`、`compactionHeadings`、`createdAt` 和 `updatedAt`。`systemPrompt` 用于主对话 Agent；`compactionSystemPrompt` 定义摘要器角色、场景关注点和取舍原则；`compactionHeadings` 是 checkpoint 必须包含的 Markdown 二级标题。

摘要 prompt 的结构由引擎固定：已有摘要、通过 `addSection(title, () => content)` 追加的额外 section、待执行 compaction 的对话。不再配置首次、分块、合并或纠正指令，也不动态拼接 create/update 要求。每次摘要都输出一份新的完整 checkpoint；已有 checkpoint 只作为旧记忆，较新的对话优先。

`compact()` 每次只调用一次摘要模型，不分块、不 merge、不生成引擎 fallback checkpoint。失败时已有历史和旧 checkpoint 保持不变，并返回 `nothing_to_compact`、`summary_input_too_large`、`summary_empty`、`summary_truncated`、`summary_invalid`、`summary_not_smaller`、`provider_error`、`configuration_error`、`aborted` 或 `busy`。失败类型不携带 `retryable`；Runner 负责决定是否重试。自动压缩失败时当前回合停止，不会继续发送已知超出预算的主请求。

provider 报告上下文超限时，Runner 会执行一次 overflow compaction；摘要调用失败后最多由 Runner 重试一次，随后重建请求再试。最终 provider 请求本身仍保留有限的 overflow 重试上限。

### 权限

规则形如 `{ action, resource, effect }`，按顺序求值并取最后一条同时匹配 `action` 与 `resource` 的规则，`effect` 取值为 `allow` / `ask` / `deny`，默认裁决为 `ask`。一次调用涉及多个资源时取最严格的结果。

内置 `build` agent 的规则集默认允许所有操作。结构化文件工具通过 `external_directory` 对工作目录之外的路径再次确认；`read` 动作读取用户项目中的 `.env`、`.env.*` 以及 `~/easycode/.easycode/config/*.toml` 时需要确认，结构化编辑运行或模型配置文件的请求同样需要确认；`bash` 命令包含 `rm -rf` 或 `sudo` 时需要确认；网页搜索与读取默认允许，配置对应 Provider 与 API Key 即表示接受第三方服务调用。`bash`、`grep` 等工具不会共享 `read` 的 `.env` 保护，`bash` 和 `glob` 也不会对命令或 pattern 中的外部路径做完整解析。这些 `.env` 规则针对被 Agent 操作的项目，与 EasyCode 自身配置无关。用户在界面上选择「总是允许」后，该决定保存为优先级更高的规则。

### 内置工具

| 工具 | 用途 |
| --- | --- |
| `read` | 按行范围读取文件 |
| `glob` | 按文件名模式查找文件 |
| `grep` | 按正则表达式检索文件内容 |
| `edit` | 精确替换文件片段 |
| `write` | 创建或整体重写文件 |
| `bash` | 在工作目录下执行命令 |
| `todowrite` | 维护任务清单；多步骤任务在每完成一项后更新状态 |
| `question` | 在歧义、实现取舍或续行检查点时请求用户确认，并等待回答后继续 |
| `websearch` | 使用已配置厂商检索网页 |
| `webfetch` | 使用已配置厂商读取单个网页 |

`glob` 与 `grep` 默认跳过 `node_modules`、`.git`、`dist` 等目录，`grep` 另外跳过二进制文件与超过 2MB 的文件。超长工具输出写入 `~/easycode/.easycode/tool-output/`，消息中保留落盘路径。

`websearch` 与 `webfetch` 的配置、HTTP、厂商映射和工具实现集中在 `packages/core/src/tool/builtin/web`，通过 `createBuiltinTools()` 按普通内置工具注册。DeepSeek 使用 Search/Fetch，GLM 使用 Web Search/Reader，Tavily 使用 Search/Extract；厂商地址固定。工具默认最多返回 20 条搜索结果、30 秒超时和 8 MB 厂商响应，最终进入模型的内容仍经过统一输出截断。

工具调用完成后会写入结构化元数据：副作用类型、失败原因、是否可重试和修改文件路径。`bash` 的非零退出码与超时会作为失败返回。文件编辑与整体写入使用同目录临时文件加原子替换。

`question` 通过持久化 `question.asked`、`question.replied` 与 `question.cancelled` 事件等待用户回答。回答前工具调用和回合保持运行；中断或进程重启会取消失效请求。桌面端显示选项与自由输入卡片，命令行在同一进程中提示回答。

## HTTP 接口

接口前缀为 `/api`，监听回环地址。配置了访问令牌时，请求需携带 `x-easycode-token` 头。

服务端使用 Fastify 声明式路由，并按 config、images、workspaces、sessions 等领域拆分路由模块。普通 JSON 接口统一返回 `code/message/data` 信封：

成功响应：

```json
{
  "code": 0,
  "message": "SUCCESS",
  "data": null
}
```

业务失败：

```json
{
  "code": -1,
  "message": "会话不存在"
}
```

- 请求已经进入业务处理并形成失败结果时，HTTP 状态仍为 `200`，通过非零 `code` 表示业务失败。
- 路由不存在、认证失败、请求无法解析等框架或基础设施错误使用对应 HTTP 状态码，并同样返回 `code/message` 信封。
- 成功响应始终包含 `data`，没有业务数据时为 `null`。
- 失败响应不包含 `data`。
- 初版业务错误码统一为 `-1`，后续在 Protocol 的错误码模块中逐步扩展。
- SSE 是标准事件流，不使用 `code/message/data` 信封。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/health` | 服务状态、协议版本、模型 id、上下文窗口与输出预算 |
| GET | `/api/agents` | 可用 agent 列表 |
| GET | `/api/images/platforms` | 当前已注册的图片平台 |
| GET | `/api/model-configs` | 模型配置摘要、后端支持的 reasoning level 集合 |
| GET | `/api/model-configs/{id}` | 模型配置安全详情；密钥只返回是否已配置 |
| POST | `/api/model-configs` | 新建模型配置 |
| PUT | `/api/model-configs/{id}` | 更新模型配置并增加 revision |
| POST | `/api/model-configs/{id}/test` | 使用已保存的模型配置测试连接 |
| DELETE | `/api/model-configs/{id}` | 删除模型配置；不检查会话引用 |
| GET | `/api/prompt-profiles` | 提示配置摘要列表，内置编程配置始终位于首项 |
| GET | `/api/prompt-profiles/{id}` | 读取完整提示配置，用于编辑表单 |
| POST | `/api/prompt-profiles` | 新建并保存用户提示配置 |
| PUT | `/api/prompt-profiles/{id}` | 更新用户提示配置；内容未变化时不改写 `updatedAt` |
| DELETE | `/api/prompt-profiles/{id}` | 删除用户提示配置；不检查会话引用 |
| GET | `/api/config` | 可安全展示的首份模型配置；密钥只返回是否已配置 |
| PUT | `/api/config` | 兼容接口；更新首份 TOML 的联网和日志字段 |
| POST | `/api/config/test` | 使用当前表单值发送一次最小模型请求，验证连接 |
| GET | `/api/workspaces` | 工作区列表 |
| POST | `/api/workspaces` | 添加工作区，请求体为 `{ directory }` |
| PATCH | `/api/workspaces/{id}` | 重命名工作区，请求体为 `{ name }` |
| DELETE | `/api/workspaces/{id}` | 删除非默认工作区及其会话记录，不删除磁盘目录 |
| POST | `/api/workspaces/{id}/pin` | 置顶或取消置顶，请求体为 `{ pinned }` |
| GET | `/api/sessions` | 会话列表 |
| POST | `/api/sessions` | 创建会话，请求体为 `{ directory, title?, modelConfigID?, promptProfileID?, reasoningEffort? }` |
| POST | `/api/sessions/bulk-delete` | 批量删除会话，请求体为 `{ sessionIDs }`，返回成功与失败项 |
| GET | `/api/sessions/{id}` | 会话详情 |
| PATCH | `/api/sessions/{id}` | 重命名会话，请求体为 `{ title }` |
| DELETE | `/api/sessions/{id}` | 永久删除会话 |
| POST | `/api/sessions/{id}/pin` | 置顶或取消置顶，请求体为 `{ pinned }` |
| GET | `/api/sessions/{id}/messages` | 消息列表（事件日志的投影结果） |
| GET | `/api/sessions/{id}/task` | 当前任务工作记忆与进度 |
| PUT | `/api/sessions/{id}/configuration` | 更新会话的模型、提示配置或思考强度 |
| POST | `/api/sessions/{id}/prompt` | 提交用户输入，请求体为 `{ text, delivery? }` |
| POST | `/api/sessions/{id}/interrupt` | 中断当前回合 |
| GET | `/api/sessions/{id}/events` | 事件流（SSE，`after` 参数指定起始 `seq`） |
| GET | `/api/sessions/{id}/permissions` | 待审批的权限请求 |
| POST | `/api/sessions/{id}/permissions/{requestID}/reply` | 回应权限请求，请求体为 `{ reply, feedback? }` |
| GET | `/api/sessions/{id}/questions` | 等待回答的问题列表 |
| POST | `/api/sessions/{id}/questions/{requestID}/reply` | 回答问题，请求体为 `{ answers }` |

`prompt` 返回 `{ inputID }` 后立即结束，执行进度经事件流反馈。

## 数据目录

```
~/easycode/.easycode/
  config/<模型配置ID>.toml          完整模型、联网、日志与 reasoning levels
  workspaces.json                   工作区名称与目录注册表
  sessions/<会话ID>/session.json    会话元信息
  sessions/<会话ID>/events.jsonl    持久化事件，append-only
  sessions/<会话ID>/context.json    epoch（上下文周期）状态
  prompt/<ID>.json                  用户提示配置，内置编程配置不在此目录
  compaction-contexts/<会话ID>/<YYYYMMDDHHmm-t预估Token-compactionID>/
                                     compaction 前后的完整请求与摘要诊断
  tool-output/tool_*.txt            超长工具输出的落盘文件
```

`session.json` 是事件日志的派生缓存，供会话列表读取。当前实现下，它缺失、无法解析或结构不符时会被跳过，不会自动从事件日志重建；事件日志本身仍保留完整的 `session.created` 元信息。

每次真正开始 compaction（压缩）时，还会在
`~/easycode/.easycode/compaction-contexts/<会话ID>/` 下创建独立诊断目录：

- `before.json`：触发 compaction 前准备发送给主模型的完整请求；
- `after.json`：根据新 checkpoint 重建后的完整请求快照；
- `summaries/`：摘要模型的单次输入、结束原因、usage 和标题校验结果；
- `metadata.json`：触发原因、提示配置 ID、预算、compaction 前后估算、保留消息和失败原因。

诊断文件不包含 API Key 等鉴权信息，使用仅当前用户可读的文件权限。备份失败只记录警告，不会中断主任务。

目录时间使用本地分钟时间，便于按名称排序和人工定位；`metadata.json` 同时记录 UTC 时间、带时区的本地时间、时区、精确开始/完成时间和耗时。

## 当前实现范围

- 单个内置 agent：`build`，每 30 步进入一次续行检查点，默认不设置固定任务上限
- 旧版 `config.toml` 和中间 JSON 版本只作为一次性迁移来源；运行时读取 `config/<ID>.toml`
- 会话实际使用的模型来自独立模型配置列表，配置保存后热加载
- 模型配置支持多个 reasoning level；空列表或用户选择“不指定”时不发送 `reasoning_effort`
- 新旧会话都持久化 `modelConfigID`、`promptProfileID` 和可选 `reasoningEffort`，重新选择时更新；旧 `compactionProfileID` 只在读取会话时迁移
- 运行配置覆盖模型连接、上下文与输出预算、温度、附加请求头、网页搜索/读取和日志级别；数据目录固定，不参与配置；接口不会返回已保存的密钥明文
- 基础工具覆盖读代码、找代码、改代码、执行命令、管进度和必要澄清
- 配置 Provider 与对应 API Key 后增加网页搜索或网页读取
- 多工作区：桌面端可添加多个本地目录，按工作区展示会话，并支持右键重命名、置顶和删除
- 默认工作区：`~/easycode` 自动登记为“默认工作区”，始终固定在第一位；其他工作区置顶后也排在其后
- 默认工作区不能删除，但其会话仍可逐个删除；删除其他工作区只清理 EasyCode 记录，不删除本地目录和文件
- 桌面端启动时不自动打开历史会话，工作区默认折叠；用户在新会话页面首次发送后才在默认工作区创建会话并展开该工作区
- 多会话：会话创建时绑定工作区目录，之后保持绑定
- 会话元信息只保存模型配置 ID、提示配置 ID 和 reasoning level，不复制 API Key 或完整配置文件
- 删除提示配置不检查会话引用；会话继续对话时如果配置已丢失，会直接报错且不调用模型，历史仍可查看
- 用户提示配置保存后立即热加载；每次 `compact()` 都使用该次调用传入的配置快照
- 首轮回答结束后使用一次独立模型请求生成会话标题，失败时回退到输入摘要
- 会话列表按置顶优先、最近活跃时间倒序排列，支持右键重命名、置顶、单选删除和当前活动工作区内多选删除
- 多选删除使用批量接口返回逐项结果，运行中的会话会先中断；部分失败时保留失败项
- 删除当前会话后保持无选择状态，不自动打开相邻会话
- 两种入口：命令行与 Electron 桌面端，共用 Core 运行时
- 事件流断线重连，按 `seq` 补发缺失事件
- 桌面端任务进度面板实时展示阶段、待办、修改文件、步骤预算和最终结果，不展示用户原始输入
- 多步骤待办连续两个其他工具调用未更新时，Runner 会在后续每个 provider turn 继续注入逐项同步提醒，直到待办状态真实变化
- 回合结束时只要仍有未完成待办，任务结果最多为“部分完成”，不会标记为成功
- 回合具有显式任务阶段、待办完成门槛、无进展保护和结构化最终结果
- 步数预算进入任务状态，软提醒后进入人工续行检查点；用户停止或可选硬上限触发时强制文本收尾
- 上下文用量超过阈值时自动执行单次 compaction（压缩）；失败时保留旧历史，由 Runner 决定有限重试或停止
- 底部状态区展示上下文占用及最近一次压缩结果；成功压缩显示相对时间，失败显示绝对时间
