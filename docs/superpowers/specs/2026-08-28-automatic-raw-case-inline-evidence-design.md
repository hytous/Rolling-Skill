# 自动 Raw Case 原会话证据内嵌设计

## 背景

自动沉淀产生 Raw Case 时，用户通常不知道检测来自哪个会话。现有“捕获证据”只展示会话 ID、问题起点和回复终点；只有用户已经打开恰好相同的 DSH 会话时，才能回到原页面查看着色范围。要求用户凭会话 ID 去侧栏寻找来源，在自动流程里实际上不可用。

本次把限定范围内的原会话直接展示在 Raw Case 详情中。来源会话定位保留为当前会话恰好匹配时的辅助能力，不再是查看证据的前置条件。

## 已确认方案

采用“新数据冻结快照、旧数据按需回源”的组合方案。

- 新自动 Raw Case 在检测时把已经用于分类的标准 Episode 写入内容寻址的私有证据目录，Raw Case 观察记录只保存摘要引用，不把整段消息写入 JSONL 或列表接口。
- 打开“捕获证据”时，通过独立只读接口按 Raw Case ID 读取最新观察对应的 Episode。
- 没有快照引用的旧 Raw Case 由 Host 按原 observation 的 Runtime、thread 和起止边界回源重建。DSH 使用受信 `sessionQuery` 按原生 seq 读取；其他 Runtime 使用 `readThread` 和既有 `buildEpisodeSnapshot`。
- 返回范围只包含起点用户消息到终点 Assistant 回复之间的消息和工具调用，不读取或展示范围外的会话内容。

## 数据与存储

新增通用自动捕获证据存储，位于 Rolling Skill 数据根目录的 `raw-cases/evidence/`：

- 文件内容是 `rolling-skill-episode/v1` 的稳定 JSON。
- 文件名和引用使用 SHA-256 内容摘要；重复 Episode 自动复用同一文件。
- 目录权限为 `0700`，文件权限为 `0600`。
- 读取时重新计算摘要，拒绝缺失、格式错误或内容被修改的文件。
- Raw Case observation 只持久化 `rolling-skill-automatic-evidence-reference/v1` 和 digest，不持久化本机绝对路径。

自动分类仍使用现有 Episode。只有候选达到保存门槛时才写证据快照，内部模型会话、无关片段、uncertain 和低置信度片段不会生成 Raw Case 证据文件。

## Host 接口

新增只读方法 `rawCases.evidence({id})`：

1. 校验 Raw Case ID，并读取最新 automatic observation。
2. 有证据引用时，从内容寻址存储读取并校验快照。
3. 旧数据无引用时，按 observation 回源重建精确 Episode：
   - DSH observation 的 `dsh:<session>:<seq>` 边界由 `sessionQuery` 读取并校验为直接用户起点和已完成 Assistant 终点；
   - 其他 Runtime 使用 observation 自带的 item/turn 边界构建 Episode。
4. 通过现有 `publicEpisode` 白名单投影返回消息、工具名、状态、参数、结果和错误；长文本继续使用现有界限。

该接口不修改 Raw Case，不缓存旧数据回源结果，也不把来源绝对路径返回 Client。来源会话被删除或 Runtime 不可用时返回可重试错误，Raw Case 的分类摘要和高级 observation 信息仍可查看。

## Client 交互

打开自动 Raw Case 的“捕获证据”弹窗后立即请求证据：

- 加载时显示明确的“正在读取原会话片段”。
- 成功后在弹窗内显示完整的范围时间线；用户消息、Assistant 回复使用明确角色标签，第一条和最后一条分别标识起点和终点。
- 工具调用显示工具名和状态，参数、结果、错误默认折叠，避免长 trace 抢占可读空间。
- 当前 DSH 页面恰好是来源会话时，继续提供“在当前会话中查看范围”；否则不再提示用户去侧栏寻找会话。
- 来源会话 ID、item ID、digest、observation 原始字段统一放到“高级信息”。
- 读取失败时在时间线位置显示错误与重试按钮，不关闭弹窗，也不丢失分类、结果、置信度、检测时间、摘要和入选原因。

手工 Raw Case 没有自动 Episode，继续显示手工来源说明，不调用证据接口。

## 边界与兼容性

- 新字段为 observation 的可选字段，旧 JSONL 不迁移即可继续读取。
- 多 observation Raw Case 始终展示最新 observation 对应证据，和现有详情语义一致。
- 证据接口是只读方法，不加入 mutation 集合。
- DSH 回源必须校验 start/end seq；不得退化为返回整场会话或猜测边界。
- 非 DSH 回源必须使用 observation 的 start/end item/turn；边界不存在时失败，不回退到“最近一轮”。
- 现有 Draft 创建、自动 Curator、当前会话着色和 Raw Case 去重行为保持不变。

## 测试与验收

- 证据存储测试覆盖稳定摘要、去重、权限、篡改和非法引用。
- Raw Case Store 测试覆盖 evidence reference 的白名单校验与旧 observation 兼容。
- 自动捕获测试证明保存候选时写入分类所用 Episode 的引用，未入选片段不写。
- Core application 测试覆盖快照读取、旧 DSH 回源、旧非 DSH 回源、精确范围、缺失来源错误和只读 dispatch。
- DSH Client 测试覆盖加载、成功、失败、重试、消息角色、工具折叠以及不再要求打开来源会话。
- 完整 `npm run test:dsh`、Client 构建、插件包检查通过后，安装新版本到本机 DSH，并在真实工作台检查已有自动 Raw Case 的弹窗。

## 非目标

- 不把完整会话或范围外 trace 存入 Raw Case。
- 不自动打开、切换或搜索来源会话。
- 不改变检测模型、Curator 模型、评分标准或 Dataset 路由设置。
- 不给 Runtime 安装的 Skill 增加 digest 校验，也不改变 Skill 触发执行逻辑。
