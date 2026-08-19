# Rolling Skill 后台会话通知路由设计

日期：2026-08-19

## 背景与证据

Rolling Skill 当前让 runtime 的所有非隐藏会话 notification 都跨 Electron IPC 进入
renderer。renderer 只绘制 `activeThreadId` 对应的正文，但后台会话的 token、reasoning、
工具和状态事件仍然经过序列化、跨进程传输、反序列化和 JS 分发。

本机最新运行 Trace 中，在最后一次选择可见会话之后，共出现 10,127 条带 thread id 的
事件：3,197 条属于可见会话，6,930 条属于三个后台会话。后台事件占约 68%，其中大部分
是 `item/agentMessage/delta`。这些事件不改变可见正文，却持续占用 main 和 renderer。

## 目标

- 后台会话继续正常运行，不改变 runtime 行为。
- 完整 Trace、工具活动和终态仍在 main/runtime 层记录。
- 只有当前真正显示的 Chat 会话接收逐条正文、reasoning 和工具增量。
- 切回后台会话时能够看到最新正文与工具活动，并继续实时流式显示。
- 切换过程中不丢最终输出，不重复显示正文。
- Skill 评测、设置、Case Draft、Rubric 等非 Chat 主体界面不订阅 Chat 的逐条 UI 增量。

## 非目标

- 不暂停、打断或降低后台 runtime 的生成速度。
- 不减少 Trace 证据，不改变评测 Trace 范围。
- 不把 raw token delta 变成长期 UI 消息；runtime 历史仍是会话正文的权威来源。
- 不改变 Curator、Case 校准和 Rubric Agent 自己的隐藏会话活动通道。

## 方案比较

### 方案 A：继续全部跨 IPC，仅在 renderer 丢弃

实现最少，但正是当前问题：后台 payload 仍持续占用 IPC 和 renderer 主线程，无法解决卡顿。

### 方案 B：main 只向可见会话转发高频事件（采用）

renderer 明确上报当前正在显示的 Chat thread。main 在完成 Trace 和本地工具活动记录后，
只把该 thread 的高频 timeline 事件发往 renderer；低频的 thread 名称、状态、归档等摘要
事件仍可用于侧栏。切换会话时使用 snapshot/catch-up 交接。

该方案在不改变 runtime 和 Trace 的前提下，从最早的跨进程边界消除无用负载。

### 方案 C：为每个后台会话维护完整 renderer view model

切换最快，但会在 main 或 renderer 长期保存所有会话的流式正文副本，内存、去重和一致性
成本过高，且重复 runtime 的历史存储职责，不采用。

## 组件与数据流

### 1. Runtime notification router（main process）

新增一个可单测的纯路由策略，将 notification 分为：

- `visible-timeline`：turn、item、agent delta、error、thread settings 等正文相关事件，只在
  `threadId === observedThreadId` 时跨 IPC。
- `background-summary`：thread started/name/status/archive/unarchive 等侧栏所需的低频事件，
  无论是否可见均可跨 IPC。
- `renderer-unused`：token usage、rate limits、diff/output delta 等当前 renderer 不消费的
  事件不跨 IPC。

路由发生在 runtime client 已经记录 Trace、main 已经更新 active-thread 状态并捕获本地工具
活动之后，因此 UI 降频不会削弱证据。

### 2. 可见会话订阅（renderer → main）

renderer 只在 `surface === "chat"`、不是 New Task、且存在 `activeThreadId` 时上报该 id。
进入评测工作台、设置、Case Draft、Rubric 抽屉或 New Task 时，上报 `null`。本地去重避免
反复发送相同订阅。

### 3. Snapshot/catch-up 交接

打开会话时先建立目标 thread 的观察 epoch，再读取 `thread/read` 快照。读取期间到达的目标
thread 事件保存在一个短生命周期 catch-up 缓冲中。renderer 安装快照后按顺序消费缓冲，
随后 main 将该 epoch 切换为 live forwarding。

item 以 `(turnId, itemId)` upsert；`item/completed` 的完整 item 覆盖临时 delta，因此即使
runtime 的 snapshot 与 notification 边界重叠，最终正文也不会重复。旧 epoch 的事件在快速
切换会话时直接丢弃，不能污染新会话。

### 4. 历史与工具活动

- Assistant/User 正文来自 runtime `thread/read`。
- runtime 历史遗漏的命令和工具卡片继续由 `ThreadActivityStore` 合并。
- raw Trace 继续由各 provider client 的 `TraceRecorder` 在路由前记录。
- 某些 runtime 未在历史 API 中保留的瞬时 reasoning 片段仍可能只以最终 reasoning 块呈现；
  这与当前历史会话能力一致，但原始 Trace 不受影响。

## 错误与竞态处理

- `thread/read` 失败：取消对应 observation epoch，不把缓冲事件应用到其他会话；保留现有
  “加载失败/重试”界面。
- 快速切换：每次选择生成新 epoch，旧 read 响应和旧缓冲均因 epoch 不匹配而失效。
- runtime 重启、工作区切换或 App 离开 Chat：清空 observed thread 和所有 catch-up 缓冲。
- thread 完成或失败：终态仍写 Trace、更新 main 状态；后台只更新低频侧栏摘要，切回后从
  `thread/read` 获取完整最终结果。

## 测试

- 路由纯函数：后台 100 次 agent delta 均不跨 IPC，可见会话 delta 全部转发。
- 路由纯函数：后台 thread status/name/archive 等摘要事件仍转发；renderer 未消费事件被丢弃。
- main/preload bridge：可见 thread 订阅和清空订阅有受控 IPC 接口。
- renderer smoke：后台突发事件不改变可见会话 DOM、不触发整页 render，并在切回后通过
  snapshot/catch-up 显示最终正文和工具卡片。
- renderer smoke：从 Chat 切到评测、设置、Case Draft 后 observed thread 为 null。
- 全量 `npm test`、renderer smoke、`git diff --check`、macOS 打包和稳定签名验证。

## 验收标准

- 后台事件洪峰不再进入 renderer timeline 通道。
- 当前可见会话仍保持流式输出。
- 切回已运行或已完成的后台会话时，最终正文和工具活动完整可见。
- Trace 和评测证据数量不因 UI 路由改变而减少。
