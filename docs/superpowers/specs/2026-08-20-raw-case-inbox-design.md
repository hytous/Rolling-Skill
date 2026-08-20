# Raw Case 收件箱与已沉淀标记设计

## 目标

Rolling Skill 增加一个位于 Chat 右侧的 Raw Case 收件箱，用来保存“想到但还没执行、验证和沉淀”的自然语言问题。问题按 Skill 分组，用户可以将任意一条立即发送到当前会话或独立的新会话。外部 Agent 平台可以通过本地 Tool 批量投递问题；Rolling Skill 未启动时也允许投递。

已经进入 Case 沉淀流程的原始对话范围需要在 Chat 时间线中显示浅色标记与状态标签，降低重复沉淀的概率。

## 明确不做

- Raw Case 不是正式评测 Case，不需要参考答案、评分标准或 goodcase/badcase 分类。
- 投递 Raw Case 时不强制插入 `/skill`、结构化 Skill mention 或额外提示词；Skill 的自动触发能力仍然是被观察对象。
- 首版不做批量自动执行，避免一次误操作消耗大量 token。
- 不开放监听 TCP 端口，不让外部进程直接修改 `evaluation-store.json`。
- 不根据问题文本做语义去重，只对同一 Skill 下完全相同的规范化文本去重。

## 方案比较与选择

### 方案 A：仅在运行中的 App 提供 localhost HTTP API

优点是实时、常规 HTTP 客户端容易调用。缺点是需要处理端口冲突、鉴权、后台服务生命周期，而且 App 未启动时无法收件。

### 方案 B：外部 Tool 直接改 evaluation-store.json

实现最少，但 Electron 主进程会缓存该文件；外部进程和 App 并发原子替换时仍可能互相覆盖，并且会把低信任的外部输入混入正式评测存储。

### 方案 C：独立追加式收件箱日志 + CLI/MCP stdio Tool（采用）

每个生产者只追加一条事件，不改写既有内容。App 与外部 Agent 共用该日志，App 是否运行不影响投递。Tool 同时提供一次性 CLI 和 MCP stdio 两种入口，能覆盖支持 Bash 的 Agent 与支持 MCP 的 Agent 平台。MCP stdio 使用官方 TypeScript Server SDK；stdout 只承载协议，诊断写 stderr。

## 数据模型

收件箱使用独立文件：

```text
~/Library/Application Support/Rolling Skill/raw-case-events.jsonl
```

每行是一个事件：

```json
{
  "schemaVersion": "rolling-skill-raw-case-event/v1",
  "eventId": "uuid",
  "type": "added | updated | deleted | dispatched",
  "rawCaseId": "uuid",
  "recordedAt": "ISO-8601",
  "payload": {}
}
```

`added` 的 payload：

```json
{
  "question": "用户原始自然语言问题",
  "skill": {
    "name": "billing-cost-management",
    "path": null
  },
  "note": "可选来源说明",
  "source": {
    "kind": "manual | cli | mcp",
    "producer": "可选 Agent 名称"
  }
}
```

`dispatched` 的 payload 保存 `runtimeId`、`threadId`、`turnId`、`dispatchedAt` 和 `mode: current | new`。已发送记录默认不显示在待处理队列，但日志保留来源与执行定位。

限制：单条问题最多 120,000 字符；一次 Tool 调用最多 200 条；同一批输入总计最多 1,000,000 字符。Skill 名必填，路径可选。读取器忽略损坏的尾行并返回警告，不让一条坏数据阻断整个 App。

## Raw Case Store

新增独立 `RawCaseStore`，负责：

- 追加事件；
- 归并事件得到当前 pending 记录；
- 按 Skill 名与可选路径分组；
- 完全相同文本去重；
- 编辑、删除与标记 dispatched；
- 监听文件变化并向 renderer 发送低频 `raw-cases:changed` 通知。

Store 不依赖 Electron，可同时被主进程、CLI、MCP Tool 和单元测试使用。所有写入通过单次 append 完成，不触碰正式评测 Store。

## 外部 Tool

提供相邻于 App 的可执行入口 `rolling-skill-tool`，并在 App Resources 中保留同一实现。

### CLI

```bash
rolling-skill-tool raw-case add \
  --skill billing-cost-management \
  --question '查一下7月份账单，各业务混元3多少成本？' \
  --producer codebuddy
```

批量输入：

```bash
rolling-skill-tool raw-case import --json-file cases.json
```

CLI 成功时向 stdout 输出稳定 JSON；错误写 stderr 并返回非零退出码。

### MCP stdio

```bash
rolling-skill-tool mcp
```

首版暴露以下 Tool：

- `rolling_skill_enqueue_raw_cases`：按一个 Skill 批量加入问题；返回 created、duplicate 和 rejected。
- `rolling_skill_list_raw_cases`：按可选 Skill 查询 pending 问题，方便生成 Agent 自检投递结果。

不向 MCP 暴露执行、删除正式 Case 或控制 runtime 的能力。外部 Agent 只负责生产候选问题，用户仍在 Rolling Skill 中决定何时执行。

## Chat 界面

### 宽窗口

Chat 主体成为三栏：任务列表、会话、Raw Case 收件箱。收件箱默认约 320px，可折叠；折叠状态保存在本地界面设置中。

顶部显示：

- `Raw Cases`；
- pending 总数；
- 添加按钮；
- 折叠按钮。

内容使用 Skill 分组的折叠段。每张卡显示问题原文、来源、创建时间，以及：

- `新会话执行`：使用当前 Composer 的 runtime、模型、推理强度和权限创建独立会话并发送原问题；
- `当前会话执行`：只在当前会话已加载、非归档且没有运行中 turn 时可用；
- 编辑；
- 删除。

新建 Raw Case 时 Skill 从当前 runtime Skill 清单和数据集绑定中选择，同时允许输入仅有名称的 Skill，便于接收尚未安装的 Skill 候选。未在当前 runtime 发现的 Skill 显示“当前 runtime 未发现”，但不阻止保存。

### 窄窗口

右栏不挤压 Composer。Topbar 显示带数量徽标的 `Raw Cases` 按钮，点击后从右侧打开抽屉。抽屉复用同一内容组件。

### 执行语义

问题正文原样发送，不加 Skill 名、来源 note 或 Tool 元数据。只有 `startTurn` 成功后才追加 dispatched 事件；失败则保留 pending 卡片并显示错误。新会话执行成功后切换到该会话，当前会话执行保持当前位置并遵循现有自动滚动规则。

## 已沉淀对话范围标记

主进程在 `thread/read` 响应上附加当前 thread 的 capture session 标记：session id、status、case id、start item id、end item id 和 dataset id。取消的 Draft 不产生标记。

Renderer 按时间线顺序把 start/end 之间的消息和工具活动标记为一个范围：

- queued/running/failed/needs_review：浅橙底，末端 Assistant 回复显示“Case 草稿”；
- archived 且已有 Case：浅蓝绿底，显示“已沉淀 Case”；
- hover/focus 时增强边框，但不改变原消息内容与复制结果。

已标记回复仍允许再次打开沉淀窗口，以支持跨数据集或重新整理；按钮文案改为“再次整理”，避免用户误以为尚未处理。收到 `curation:changed` 后只刷新该 thread 的标记，不重建整个会话。

## IPC 与事件流

新增 IPC：

- `raw-cases:list`
- `raw-cases:add`
- `raw-cases:update`
- `raw-cases:delete`
- `raw-cases:mark-dispatched`
- renderer subscription `raw-cases:changed`

Renderer 使用现有 start thread/turn 桥接完成执行，再调用 `raw-cases:mark-dispatched`，这样模型、推理强度、权限和当前会话 UI 状态只有一个来源。

## 错误与恢复

- Tool 投递时 App 不必运行；下一次启动或文件变化会读到新记录。
- Tool 批量输入逐条校验，合法项可以成功，结果明确列出 rejected 项及原因。
- 同一 pending 问题重复投递返回 duplicate，不新增卡片。
- 文件末尾出现半行时忽略该行；下一次完整追加后继续读取。
- 执行失败不从队列移除。
- 如果 Skill 当前未安装，允许保存并提示；执行仍按原问题交给 runtime，便于验证自动触发失败场景。

## 测试

- Store：事件归并、去重、编辑、删除、dispatch、损坏尾行、并发追加。
- CLI：单条、批量、退出码、stdout JSON 与 stderr 隔离。
- MCP：initialize、tools/list、批量 enqueue、list，使用官方 Inspector 兼容的 stdio transport。
- Main/preload：IPC 与 changed 通知，不污染 evaluation Store。
- Renderer smoke：Skill 分组、宽/窄布局、当前/新会话执行、失败保留、外部写入自动出现。
- Curation marker：active/archived/cancelled 状态、跨 turn 范围、再次整理按钮、切换 thread 后恢复。
- 回归：后台会话通知路由、Case Draft backpressure、Composer 草稿与滚动位置保持不变。

## 验收标准

1. 用户可在 Chat 右侧保存一个按 Skill 归组的问题，并在重启后看到它。
2. 外部 Agent 可在 App 关闭时通过 CLI 或 MCP 批量投递，App 启动后显示。
3. 新会话/当前会话执行发送的正文与 Raw Case 问题逐字一致；成功后该卡从 pending 消失，失败时保留。
4. 已进入沉淀流程的原始时间线范围有清晰浅色标记，取消 Draft 后不再标记。
5. Raw Case 数据和正式 Dataset/Case 数据相互隔离。
6. 全量单测、renderer smoke、MCP Inspector 兼容验证、macOS 打包与稳定代码签名全部通过。
