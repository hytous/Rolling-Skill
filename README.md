# Rolling Skill

Rolling Skill 是一个本地优先的 macOS Agent 客户端和 Skill 评测工作台。它连接电脑上
已经安装的 Agent Runtime，在同一个桌面应用中完成对话、Trace 查看、Case 沉淀、数据集
管理以及跨 Runtime 的 Skill 评测。

Rolling Skill 不捆绑 Codex、CodeBuddy 或其他 Runtime，不要求 Docker，也不依赖单独的
后端服务。应用本身没有登录系统；模型服务所需的认证仍由对应 Runtime 管理。

## 快速开始

双击仓库根目录的 `Rolling Skill.app`。本地构建使用 ad-hoc 签名，首次打开时 macOS 可能
要求先按住 Control 点击应用，再选择 **打开**。

应用启动后会自动发现兼容的本机 Runtime。也可以在 **设置 → Runtime** 中重新扫描、
选择指定的可执行文件或恢复自动选择。

当前构建目标：

- macOS 13 或更高版本；
- Apple Silicon；
- 至少安装一个受支持的 Runtime，才能实际发起 Agent 请求。

没有可用 Runtime 时，应用、本地数据集和历史评测记录仍可正常打开。

## 核心能力

- 像本地 Codex 客户端一样创建和继续 Agent 对话；
- 从 Runtime 的模型清单中选择模型和推理强度；
- 查看并保存 Runtime 原始 Trace；
- 从一段连续的问题解决过程创建 `goodcase` 或 `badcase`；
- 冻结证据保留用户问题原文；数据集问题默认复制原文，也可在沉淀前人工编辑；
- 使用独立 Curator 会话提炼参考答案、硬判定条件、输出格式和失败原因；
- 将已完成或丢弃的 Case Draft 从活动列表移出，并在设置中查看归档记录；
- 创建、浏览和删除数据集及其中的 Case；
- 运行单个 Case 或整个数据集；
- 为一次评测选择多个 Runtime、模型和推理强度，并让不同 Runtime 并行执行；
- 在 **Skill 评测 → 评测记录** 中查看或删除持久化的 Case × Runtime 结果；
- 删除当前 Case 后继续保留历史评测使用的不可变快照；
- 可选 Automatic Capture，默认关闭且只创建待审核草稿，不会自动写入数据集。

删除数据集会同时移除其中的 Case 和已结束的 Curator 草稿记录，但保留历史评测快照；若仍
有未结束草稿，删除会被阻止。排队中或运行中的评测记录不能删除，终态记录删除后不会额外
删除其原始 Trace 文件。若删除的是 Automatic Capture 目标数据集，自动沉淀会关闭，不会
静默改投其他数据集。

当前自动评测重点是 Skill 工作流和输出格式。数字结论暂不作为自动硬门槛，仍保留给人工
或后续 Agent Judge 审核。

## Runtime 支持

| Runtime | 接入协议 | 当前能力 |
| --- | --- | --- |
| Codex | app-server JSONL | 对话、历史任务、模型、推理强度、会话权限、Skills、Plugins、Trace、评测 |
| CodeBuddy | ACP stdio JSONL | 对话、模型、推理强度、会话权限与授权确认、流式输出、Trace、评测 |

Chat 始终绑定一个活动 Runtime。Skill 评测使用隔离的 Runtime 客户端，因此可以让多个
Runtime 配置并行运行，而不会共享活动对话的客户端状态。同一个 Runtime 内的 Cases 顺序
执行，避免会话状态互相干扰。

Runtime 自己负责 Skills、MCP、Plugins、上下文和模型认证。Rolling Skill 负责统一发现、
会话呈现、数据集、评测编排和证据记录，不复制 Runtime 的 Skill 内容，也不会静默安装或
升级 Runtime。

Chat 输入框左下角提供按会话保存的权限选择。Codex 映射到只读、仅工作目录或完整本机
访问；CodeBuddy 使用其原生 `session/set_mode`，可选自动审核、需要时询问、自动允许编辑、
Plan、不询问直接拒绝、跳过提示或完整访问（ACP `fullAccess`）。CodeBuddy 的“需要时询问”
会在本机弹出授权确认；找不到明确拒绝选项时会安全取消。默认使用自动审核，不再硬编码
`dontAsk`。

### 本机发现

Codex 会检查已保存路径、`ROLLING_SKILL_CODEX_BIN`、`PATH`、ChatGPT/Codex.app 资源、
Homebrew 和常见用户目录。候选文件必须能标识为 Codex 并支持 `app-server`。

CodeBuddy 会检查已保存路径、`ROLLING_SKILL_CODEBUDDY_BIN`、`PATH`、Homebrew、常见用户
目录和兼容的 `.sre-codex` 安装。候选文件必须支持 stdio ACP。

每个候选 Runtime 都必须通过对应 Provider 的兼容性探测，不能仅凭文件名被选中。

## Codex originator 兼容模式

Codex app-server 会把初始化请求中的 `clientInfo.name` 作为后续模型请求的 `originator`
header。如果企业 Codex 服务只允许固定的 known clients，未登记的客户端会返回：

```text
403 Forbidden: unsupported Codex client originator
```

这不是账号未登录，也与模型或推理强度无关。当前开发测试版本临时使用 `codex_exec`
作为 app-server originator，以兼容已经允许本机 Codex CLI 的内部网关；窗口标题与产品界面仍
保持 Rolling Skill。该兼容身份只用于开发测试，正式分发前应恢复 `rolling-skill` 并完成相应
客户端登记。

## Case 沉淀流程

1. 在 Chat 中完成一次问题解决过程。
2. 在结束该过程的 Assistant 消息旁选择 **沉淀 Case**。
3. 选择作为起点的 User 消息、目标数据集、被测 Skill 和 `goodcase`/`badcase`；数据集问题
   默认使用原文，也可在开始沉淀前编辑。
4. Rolling Skill 冻结所选对话及 Trace 范围；人工编辑只改变评测输入，冻结证据中的原始
   问题不变，原对话仍可继续使用。
5. 独立、只读的 Curator 会话根据当前 Runtime 中的 Skill 整理必要证据。
6. 可以继续向 Curator 提问、要求修改、切换模型或推理强度。
7. 选择 **Done** 后保存 Case；选择 **丢弃** 则不写入数据集。

Curator 的结构化结果包含参考答案摘要、必要事实、必要步骤、输出格式、证据引用、硬性
通过条件、软性标准和自动失败条件。Badcase 还包含首次偏离点、根因、重复循环摘要和正确
恢复方式。

## Skill 评测

在左上角切换到 **Skill 评测**：

1. 选择数据集和被测 Skill；
2. 选择自动触发或显式诊断模式；
3. 勾选一个或多个 Runtime；
4. 分别选择模型和推理强度；
5. 独立选择 Judge Runtime、模型和推理强度；
6. 启动选中 Case 或整个数据集；
7. 在 **评测记录** 中查看执行状态、判分状态、回答、Trace 和逐项得分。

每个 `Case × Runtime` 满分 100：A「Skill 执行合规」60 分，B「数字与结论正确性」
40 分。A 固定为 Skill 激活、必读 Reference、工具与 CLI 策略、工作流顺序、分页/完整性/
落盘、确定性处理、证据与输出规范、错误恢复八项，由固定程序校验 Judge 是否逐项填写并
计算分数；A 达到 48 分且没有 Skill 激活关键失败才通过硬门槛。B 使用 Case 的整理标准
主观评分，并记录可验证字段、交叉校验、验证状态和 Judge 置信度；B 不会反转 A 的门槛
结论。被测执行、Judge 判分和质量结论是三个独立状态，Judge 失败不会丢失原回答或 Trace。
显式唤起只作诊断：保留 A/B 分项，但不生成正式总分或通过/失败结论。

所有被测 Runtime 完成后，Rolling Skill 才启动独立、只读的 Judge 会话。每个 Case 的
Trace 会冻结为精确行范围，所选 `SKILL.md` 及递归链接的本地 Markdown Reference 也会按
摘要固定快照；程序会把回答、Trace 与 Skill 快照整理成类型化证据目录，正向 A 评分不能
用无关证据冒充 Skill 激活、Reference 读取或工具执行。每个 Case 执行前后还会重新核对
Skill 摘要，若评测期间内容发生变化则拒绝该结果。命令输入保留，长输出有界摘要并明确
标注截断。Judge 输出若漏掉任何评分项或违反结构契约会自动重试一次，最终得分只由本地
固定程序计算。

正式百分制结论还要求被测 Runtime 能通过 Skill 清单确认执行的是同一个绝对 Skill 路径。
无法提供路径级 Skill 清单的 Runtime（例如当前 CodeBuddy 适配）仍会运行并展示 A/B 分项，
但只标为诊断，不生成正式总分或通过结论，避免把另一份同名 Skill 当作冻结版本。

自动触发模式只发送 Case 当前保存的数据集问题；未编辑时它等于原问题，冻结的原问题仅
用于溯源。该模式用于评测 Runtime 是否能自行发现并触发 Skill。显式诊断模式使用对应
Provider 的显式 Skill 输入，用于区分“没有触发 Skill”和“Skill 执行错误”，不等同于
自动触发成绩。

## 本地数据

所有 Rolling Skill 数据默认保存在本机：

| 路径 | 内容 |
| --- | --- |
| `~/Library/Application Support/Rolling Skill/evaluation-store.json` | 设置、数据集、Cases、Curator 会话和评测记录 |
| `~/Library/Application Support/Rolling Skill/preferences.json` | 工作目录和 Runtime 选择 |
| `~/Library/Application Support/Rolling Skill/traces/*.jsonl` | 带 Runtime 身份的追加式 Trace |

## 构建与开发

在仓库根目录构建可双击应用：

```bash
bash desktop/rolling-skill/scripts/build-macos-app.sh
```

开发模式：

```bash
cd desktop/rolling-skill
npm ci
npm test
npm start
```

构建脚本会运行测试、生成 Apple Silicon Electron 应用、确认包内没有 Agent Runtime、
应用 ad-hoc 签名，并将结果写到仓库根目录的 `Rolling Skill.app`。

## 安全边界

- Runtime 探测和启动使用固定参数数组及 `shell: false`；
- Renderer 禁用 Node integration，启用 context isolation 和 Chromium sandbox；
- Preload 只暴露受限的 Runtime、会话、数据集、Curator、评测和 Trace IPC；
- 外部 HTTPS 链接交给 macOS 打开，其他内部跳转会被阻止；
- 数据集使用原子写入，Trace 使用仅当前用户可读的追加式文件；
- Rolling Skill 不静默安装 Skill、Plugin 或 Runtime，避免污染评测可复现性。

更详细的架构、协议和测试说明见
[desktop/rolling-skill/README.md](desktop/rolling-skill/README.md)。

## License

见 [LICENSE](LICENSE)。
