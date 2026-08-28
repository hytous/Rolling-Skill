# DSH 多 Skill Case 与 Draft 审核体验设计

## 目标

让多 Skill 自动沉淀的数据归属清晰、可筛选；让 Draft 审核聚焦于阅读结果和继续修订；让 Case 中的 Markdown 内容以安全、直观的格式展示。

## 已确认问题

1. Raw Case 已按受管 Skill ID 分组，创建 Draft 时也会校验 Dataset 的受管 Skill ID，底层不会跨 Skill 串数据；但 Skill 分组标题不可操作，也没有 Skill 筛选。
2. “进行中/已保存”只改变弱按钮样式，且切换分类时没有同步右侧选中的 Session，可能出现左侧显示“进行中”、右侧仍展示已保存 Draft。
3. 修订输入框排在 Curator 原始对话、冻结证据和长 Draft 之后，用户很难发现。
4. Case answer 直接作为纯文本渲染，Markdown 语法被原样显示。

## 交互设计

### Raw Case 的 Skill 筛选

- 顶部增加 Skill 筛选，默认“全部 Skill”，选项显示 Skill 名称和当前 Raw Case 数量。
- 分组标题改为可点击按钮；点击后进入该 Skill 的筛选结果。
- 当前筛选有明确选中态，并提供返回“全部 Skill”的入口。
- 搜索只作用于当前 Skill 范围；空状态区分“没有 Raw Case”和“当前筛选无匹配”。
- 数据请求、Raw Case 归属和 Draft 创建协议不变，仍以稳定受管 Skill ID 为准。

### Draft 分类与当前选择

- “进行中/已保存”改为语义明确的分段控件，使用 `aria-pressed` 和可见的填充、边框选中态。
- 切换分类时，若当前 Session 不属于新分类，自动选择新分类第一项；新分类为空时清空右侧详情。
- 列表项继续保留独立选中态，避免把“分类选中”和“Draft 选中”混为一谈。

### Draft 审核主体

- 主体顺序改为：标题与状态 → 当前 Draft → 修订输入区 → 操作按钮。
- 不再展示 Curator 原始对话日志。
- 修订输入区使用对话式文案，提示“告诉 Curator 哪些内容需要修改”，并提供明确的“生成修订版”主按钮。
- 提交后沿用现有 `curation.send`，轮询当前 Session；新版本完成后直接替换当前 Draft，不引入新的后端协议。
- 冻结证据、受管 Skill 版本、评分标准版本、Runtime、安装审计以及模型设置保留在默认折叠的“运行信息”中。
- 已保存 Session 只读，不显示修订输入区。

### Case Markdown 展示

- Case 列表和详情中的 question、answer、issue description 使用同一安全 Markdown 展示组件。
- 支持段落、标题、无序/有序列表、引用、加粗、斜体、行内代码、代码块和链接。
- 不使用未经清洗的 `dangerouslySetInnerHTML`，不执行原始 HTML；链接只允许安全协议并在新窗口打开。
- 列表视图限制预览高度，详情视图展示完整内容。
- Rubric、安装审计和来源证据仍属于高级信息，不与正文混排。

## 数据与兼容性

- 不修改 Raw Case、Curation Session、Case 或 Dataset 的存储 Schema。
- 旧数据无需迁移；缺少受管 Skill ID 的旧 Raw Case 继续按 legacy Skill 名称独立分组。
- 不改变 Curator、Rubric、Judge 的模型配置来源。

## 错误处理

- Skill 筛选指向已删除 Skill 时自动回到“全部 Skill”。
- 分类切换后不存在可选 Draft 时显示空状态，不保留另一分类的详情。
- 修订请求失败时保留输入内容并在输入区附近显示错误。
- Markdown 中不安全链接显示为普通文本，不生成可点击链接。

## 验证

- 单元测试覆盖 Skill 分组/筛选、分类切换时的选择协调、安全 Markdown 解析与链接协议。
- 客户端源码契约测试覆盖隐藏 Curator 日志、运行信息折叠、修订输入区和明确选中态。
- 完整运行 DSH/Core 回归，重新打包并安装到本机 DSH。
- 在窄窗口和多个 Skill/多个 Draft 的模拟数据下检查无溢出、无残留详情、Markdown 可读。

