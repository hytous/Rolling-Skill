# Rolling Skill 自操作页中文化与界面统一设计

## 背景

自操作工作台已经接入 `settings.language`，但静态 HTML、动态状态、空态、按钮和错误提示仍直接写死为英文；样式也单独定义了过密的小字号、卡片和按钮，没有复用现有 Skill 评测页的视觉尺度。DeepSeek Harness 后台启动命令同时遗漏了 `--no-open`，导致打开 App 时弹出本地 Web UI。

## 目标

- 继续使用现有 `settings.language`、`translations`、`t()`、`formatMessage()` 和 `data-i18n*` 机制，不建立第二套语言状态或独立字典。
- 中文模式下，自操作页所有常态可见文案、动态状态、空态、审批、预检、Epoch、预算及前端校验错误均显示中文；英文模式保持英文。
- 保留左侧任务、中间配置/会话、右侧状态的三栏信息架构，视觉尺度与 Skill 评测页一致。
- DeepSeek Harness 仍作为 App 内部 Runtime Host 运行，但不再自动打开浏览器。

## 国际化设计

1. 将自操作页的中英文键加入 renderer 现有 `translations.en` 与 `translations["zh-CN"]`。
2. `index.html` 中的静态标题、标签、选项、按钮、placeholder、提示和 aria label 使用现有 `data-i18n`、`data-i18n-placeholder` 与 `data-i18n-aria-label`。
3. Renderer 创建 Operator Workbench 时注入现有 `t()` 与 `formatMessage()`；Workbench 的动态状态、动作、空态、预检、预算、Epoch、恢复与审批文案只通过这两个函数生成。
4. 语言设置变化后继续由 `applyLocalization()` 更新静态 DOM，同时通知 Operator Workbench 重新渲染当前快照，不保存独立语言副本。
5. 前端能够识别的校验错误使用翻译键；未知后端错误保留诊断原文，但用当前语言的失败前缀呈现，避免吞掉排障信息。

## 视觉统一设计

- 页面背景、面板边框、圆角、阴影、强调色和状态色只使用现有主题变量，并与 Skill 评测工作台一致。
- 左侧任务列表对齐评测 Run 列表的行高、选中态、hover、标题与辅助文字层级。
- 中间配置页使用评测页相同的页面标题尺度、字段标签、输入框、选择器和主次按钮；删除自操作页特有的过小字号与全大写状态样式。
- 中间会话继续保留 Operator 专属内容，但消息卡、输入区和工具活动使用现有对话页的间距、边框与圆角尺度。
- 右侧范围、预算、子任务、产物和审批使用紧凑信息卡；普通状态使用中性/蓝色，警告和危险色只用于等待处理、停止及失败。
- 保留现有窄窗口响应式布局，不改变数据流、Job 状态机或优化流程。

## 浏览器弹出修复

DeepSeek Harness 启动参数从：

```text
dsh --profile web --port 0
```

改为：

```text
dsh --profile web --no-open --port 0
```

本地 HTTP/WebSocket Host 的生命周期和通信方式保持不变。

## 验收范围

- 中文设置下，自操作新建页、运行页、空态、动作、审批和多 Epoch 状态无遗留英文界面文案。
- 切换英文后使用同一套现有设置立即恢复英文。
- 自操作页的主要面板、控件和卡片与 Skill 评测页视觉一致，不新增独立主题变量。
- DSH Runtime 启动参数包含 `--no-open`。
- 只运行与本次修改直接相关的聚焦测试，不重复运行全量测试或 Renderer smoke。

## 非目标

- 不改变 Operator、Control Plane、Job Engine 或 Optimization Runner 的业务行为。
- 不重构全 App 的国际化架构。
- 不改变现有三栏信息结构。
