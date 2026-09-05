# Automatic Curation 配置切换竞态修复设计

## 背景

Automatic Capture 的一次扫描会先冻结运行开始时的配置，用该配置筛选 Runtime Skill 和会话，再在候选落入 Raw Case 后启动 Automatic Curation。当前 Curation 阶段会重新读取最新配置。当用户在长扫描期间切换目标 Dataset 时，旧扫描候选可能属于旧 Skill，而最新配置只允许另一个 Skill。现有实现把“候选已不在当前作用域”与“当前匹配 Dataset 缺少已发布 Rubric”合并成同一异常，并让异常终止整轮扫描。

本次真实故障中，扫描保存了 `systematic-debugging` Raw Case，最新目标却是绑定 `billing-cost-management` 的 `billing-test`。`billing-test` 已有已发布 Rubric，因此错误提示并不反映当前配置。

## 目标

- 候选落库后，按最新 Automatic Capture 目标重新确认它是否仍在作用域内。
- 已越界候选保留为待处理 Raw Case，不创建 Curation、不写入错误 Dataset，也不终止扫描。
- 当前作用域内的匹配 Dataset 真正缺少已发布 Rubric 时，继续失败并显示配置错误。
- 用户修改 Automatic Capture 配置后，立即清除上一配置遗留的错误；若新运行仍失败，再记录新错误。
- 不修改现有 Dataset、Case、Rubric 或已保存 Raw Case。

## 方案比较

### 方案 A：整轮始终使用旧配置

优点是行为简单。缺点是用户已切换或关闭目标后，旧扫描仍可能自动把 Case 写进不再允许的数据集，违背最新用户配置，因此不采用。

### 方案 B：配置变化时中断并重启扫描

可以保证整轮配置一致，但需要取消正在运行的模型分析、处理游标和重复候选，改动范围大，且一次普通设置修改可能浪费已完成的扫描工作，因此不采用。

### 方案 C：Curation 前按最新作用域重新校验

保留已经完成的候选识别结果，只阻止过期候选自动写入。对不匹配候选执行安全跳过，对匹配但缺 Rubric 的候选保持失败闸门。这是本次采用的方案。

## 数据流

1. 扫描按开始时配置识别候选。
2. 候选先持久化为 Raw Case，确保分析结果不会丢失。
3. Automatic Curation 读取最新 profile 和 Dataset 列表。
4. 若 profile 已关闭，直接停止自动整理。
5. 若 profile 有显式 targets，但当前候选 Skill 不匹配任何最新 target，返回 `null` 并继续扫描。
6. 若候选仍在最新作用域内，解析唯一 Dataset。
7. Dataset 没有 `activeRubricVersionId` 时抛出原有配置错误；存在时创建 Curation Session。

## 错误状态

`AutomaticCaptureStateStore` 新增幂等 `clearError()`：仅清除 `lastError`，保留上次运行、成功时间、调度槽和会话游标。

Main Process 在 `settings:update` 中识别 Automatic Capture 相关字段。只有这些字段发生显式更新时才清理旧错误并重新调度；修改语言、主题等无关设置不得隐藏自动沉淀错误。正在运行的扫描若之后发生新的真实错误，仍可通过 `failSlot()` 写回新错误。

为让当前安装中的历史误报消失，App 启动时若遇到旧版固定路由错误，并且当前显式 targets 全部存在、Skill 绑定一致且有已发布 Rubric，则只清除这条已失效错误。其它 Runtime、Curator 或存储错误不得在启动时自动清除。

真实补跑还发现，Outcome 模型偶尔会把可选的 `finalAssistantItemId` 抄错一个字符。该 ID 只用于在已经冻结的 Episode 内缩短最终边界，不应成为整轮扫描的单点故障。解析器仍拒绝信任不存在的 ID，但把它归一为 `null`，让调用方回退到程序冻结的 `episode.source.endItemId`；同时在提示词中明确要求精确复制现有 `agentMessage` ID，否则返回 `null`。

## 接口边界

- `automatic-capture.cjs`：判断最新显式路由是否仍接收候选。
- `automatic-capture-state-store.cjs`：提供幂等错误清理。
- `main.cjs`：Automatic Capture 配置变更时触发清理；应用启动时执行受限的旧错误修复。
- 不新增 Renderer API，不增加 Agent Tool，不改变数据集身份或 Rubric 契约。

## 测试

- 复现扫描使用旧 Skill、Curation 看到新 target 的竞态；断言 Raw Case 保留、Curation 未创建、扫描成功完成且游标推进。
- 断言当前 target 匹配但 Rubric 缺失时仍失败。
- 断言 `clearError()` 不改变调度槽和游标，并且重复调用安全。
- 断言 Automatic Capture 设置变更会清理错误，无关设置不会。
- 断言启动清理只处理“当前 targets 已全部有效”的旧固定错误。
- 断言模型返回未知的可选 Assistant Item ID 时不会终止扫描，并回退到可信 Episode 结束边界。
- 运行 Desktop 全量、DSH/Core 全量和 Renderer smoke，随后打包、签名、安装并确认误报消失。
