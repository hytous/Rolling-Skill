# 自操作任务记录批量删除实施计划

> 按 `2026-09-05-operator-task-record-delete-design.md` 实现；严格先写失败测试，再写生产代码。

## 任务 1：定义 Store 逻辑删除与迁移契约

**文件：**

- 修改：`desktop/rolling-skill/test/operator-job-store.test.cjs`
- 修改：`desktop/rolling-skill/src/operator/job-store.cjs`

**步骤：**

1. 添加失败测试，覆盖 v2→v3 迁移、终态根任务批量移除、活动/子任务拒绝、整批原子性、幂等性、重启持久化和摘要过滤。
2. 添加失败测试，确认被移除任务的 Job、Event 和 Artifact 仍可按 ID 读取。
3. 运行 `node --test test/operator-job-store.test.cjs`，确认测试因缺少 v3 字段或方法失败。
4. 将 Store 升级到 v3，加入严格 `dismissedRootJobIds` 校验和 v1/v2 迁移。
5. 实现 `dismissJobRecords(jobIds)` 并让摘要仅投影未移除的完整 Job 树。
6. 重跑聚焦测试至通过。

## 任务 2：加入可信 Renderer IPC，不暴露给 Agent

**文件：**

- 修改：`desktop/rolling-skill/test/main-bridge.test.cjs`
- 修改：`desktop/rolling-skill/src/main.cjs`
- 修改：`desktop/rolling-skill/src/preload.cjs`

**步骤：**

1. 添加失败测试，要求 Preload 暴露批量删除 API、Main 注册严格 IPC，并确认 Control Tool 清单没有记录删除能力。
2. 运行 Main bridge 聚焦测试，确认 RED。
3. 注册 `operator:dismiss-records`，校验 sender 和 1–100 个唯一规范根 Job ID。
4. 调用 Store 逻辑删除并广播摘要失效通知；Preload 暴露 `dismissOperatorJobRecords(jobIds)`。
5. 重跑聚焦测试至通过。

## 任务 3：实现批量管理交互

**文件：**

- 修改：`desktop/rolling-skill/test/operator-workbench.test.cjs`
- 修改：`desktop/rolling-skill/renderer/index.html`
- 修改：`desktop/rolling-skill/renderer/operator-workbench.js`
- 修改：`desktop/rolling-skill/renderer/renderer.js`
- 修改：`desktop/rolling-skill/renderer/styles.css`

**步骤：**

1. 添加失败测试，覆盖管理按钮、选择框、活动任务禁用、全选已结束、计数、取消、确认和删除后刷新。
2. 运行工作台聚焦测试，确认 RED。
3. 在任务面板加入管理按钮和紧凑批量操作栏。
4. 在列表项中渲染原生选择框；管理状态下点击选择框不切换会话，活动任务保持禁用。
5. 删除前使用现有确认能力；成功后清空选中项、退出管理、全量 catch-up，并在当前项被删除时回到新建任务。
6. 增加中英文文案和与现有工作台一致的样式。
7. 重跑工作台测试至通过。

## 任务 4：真实 Renderer 验证

**文件：**

- 修改：`desktop/rolling-skill/scripts/renderer-smoke.cjs`
- 必要时修改：`desktop/rolling-skill/scripts/renderer-smoke-preload.cjs`

**步骤：**

1. 在 smoke 数据中提供一个已结束任务和一个活动任务。
2. 打开管理模式，确认活动任务不可选、已结束任务可选。
3. 选择并删除已结束记录，确认列表移除、当前页面回到新建状态且 `rendererErrors=0`。
4. 运行 `npm run smoke:renderer` 至通过。

## 任务 5：回归、安装与交付

**文件：**

- 更新：`docs/superpowers/plans/2026-09-05-operator-task-record-delete.md`

**步骤：**

1. 运行 Desktop 全量测试。
2. 运行 DSH/Core 全量测试。
3. 运行 Renderer smoke、Tool 构建和 `git diff --check`。
4. 打包并签名 macOS App，确认签名有效。
5. 安装到 `/Applications/Rolling Skill.app`，实际启动并从用户视角检查批量管理交互。
6. 显式暂存本需求文件，确认 staged 中没有任何 `.tgz`。
7. 提交并推送 `main`。
8. 向 agent-project-record 追加 final 事件和简短用户偏好，提交并推送记录仓库。

## 完成状态

- [x] Store v3 迁移、终态校验、原子批量逻辑删除与审计保留
- [x] 可信 Renderer IPC；未向 Agent Control Tool 暴露删除能力
- [x] 批量管理、全选已结束、单次确认、删除后刷新与中英文文案
- [x] 聚焦测试、Desktop/DSH 全量测试和真实 Renderer smoke
- [x] macOS 打包、签名、安装、启动与真实安装版界面检查
- [x] 提交代码；项目记录在交付收尾中同步
