# Automatic Raw Case 目标边界修复设计

## 背景

Automatic Capture 已要求用户选择受管 Skill 与目标 Dataset，但扫描器仍保留两条旧语义：空目标会退化为扫描 Runtime 的全部 Skill；长扫描期间目标发生变化时，旧目标候选仍会先写入 Raw Case，只在后续 Automatic Curation 阶段阻止它进入新 Dataset。

因此，一次在旧配置下启动的真实会话扫描把 Runtime 中的 `systematic-debugging` 当作候选 Skill。用户随后选定 `billing-cost-management -> billing-test` 后，这条候选没有进入 `billing-test`，却错误地留在 Raw Case 中。

## 产品语义

- 启用 Automatic Capture 时，Raw Case 也只能来自当前显式选定的受管 Skill。
- 空目标不是“扫描全部本地 Skill”，而是无效配置；扫描必须在读取会话和调用分析 Agent 前停止。
- Runtime 中未纳入当前目标的本地 Skill 不能出现在分析 Agent 的候选列表中。
- 候选列表只剩一个 Skill 时也不能强行归类；用户原始问题必须确实属于该 Skill 描述的业务领域。
- 扫描期间目标变化后，旧目标候选直接作废，不写 Raw Case，也不创建 Curation Session。
- 同一受管 Skill 仍被选中、只切换到另一个兼容 Dataset 时，候选可以继续使用当前 Dataset。
- 历史 Raw Case 不自动删除。旧记录没有完整的配置快照，不能仅凭当前设置判断它在产生时是否合法。

## 方案比较

### 方案 A：只加强模型提示词

提示模型只能选择用户目标，但如果程序仍把全部本地 Skill 标记为 `enabledSkills`，模型无法判断哪些才是真正目标。提示词也不能提供确定性安全边界，因此不采用。

### 方案 B：只在扫描启动时过滤

能避免普通越界分类，却无法处理扫描期间用户切换配置的竞态。旧候选仍可能在新配置下写入 Raw Case，因此不采用。

### 方案 C：四层目标边界

1. 扫描启动时要求至少一个显式目标，并按受管 Skill ID 与 Dataset 绑定构造候选集合；Runtime 安装副本通过 App 中央安装记录恢复成受管 Skill ID。
2. Outcome 输入携带 Runtime 返回的 Skill 描述；提示明确声明传入列表就是完整目标集合，并要求用 `originalQuestion` 做反事实领域检查，不能因为“优化”等通用词与 Skill 名称部分重合就强行归类。
3. Outcome 提示禁止推断其它本地或系统 Skill；Rolling Skill、Dataset、Runtime 或自动化控制本身的故障，不因配置中出现目标 Skill 名称而成为该 Skill 的业务 Case。
4. 保存证据和 Raw Case 后端落库前重新读取最新 profile 与 Dataset；候选不再属于当前目标时安全跳过。

采用方案 C。Curation 前保留现有复核，作为配置在 Raw Case 落库后再次变化时的最后防线。

## 数据流

1. `runSlot()` 冻结开始时 profile，读取 Dataset 与 Runtime Skill。
2. profile 没有 targets 时抛出可理解的配置错误，不读取会话、不调用分析 Agent。
3. 只把 target 指向、且 Dataset 仍绑定同一受管 Skill ID 的 Dataset 纳入范围。
4. Runtime Skill 路径与中央安装记录的 Runtime、名称和安装目标精确匹配时，使用记录中的受管 Skill ID；只把与目标 Dataset 身份兼容的 Runtime Skill 传给边界与结果分析。
5. Outcome 只接收候选 Skill 的名称、路径、领域描述和 Dataset 绑定；其结果必须精确命中候选名称，并确认原始问题本身需要该 Skill，而不是 Rolling Skill 管理界面或通用词重合。歧义继续失败关闭。
6. 保存 Raw Case 前读取最新 profile 和 Dataset。模式已关闭、targets 为空或候选 Skill 不再被任何 target 接受时，返回 `stale_target_scope`，不写证据、不写 Raw Case、不启动 Curator。
7. 候选仍有效时按现有顺序写证据、写 Raw Case并启动 Curation。

## 错误与兼容

- 空目标使用新的目标配置错误，不再触发全量扫描。
- selected target 的 Dataset 缺失、绑定漂移或 Runtime Skill 无法唯一解析时继续失败关闭，避免静默扫描错误范围。
- Runtime Skill 只有在中央安装记录可唯一验证时才映射为受管 Skill；冲突或未验证记录不能靠名称猜测。
- Scheduled 模式仍不要求 Rubric，但同样要求显式受管 Skill/Dataset 路由。
- Automatic 模式继续要求目标 Dataset 有已发布 Rubric。
- 不修改 Dataset、Rubric、Case 和已有 Raw Case 数据。

## 测试

- 把现有“配置切换后保留旧 Raw Case”回归改为“旧候选不落 Raw Case”。
- 新增空 targets 时不读取会话、不调用分析、不写 Raw Case的测试。
- 新增同一 Skill 切换兼容 Dataset 后仍可沉淀的测试。
- 新增 Runtime 安装副本通过中央安装记录恢复受管 Skill ID 的测试。
- 断言 Outcome 提示明确禁止选择列表之外的 Skill，携带受限 Skill 描述，并要求对原始问题执行领域反事实检查。
- 运行 Desktop 全量测试、Renderer smoke、DSH/Core 全量测试与构建。
- 打包、签名、重新安装 App，并用实际设置执行一次自动扫描检查。
